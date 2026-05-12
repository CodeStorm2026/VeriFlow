# VeriFlow — complete project handbook

This document is the **single narrative** of what VeriFlow is, why it exists, how every major piece works, and how the pieces connect. It complements [README.md](../README.md) (quickstart and curl examples) and [CODESTORM.md](../CODESTORM.md) (jury pitch, market, checklist).

---

## 1. Purpose (why)

### 1.1 Problem

Distributed payment chains involve **many actors** (merchant, gateway, exchange, bank). Each publishes events on its own timeline. Reconciliation is often **batch and late**, so teams discover amount/fee/FX drift, missing hops, duplicates, and delays **hours or days** later.

### 1.2 Product intent

VeriFlow is a **hackathon-grade observability prototype**: ingest normalized events, **rebuild a live graph per `transaction_id`**, run **rules** to detect integrity issues, **localize** which hop introduced the problem, and **push updates to a browser** over WebSockets—similar in spirit to Grafana/Datadog but for **payment-chain integrity** (especially **fiat + crypto bridge**).

### 1.3 What this repo is *not*

- Not a production core-banking reconciliation core.
- Not anti-fraud; fraud signals could be another event source later.
- Not full ISO 20022 / SWIFT parsing; ingress accepts **canonical JSON** or a **minimal Stripe-like** demo.

---

## 2. High-level architecture

### 2.1 Runtime diagram (logical)

1. **Producers** write `TransactionEvent` JSON to Kafka topic **`vf.events`** (keyed by `transaction_id` where producers use keys).
2. **Simulators** (merchant, gateway, crypto exchange, bank) and **payment-ingress** are producers and/or consumers on that topic.
3. **reconciliation-engine** consumes `vf.events`, mutates in-memory/Redis-backed graph state, computes **incidents** and **metrics**, publishes snapshots to Redis (pub/sub + keys).
4. **websocket-api** subscribes to Redis, serves **HTTP** (health, demo, settings, mock APIs) and **WebSocket `/ws`** to browsers.
5. **frontend** connects to API/WS, renders **React Flow** graph, dashboards, module pages.

### 2.2 Control plane (fault injection)

- **Topic:** `vf.control` — carries `ControlCommand` objects.
- **websocket-api** exposes `POST /demo/inject` and builds commands from `POST /demo/scenario`.
- Each **simulator** runs a **Kafka consumer** on `vf.control` and an **InjectionController** (in-memory queue per process) so that the **next** matching event for a `target_node` + optional `transaction_id` applies the fault.

### 2.3 Why Kafka + Redis

- **Kafka:** durable ordered stream per key, replayable consumers, clear boundary between “sources” and “reconciliation.”
- **Redis:** fast cache for latest graphs, pub/sub fan-out to websocket-api, fee overrides, escalation timers, heartbeat keys, optional correction log lists.

---

## 3. Infrastructure (`docker-compose.yml`)

### 3.1 Zookeeper + Kafka

- **Zookeeper:** coordination for Kafka broker.
- **Kafka:** single broker demo; `PLAINTEXT` on `9092` inside the network, `29092` advertised for host access from the Mac.
- **Healthcheck:** broker API versions; other services **wait** on `kafka: service_healthy` to avoid connection storms on cold start.

### 3.2 Redis

- Custom config mounted from `infra/redis/redis.conf`.
- **Host port `16379` → container `6379`** so a developer machine Redis on 6379 does not collide.

### 3.3 `reconciliation-engine`

- **Build:** `./backend` image; command `python -m services.reconciliation_engine`.
- **Env:** `VF_MISSING_THRESHOLD_MS=5000` in Compose for **fast missing-hop** demos (code default is 60s).

### 3.4 `websocket-api`

- Port **8001**; healthcheck hits `GET /health`.
- **`VF_AUTOCORRECT_MAX_DELTA`** for mock correction eligibility messaging.

### 3.5 `payment-ingress`

- Port **8002**; bearer token set in Compose for local demos.
- **`VF_INGEST_DEFAULT_NODE_ID=gateway`** so Stripe-like payloads land on the node the graph expects.

### 3.6 Simulators

- **merchant-simulator:** high synthetic rate + fault probability (see §7.1).
- **gateway-simulator**, **crypto-exchange-simulator**, **bank-simulator:** transform upstream events; apply fees/FX; honor control hooks.

### 3.7 `frontend`

- **`VERIFLOW_API_PROXY_TARGET`** points Vite dev proxy at `websocket-api` inside Docker so the browser only talks to `:3000`.

---

## 4. Domain model (`backend/common/models.py`)

### 4.1 `EventType`

- `PAYMENT_INITIATED` — merchant (or ingress) starts the chain.
- `PAYMENT_PROCESSED` — gateway leg.
- `FX_EXECUTED` — crypto exchange leg (bridge narrative).
- `SETTLED` — bank leg.

### 4.2 `NodeStatus` / `EdgeStatus`

Used by the engine and UI: **healthy**, **delayed**, **mismatch**, **missing**, **duplicate**, **unknown**.

### 4.3 `IncidentType`

- `amount_mismatch`, `fee_mismatch`, `fee_policy_mismatch`, `fx_mismatch`
- `duplicate_event`, `missing_hop`, `delayed_event`
- `bank_ledger_autocorrect` — informational/auto-nudge style resolution path in demos.

### 4.4 `ControlType` + `ControlCommand`

- `fee_mismatch`, `delay`, `duplicate`, `missing`
- Fields: `target_node`, `transaction_id` (optional; if set, only that tx consumes the plan), `delay_ms`, `count`.

---

## 5. Payment paths (`backend/common/constants.py`)

### 5.1 `STANDARD_PATH`

`["merchant", "gateway", "bank"]` — **card** and **bank transfer** demos.

### 5.2 `CRYPTO_PATH`

`["merchant", "gateway", "crypto_exchange", "bank"]` — **crypto settlement** showcase: network fee + FX + bank fiat settlement.

### 5.3 `payment_rail` constants

- `card_acquiring`
- `bank_transfer`
- `crypto_settlement`

Copied into graph snapshots for UI filters and treasury views.

---

## 6. Merchant simulator (`backend/services/merchant_simulator/app.py`)

### 6.1 What it does

Loop:

1. Increment synthetic `transaction_id` (`tx-*`).
2. Pick **rail profile** with weighted random:
   - **Card:** USD, `STANDARD_PATH`, `tx_kind=card`.
   - **Transfer:** currency among UZS/USD/EUR, `transfer_scheme` variants, `STANDARD_PATH`.
   - **Crypto:** `CRYPTO_PATH`, `crypto_settlement`, stablecoin bridge metadata.
3. Optionally **`_maybe_queue_synthetic_fault`**: with probability `VF_SIMULATOR_FAULT_PROBABILITY`, enqueue a `ControlCommand` on `vf.control` **before** emitting `PAYMENT_INITIATED`, then sleep `VF_SIMULATOR_INJECT_GRACE_MS` so simulators ingest control before the merchant event.
4. Publish merchant event to `vf.events`.

### 6.2 Why synthetic faults

Without control hooks, almost all synthetic traffic is “clean,” so the **Problems** queue looks empty. Fault injection makes reconciliation **visible** during demos.

### 6.3 Rate and jitter

- Sleep uses `jittered_interval(simulator_rate_per_sec, simulator_jitter_ms)` — average spacing ≈ `1/rate` seconds with jitter.

---

## 7. Downstream simulators

### 7.1 Gateway (`gateway_simulator`)

- Listens to merchant `PAYMENT_INITIATED`.
- Applies **fee model** from Redis-backed fee settings (`load_fee_settings`): percent vs fixed gateway fee.
- Metadata carries **fee_model**, rates, floors, **policy_max_bank_fee_vs_gateway** for downstream policy checks.
- Honors **MISSING** (skip emit), **DELAY** (sleep + backdated timestamp), **FEE_MISMATCH** (inflate fee), **DUPLICATE** (emit same event twice).

### 7.2 Crypto exchange (`crypto_exchange_simulator`)

- Only when `path` includes `crypto_exchange` and upstream is gateway on crypto flow.
- Computes **network fee**, random **fx_rate**, **converted_amount**, emits `FX_EXECUTED`.
- Same control semantics as gateway for faults.

### 7.3 Bank (`bank_simulator`)

- Consumes from gateway **or** crypto_exchange depending on path (skips duplicate gateway leg on crypto path).
- Applies **bank fee** (rate + floor).
- Emits `SETTLED`.

---

## 8. Reconciliation engine

### 8.1 Responsibilities

- Consume `vf.events`.
- Maintain a **graph per transaction**: nodes and edges with timestamps, fees, amounts, metadata.
- Evaluate **rules** (amount continuity, fee policy, delay thresholds, duplicates, missing hops).
- Emit **incidents** with severity and localization hints.
- Publish **metrics** (counts, rates, per-node event tallies) and **series** samples for charts.
- Interact with Redis for **recent graphs**, **replay buffers**, **escalation scheduling**, etc. (see code in `store.py`, `metrics.py`, `graph.py`).

### 8.2 Key files

- `store.py` — main state machine / rule evaluation glue.
- `incidents.py` — incident construction and typing helpers.
- `graph.py` — graph topology and updates for UI.
- `app.py` — consumer loop wiring.

### 8.3 Policy / fee mismatch narrative

Gateway metadata can include **policy_max_bank_fee_vs_gateway**. The engine can surface **fee_policy_mismatch**-style incidents when bank fee behavior diverges from policy vs gateway context (demo heuristic).

### 8.4 Autocorrect (bank ledger heuristic)

Config toggles and thresholds (`autocorrect_bank_*`, `autocorrect_max_delta`) gate when the engine **nudges** display or emits `bank_ledger_autocorrect` style outcomes for small deltas—scoped as **demo UX**, not a banking core.

---

## 9. WebSocket API (`backend/services/websocket_api/app.py`)

### 9.1 Lifespan tasks

- Redis listener for graph/incident/metrics channels.
- Optional **escalation sweeper** and **source health** loop publishing aggregate health for `GET /health/sources`.

### 9.2 HTTP surface (operator + demo)

| Method | Path | Role |
|--------|------|------|
| GET | `/health` | Liveness |
| GET | `/health/sources` | Heartbeat snapshot |
| GET | `/settings/fees` | Effective fee config (defaults + Redis overrides) |
| PUT | `/settings/fees` | Patch fee overrides in Redis |
| DELETE | `/settings/fees` | Clear overrides |
| POST | `/demo/inject` | Queue `ControlCommand` to `vf.control` |
| POST | `/demo/scenario` | Deterministic scenario: queue controls for `transaction_id`, emit merchant event (`manual_demo`) |
| POST | `/escalations/immediate` | Clear SLA entry + broadcast manual escalation |
| POST | `/mock/corrections` | Append correction log + broadcast `correction` WS message |
| GET | `/tx/{tx_id}/history` | Read per-tx history list from Redis |

### 9.3 WebSocket `/ws`

- Sends **bootstrap** (recent graphs, metrics, incidents, series, source health, pending escalations).
- Streams incremental **graph**, **incident**, **metrics**, **escalation**, **correction** messages as Redis publishes them.

---

## 10. Manual demo / scenarios (`backend/common/manual_demo.py`)

### 10.1 `DemoScenarioKey` values

Covers clean path and targeted faults on gateway, crypto, or bank (`fee_mismatch_*`, `delay_*`, `duplicate_*`, `missing_*`).

### 10.2 `DemoScenarioRequest` extras

- **Payout context:** `payout_method`, beneficiary fields, `payment_purpose` — surfaced on merchant node metadata in UI.
- **Bridge context:** `bridge_asset`, `bridge_chain`, `mint_to_address`, `bridge_memo` — for crypto desk storytelling.

### 10.3 Why a dedicated module

Keeps FastAPI route thin and ensures **control commands are emitted before** the merchant event for deterministic demos (same ordering concern as synthetic merchant faults).

---

## 11. Payment ingress (`backend/services/payment_ingress`)

### 11.1 Role

HTTPS adapter that **authenticates** (optional bearer) and **maps** external PSP payloads into `TransactionEvent`, then writes to **`vf.events`** so reconciliation treats real-ish traffic like simulator traffic.

### 11.2 Surfaces

- Canonical **`POST /api/ingest/v1/event`**
- **`POST /api/ingest/v1/stripe/webhook`** demo adapter (`adapters/stripe_like.py`)

### 11.3 Operational warning

If simulators keep generating `gateway` events for the same `transaction_id` namespace as PSP tests, graphs will collide—**disable simulators** or separate ID namespaces for realistic ingress testing.

---

## 12. Fee configuration (`backend/common/fee_settings.py`)

- Redis key holds **operator overrides** for gateway/bank/crypto fee parameters used by simulators and policy checks.
- websocket-api exposes CRUD-like HTTP for the UI **Settings** module.

---

## 13. Escalation (`backend/common/escalation.py`)

- For **high/critical** incidents, schedules a **deadline** in Redis (`vf:sla:*`, sorted set `vf:escalation_due`).
- Publishes `escalation_pending` on Redis channel `vf.escalation`.
- websocket-api surfaces timers to UI; `/escalations/immediate` clears and broadcasts **manual** escalation.

---

## 14. Heartbeats (`backend/common/heartbeat.py`)

Each simulator periodically writes a **heartbeat key** in Redis. websocket-api aggregates **age** vs `VF_SOURCE_STALE_AFTER_MS` so the UI can show **stale sources** (treasury / settlement narrative).

---

## 15. Frontend (`frontend/`)

### 15.1 Build & dev proxy (`vite.config.ts`)

- Proxies **`/__veriflow` → websocket-api** (HTTP + WS rewrite) so dev uses **same origin** as the Vite server.
- Docker sets **`VERIFLOW_API_PROXY_TARGET`** to `http://websocket-api:8001`.

### 15.2 API resolution (`frontend/src/lib/veriflowEndpoints.ts`)

Priority:

1. In Vite **DEV**, use same-origin `/__veriflow` unless `VITE_VERIFLOW_DIRECT_API=true`.
2. Else `VITE_API_URL` / `VITE_WS_URL`.
3. Else hostname + port `8001` (static / LAN).

**Why:** avoids broken setups where `.env` still points to `localhost:8001` while the app runs in Docker on `:3000` only.

### 15.3 Runtime state (`VeriFlowRuntimeContext.tsx`)

Centralizes graphs, incidents, metrics, series, mismatch buckets, source health, replay flags, resolution log—so **module pages** (Treasury, Reconciliation, Reports) reuse one WebSocket-driven source of truth.

### 15.4 Persona (`PersonaContext.tsx`)

**Operator vs merchant vs bridge** changes sidebar destinations (merchant desk, bridge desk, limited nav).

### 15.5 Routes (`App.tsx` + `nav/routesConfig.ts`)

- `/` — operator dashboard (queue tabs, mismatch chart, source health, metrics, demo controls).
- `/tx/:id` — transaction detail + graph outlet.
- `/portal/merchant`, `/portal/crypto` — persona desks with forms tied to `/demo/scenario`.
- `/reversals`, `/reconciliation`, `/settlement`, `/reports`, `/settings`, `/access` — module pages for narrative depth.

### 15.6 Supporting libraries (`frontend/src/lib/`)

- `incidents.ts` — which incident types count as **mismatch** for UI queues.
- `humanize.ts` — labels for flows and incident types.
- `graphFingerprint.ts` — reduces redundant graph re-renders.
- `ws.ts` — thin WebSocket helper.

> **Repository note:** a Python `.gitignore` pattern `lib/` previously ignored `frontend/src/lib/`; this was fixed to **`/lib/`** so TypeScript helpers are tracked. If you fork old commits, cherry-pick the fix commit.

### 15.7 Charts

- `MismatchChart.tsx` — mismatch intensity over time (Recharts) fed from engine series/buckets.
- `OpsMetricsCharts.tsx` — operational charts for dashboard/reports views.

---

## 16. Environment variables (prefix `VF_`)

| Area | Examples | Purpose |
|------|-----------|---------|
| Core | `VF_KAFKA_BOOTSTRAP`, `VF_REDIS_URL`, topics | Connectivity |
| Simulator | `VF_SIMULATOR_RATE_PER_SEC`, `VF_SIMULATOR_FAULT_PROBABILITY`, `VF_SIMULATOR_INJECT_GRACE_MS` | Traffic + faults |
| Rails mix | `VF_RAIL_WEIGHT_*`, `VF_CRYPTO_FLOW_PROBABILITY` | Weighted random profiles |
| Detection | `VF_DELAY_THRESHOLD_MS`, `VF_MISSING_THRESHOLD_MS` | Delay vs missing semantics |
| Product | `VF_ESCALATION_SLA_SECONDS`, `VF_INCIDENT_TTL_MINUTES`, `VF_SOURCE_STALE_AFTER_MS` | SLA + TTL + stale detection |
| Fees | `VF_GATEWAY_FEE_MODEL`, rates, floors, `VF_POLICY_MAX_BANK_FEE_VS_GATEWAY` | Simulator + policy |
| Autocorrect | `VF_AUTOCORRECT_*`, `VF_AUTOCORRECT_BANK_*` | Mock + heuristic thresholds |
| Ingress | `VF_INGEST_*`, bearer token | PSP adapter security |
| API | `VF_API_HOST`, `VF_API_PORT` | websocket-api bind |

See `backend/common/config.py` for authoritative defaults.

---

## 17. Product modules (what each page is *for*)

### 17.1 Dashboard (`/`)

- **Signal banner** with SLA countdown when applicable.
- **Queue tabs:** All / Problems (mismatch-class incidents) / Incomplete / Resolved (mock correction + bank autocorrect log).
- **Charts:** mismatch rate buckets, ops charts, source health strip.
- **Demo controls** calling inject/scenario APIs.

### 17.2 Reconciliation (`/reconciliation`)

Crypto-bridge story: metrics, bridge-touching incidents, crypto path health, latest crypto graphs, explanatory checklist of checks.

### 17.3 Settlement / Treasury (`/settlement`)

Cut-off mindset: rail mix, bridge share, stale sources, recent flows table—same metrics family as operator view, treasury copy.

### 17.4 Portal (`/portal/*`)

Merchant outgoing payout form and bridge liquidity desk—both POST `/demo/scenario` with rich metadata for graph storytelling.

### 17.5 Reports / Reversals / Settings / Access

- **Reports** — charts + narrative exports of metrics context.
- **Reversals** — queue framing for exception handling story.
- **Settings** — live fee overrides via API.
- **Access** — lightweight persona/account framing.

---

## 18. Security & demo hygiene

- **Ingress bearer token** must be set in any shared environment.
- **Autocorrect** and **mock corrections** are explicitly **non-production** contracts.
- **Stripe adapter** does not verify real `Stripe-Signature` — demo only.

---

## 19. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| Frontend build cannot resolve `./lib/*` | Old clone missing `frontend/src/lib` | Pull latest `main` after lib/gitignore fix |
| No incidents | No faults + strict thresholds | Raise `VF_SIMULATOR_FAULT_PROBABILITY` or inject via UI/curl |
| WS connects but empty | Redis/Kafka not ready | Wait for compose health; check logs |
| Duplicate gateway events in tests | Simulator + ingress same IDs | Separate namespaces or stop simulators |

---

## 20. Documentation map

| File | Audience | Content |
|------|-----------|---------|
| [README.md](../README.md) | Engineers | Quickstart, stages, curl, rails table, ingress |
| [CODESTORM.md](../CODESTORM.md) | Jury / sponsors | Problem, market, pitch, demo checklist |
| **This handbook** | Teammates / handoff | End-to-end system story + every subsystem |

---

## 21. Changelog of major cross-cutting work (conversation-era)

1. **Crypto bridge path** as first-class graph and UI story.
2. **Synthetic fault injection** from merchant simulator + deterministic `/demo/scenario`.
3. **Dashboard queue model** (All / Problems / Incomplete / Resolved) tied to incident classes and resolution log.
4. **SLA escalation** Redis state + WebSocket events + UI countdown.
5. **Fee metadata** and **policy** mismatch class for gateway vs bank fee narrative.
6. **Merchant metadata** (`tx_kind`, transfer schemes, bridge fields) for richer operator views.
7. **payment-ingress** service for canonical + Stripe-like ingestion.
8. **Mock corrections** API + UI pathway for “suggested fix” demos.
9. **Source heartbeat** pipeline + stale visualization.
10. **Charts** (mismatch / ops) on dashboard and module pages.
11. **Persona-based navigation** (operator / merchant / bridge).
12. **English UI copy** across module pages (prior Russian strings replaced).
13. **Git ignore fix** for `frontend/src/lib` and push hygiene so GitHub clones build.

---

## 22. Roadmap (planned)

### 22.1 ML-driven autocorrection (reduce human-hours)

- **Objective:** move from rule-of-thumb `autocorrect_max_delta` and heuristics to **data-driven** suggestions on problematic transactions.  
- **Data collection:** persist structured features per incident—graph snapshots, fee/Fx legs, participant metadata, time-to-detect, operator overrides, final ledger outcome, fraud flags (if added later)—with **privacy and retention** policies.  
- **Modeling:** offline training on historical resolutions; online **ranking** of safe auto-fixes vs escalate; calibrated confidence and **explainability** for auditors.  
- **Human in the loop:** ML proposes; policy engine and humans approve until trust thresholds are met.

### 22.2 Full crypto integration in the platform

- **Objective:** treat crypto as a **first-class production rail**, not only a simulator narrative.  
- **Scope examples:** real custody / wallet balances, on-chain confirmation depth, mempool and reorg handling, DeFi bridge risk, exchange FIX/REST, treasury hedging, regulatory reporting.  
- **Engineering:** hardened ingress, secrets management, non-repudiation, idempotency across chain + bank legs, and extended graph topology beyond `CRYPTO_PATH`.

---

*Last updated to match the repository layout and configuration as of the handbook authoring. When behavior diverges, code wins—grep `VF_` in `backend/common/config.py` and the service entrypoints.*
