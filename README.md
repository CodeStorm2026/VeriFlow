# VeriFlow

Realtime transaction reconciliation and observability platform. It reconstructs distributed
financial transaction flows from independent events, detects inconsistencies, localizes where
they were introduced, and streams live graph updates over WebSockets.

Think: Grafana or Datadog for transaction integrity.

## Goals

- Ingest transaction events from multiple mock financial services
- Reconstruct a transaction graph in realtime
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

- Frontend: http://localhost:3000
- WebSocket API: http://localhost:8001

## Services

- merchant-simulator: emits new merchant events into Kafka
- gateway-simulator: transforms merchant events, applies fees, and forwards
- crypto-exchange-simulator: optional FX path with network fees
- bank-simulator: final settlement events
- reconciliation-engine: builds transaction graphs, detects incidents, publishes updates
- websocket-api: broadcasts live updates to the frontend, provides demo injection API
- frontend: realtime dashboard with graph and metrics

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

- Watch logs to confirm chained events (merchant -> gateway -> bank)
- Verify some transactions use the crypto path

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

Commands:

```bash
curl -X POST http://localhost:8001/demo/inject -H "Content-Type: application/json" \
	-d '{"type": "fee_mismatch", "target_node": "gateway", "count": 1}'
```

Test scenario:

- Use the frontend demo buttons to inject delay, duplicates, missing hops
- Observe edge color changes and incident stream

## Reconciliation Rules

Standard path:

- gateway.amount = merchant.amount + gateway.fee
- bank.amount = gateway.amount - bank.fee

Crypto path:

- crypto.amount = gateway.amount - network_fee
- converted_amount = crypto.amount * fx_rate
- bank.amount = converted_amount - bank.fee

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

## Demo Tips

- Use the demo buttons to force mismatches and delays
- Watch edge colors: green healthy, yellow delayed, red mismatch
- Switch recent transactions in the list to inspect different flows