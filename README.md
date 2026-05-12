# VeriFlow

**Hackathon — CodeStorm team, case 1.** Jury pitch (problem, market, competitors, team): [CODESTORM.md](./CODESTORM.md). Defense / demo checklist and mentor meeting notes are there too, **sections 9–10**.

Realtime **fiat + crypto settlement** reconciliation: it reconstructs payment flows where a
**crypto / FX bridge** (gateway → exchange → bank) is as important as classic card rails, detects
mismatches in amounts, network fees, and FX legs, and streams live graph updates over WebSockets.

Think: Grafana or Datadog for **cross-asset** transaction integrity.

## Goals

- Ingest transaction events from multiple mock financial services (**strong focus on the crypto /
  stablecoin bridge path** alongside fiat RTP)
- Reconstruct a transaction graph in realtime, including **FX and network-fee hops**
- Detect mismatches, delays, duplicates, and missing hops
- Localize where the inconsistency was introduced
- Visualize transaction flows live with animated graph edges
- Provide metrics and fee analysis
- Support replay mode and demo fault injection

## Stack

Backend: Python 3.12, FastAPI, asyncio, aiokafka, Redis, WebSockets
Frontend: React, Vite, Tailwind, React Flow, Recharts
Infra: Docker Compose, Kafka, Zookeeper, Redis

## Quickstart

```bash
docker compose up --build
```

On first boot, **Kafka** can take up to ~1 minute before the healthcheck passes; other services wait for `kafka: service_healthy` so they do not crash with `Connect call failed` to `kafka:9092`.

- Frontend: http://localhost:3000 — in `npm run dev` / Docker dev, the UI calls **`/__veriflow`** on the same origin (Vite proxies to websocket-api). This applies even if you still have `VITE_API_URL=http://localhost:8001` in a local `.env` (that URL is ignored in dev unless you set **`VITE_VERIFLOW_DIRECT_API=true`**). Direct API for curl: http://localhost:8001
- Redis on host (for CLI/debug): **localhost:16379** (mapped from container 6379 to avoid clashes with a system Redis on 6379)

## Services

- merchant-simulator: emits new merchant events into Kafka with a **weighted mix of payment rails**
  (**card acquiring**, **bank transfer** with UZS/USD/EUR + `transfer_scheme`, **crypto settlement**
  over `CRYPTO_PATH`). Tune relative volumes with `VF_RAIL_WEIGHT_CARD`, `VF_RAIL_WEIGHT_TRANSFER`,
  `VF_RAIL_WEIGHT_CRYPTO`; `VF_CRYPTO_FLOW_PROBABILITY` scales the crypto rail weight only (not
  card or transfer).
- gateway-simulator: transforms merchant events, applies fees, and forwards
- crypto-exchange-simulator: **primary demo differentiator** — on-chain-style leg with network fee,
  FX conversion to settlement currency, then hand-off to the bank simulator
- bank-simulator: final settlement events
- reconciliation-engine: builds transaction graphs, detects incidents, publishes updates
- payment-ingress: **HTTP ingress for real PSPs** — authenticated webhooks → Kafka `vf.events`
  (canonical JSON or minimal Stripe-like payloads); see "Real payment gateways" below

## Event Model

```json
{
	"transaction_id": "tx-1001",
	"node_id": "gateway",
	"event_type": "PAYMENT_PROCESSED",
	"amount": 103,
	"currency": "USD",
	"fee": 3,
	"timestamp": "2026-05-11T12:00:00Z",
	"metadata": {}
}
```

## Stages

### Stage 1: Infra + Kafka

Architecture: Zookeeper + Kafka for event streaming, Redis for realtime pub/sub and caching,
Docker Compose to orchestrate services.

Folder structure:

- infra/
- docker-compose.yml

Commands:

```bash
docker compose up --build
```

Test scenario:

- Verify Kafka and Redis containers are healthy
- Open http://localhost:3000 once frontend is running

### Stage 2: Event Simulators

Architecture: Merchant emits new transactions. Gateway, crypto exchange, and bank consume
upstream events and produce downstream events with optional fault injection.

Folder structure:

- backend/services/merchant_simulator
- backend/services/gateway_simulator
- backend/services/crypto_exchange_simulator
- backend/services/bank_simulator

Commands:

```bash
docker compose up --build merchant-simulator gateway-simulator crypto-exchange-simulator bank-simulator
```

Test scenario:

- Watch logs to confirm chained events (merchant → gateway → bank or crypto leg)
- Verify traffic rotates across **card**, **bank transfer**, and **crypto** rails

### Stage 3: Reconciliation Engine

Architecture: Consumes events, builds an evolving transaction graph per transaction_id, and
evaluates reconciliation rules with edge-level fault localization.

Folder structure:

- backend/services/reconciliation_engine

Commands:

```bash
docker compose up --build reconciliation-engine
```

Test scenario:

- Confirm graph updates are published to Redis channels
- Induce a fee mismatch and verify incident generation

### Stage 4: WebSocket API

Architecture: Subscribes to Redis pub/sub and pushes graph, incident, and metrics updates to
connected clients. Provides /demo/inject API for fault injection.

Folder structure:

- backend/services/websocket_api

Commands:

```bash
docker compose up --build websocket-api
```

Test scenario:

- Open WebSocket connection to ws://localhost:8001/ws
- Confirm bootstrap payload includes recent graphs and metrics

### Stage 5: Frontend Graph Dashboard

Architecture: React Flow renders the live transaction graph with animated edges. Metrics and
incidents update in realtime via WebSocket.

Folder structure:

- frontend/src

Commands:

```bash
docker compose up --build frontend
```

Test scenario:

- Graph should animate on incoming events
- Metrics and incident panels update live

### Stage 6: Incident Engine

Architecture: Rules evaluate fee-based transformations, FX conversions, and settlement
mismatches with confidence scoring and localization.

Folder structure:

- backend/services/reconciliation_engine/incidents.py
- backend/services/reconciliation_engine/store.py

Commands:

```bash
docker compose up --build reconciliation-engine
```

Test scenario:

- Inject fee mismatch on gateway and verify incident severity and edge localization

### Stage 7: Demo Scenarios

Architecture: Demo controls publish commands to a Kafka control topic. Simulators consume
control events and apply the injected fault on the next event.

Folder structure:

- backend/services/websocket_api/app.py
- backend/common/injection.py
- backend/common/manual_demo.py

Commands:

```bash
curl -X POST http://localhost:8001/demo/inject -H "Content-Type: application/json" \
	-d '{"type": "fee_mismatch", "target_node": "gateway", "count": 1}'
```

Deterministic scripted payment (control hooks keyed to one `transaction_id`, then merchant event):

```bash
curl -X POST http://localhost:8001/demo/scenario -H "Content-Type: application/json" \
	-d '{"amount":150,"currency":"USD","payment_rail":"crypto_settlement","scenario":"fee_mismatch_crypto"}'
```

Test scenario:

- Use the dashboard **Scripted payment** panel or `/demo/scenario` to pick rail + scenario (clean vs fault) on a known `transaction_id`
- Use the quick **Demo mode** buttons or `/demo/inject` for the next matching hop (any tx)
- Observe edge color changes and incident stream

## Reconciliation Rules

**Crypto / FX path (primary demo narrative):**

- crypto.amount = gateway.amount - network_fee
- converted_amount = crypto.amount * fx_rate
- bank.amount = converted_amount - bank.fee

**Standard fiat path (comparison baseline):**

- gateway.amount = merchant.amount + gateway.fee
- bank.amount = gateway.amount - bank.fee

## Payment rails (card, transfer, crypto)

The merchant simulator sets `metadata.payment_rail` on the first hop. The reconciliation engine
copies it to `GraphSnapshot.payment_rail` for the UI. **payment-ingress** can set the same value
either in `metadata.payment_rail` or as top-level `payment_rail` on the canonical ingest body.

| `payment_rail` value   | Typical `flow_type` | Graph path (`path` metadata)              | Notes                                      |
| ------------------------ | ------------------- | ----------------------------------------- | ------------------------------------------ |
| `card_acquiring`         | `standard`          | `merchant → gateway → bank`               | Card RTP / acquirer-style demo             |
| `bank_transfer`          | `standard`          | `merchant → gateway → bank`               | `transfer_scheme` + currency in metadata   |
| `crypto_settlement`      | `crypto`            | `merchant → gateway → crypto_exchange → bank` | Network fee + optional FX leg              |

## Directory Structure (Top Level)

```
backend/
	common/
	services/
frontend/
	src/
infra/
	kafka/
	redis/
docker-compose.yml
```

## Product context (stakeholder notes)

**Synthetic traffic mix.** The merchant simulator rotates **card acquiring**, **bank transfer**, and
**crypto settlement** rails (see table above). Crypto flows use `CRYPTO_PATH` so the engine reconciles
**gateway → crypto_exchange (network fee + FX) → bank (fiat settlement)** and emits incidents for
**FX** and **network-fee** mismatches. **Regulation** (licensing of exchange activity, travel rule,
custody, and national crypto acceptance frameworks) is jurisdiction-specific and must be validated
outside this repo.

**Scope (non-crypto).** VeriFlow still covers **classic fiat hops** (merchant → gateway → bank) for
card and transfer rails. It is **not** an anti-fraud product.

**Markets.** The architecture fits **Uzbekistan** (where **banks and payment systems are often
distinct legal/technical actors**) and **global** schemes: the same event graph and rules engine
apply when participants change.

**Typical flow.** In production, reconciliation usually runs **after authorization / clearing**
steps along a **5–6 hop** settlement chain (merchant → PSP/host → switch/processing →
gateway/acquirer → settlement bank → ledger). The demo uses a **shortened** path (`STANDARD_PATH`
/ `CRYPTO_PATH` in `backend/common/constants.py`) to stay within hackathon time; extending to more
hops means adding emitters that publish `TransactionEvent`s for each hop.

**Operational windows.** **End-of-day batch** reconciliation is common in banks; **stream
keepalive** in this repo tracks simulator heartbeats in Redis so the UI can show a **stale
source** if a feed stops. **Missing-hop** detection defaults to a **60s** idle window in code
(`VF_MISSING_THRESHOLD_MS`); `docker-compose` sets **5s** for snappy demos. Tune per environment.

**Autocorrection.** `POST /mock/corrections` marks requests **auto-eligible** only when
`|delta_amount| ≤ VF_AUTOCORRECT_MAX_DELTA` (default **5** in the same currency unit). A
**dataset-backed** policy for real adjustments is **not included**—that remains a research /
integration task.

**Throughput.** Simulators use a **configurable rate**, not a fixed RPS contract. Horizontal scale
follows the usual Kafka consumer-group pattern (more engine replicas, shared topics).

## HTTP helpers (websocket-api)

- `GET /health/sources` — Redis heartbeat snapshot for simulators.
- `POST /escalations/immediate` — body `{ "incident_id", "transaction_id" }` clears SLA timer and
  broadcasts a manual escalation event.
- `POST /mock/corrections` — body `{ "transaction_id", "node_id", "delta_amount" }`; response
  includes `auto_eligible` when `|delta_amount| ≤ VF_AUTOCORRECT_MAX_DELTA`.

## Real payment gateways (ingress)

VeriFlow’s engine only speaks **`TransactionEvent` on Kafka topic `vf.events`**. Real PSPs
(Payme, Click, Stripe, local acquirers, etc.) never publish Kafka directly — you put a **small
integration layer** (BFF, API Gateway, or this repo’s `payment-ingress`) in front that:

1. Receives the PSP’s native webhook / callback (HTTPS, often signed).
2. Validates signatures and **idempotency** (store PSP event ids; reject duplicates).
3. Maps fields to VeriFlow’s canonical shape and **HTTP POST**s to `payment-ingress`, which then
   publishes to Kafka so reconciliation sees the same graph as from simulators.

**Service:** `payment-ingress` (port **8002** in Docker Compose). OpenAPI: `http://localhost:8002/docs`.

**Auth:** set `VF_INGEST_BEARER_TOKEN`. Requests must send `Authorization: Bearer <token>`.
If the token is empty, auth is disabled (**local demo only**).

**Canonical ingest (recommended for Payme / Click / any PSP):** your service translates the PSP
payload into JSON and posts:

```bash
curl -sS -X POST "http://localhost:8002/api/ingest/v1/event" \
  -H "Authorization: Bearer dev-ingest-token-change-in-prod" \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "order-merchant-12345",
    "node_id": "gateway",
    "event_type": "PAYMENT_PROCESSED",
    "amount": 150000.0,
    "currency": "UZS",
    "fee": 1500.0,
    "payment_rail": "bank_transfer",
    "metadata": { "psp": "payme", "psp_payment_id": "..." }
  }'
```

Use the **same `transaction_id`** as your merchant / order system emits in the first hop so hops
match in one graph. `node_id` should match the graph role reconciliation expects (usually
`gateway` unless you extend `STANDARD_PATH` / `CRYPTO_PATH` in `backend/common/constants.py`).

**Stripe-shaped demo:** `POST /api/ingest/v1/stripe/webhook` with a minimal `payment_intent.succeeded`
body (see `adapters/stripe_like.py`). Production Stripe requires **`Stripe-Signature`** verification
and their SDK — not implemented here.

**Simulators vs production:** if you keep `gateway-simulator` running, it may still emit synthetic
`gateway` events for the same ids as your real PSP — disable the simulator or separate
`transaction_id` namespaces when testing real traffic.

## Demo Tips

- Use the demo buttons to force mismatches and delays
- Watch edge colors: green healthy, yellow delayed, red mismatch
- Switch recent transactions in the list to inspect different flows