from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_TRUST_SCORES = {
    "bank": 1.0,
    "gateway": 0.8,
    "merchant": 0.6,
    "crypto_exchange": 0.7,
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="VF_",
        env_file=".env",
        case_sensitive=False,
    )

    service_name: str = "service"
    node_id: str = "node"

    kafka_bootstrap: str = "kafka:9092"
    kafka_events_topic: str = "vf.events"
    kafka_control_topic: str = "vf.control"

    redis_url: str = "redis://redis:6379/0"

    simulator_rate_per_sec: float = 5.0
    simulator_jitter_ms: int = 200
    # Merchant simulator: queue ControlCommand before PAYMENT_INITIATED (fee/delay/dup/missing).
    simulator_fault_probability: float = 0.18
    # Pause after publishing control so simulators ingest the hook before the merchant event.
    simulator_inject_grace_ms: int = 200
    # Share of synthetic traffic routed through gateway → crypto_exchange → bank (FX + network fee).
    # Used only when merchant picks crypto_settlement rail; card/transfer rails ignore this.
    crypto_flow_probability: float = 0.58

    # Relative mix of payment rails in merchant simulator (card vs bank transfer vs crypto bridge).
    rail_weight_card: float = 1.0
    rail_weight_transfer: float = 1.0
    rail_weight_crypto: float = 1.0

    delay_threshold_ms: int = 2000
    # Missing-hop detection: production-style window (e.g. EOD batch context).
    # Override with VF_MISSING_THRESHOLD_MS=5000 for fast hackathon demos.
    missing_threshold_ms: int = 60000

    incident_ttl_minutes: int = 15

    escalation_sla_seconds: int = 120

    heartbeat_interval_sec: float = 5.0
    # Source stream considered stale if no heartbeat (operator keepalive / stream health).
    source_stale_after_ms: int = 60000

    # Mock autocorrection API threshold (POST /mock/corrections).
    autocorrect_max_delta: float = 5.0
    # Heuristic: trust bank posting is wrong; auto-nudge display when |Δ| in [min, max].
    autocorrect_bank_ledger_enabled: bool = True
    autocorrect_bank_max_delta: float = 5.0
    autocorrect_bank_min_abs_delta: float = 0.01

    # --- Fee model (synthetic simulators + reconciliation) ---
    # Only sender-pays is implemented: fees never reduce the principal amount passed to the recipient hop.
    fee_payer: str = "sender"
    gateway_fee_model: str = "percent"  # percent | fixed
    gateway_fee_rate: float = 0.02
    gateway_fixed_fee: float = 0.0
    bank_fee_rate: float = 0.005
    bank_fee_floor: float = 0.3
    crypto_network_fee_rate: float = 0.005
    crypto_network_fee_floor: float = 0.5
    policy_max_bank_fee_vs_gateway: float = 2.5

    max_recent_transactions: int = 30
    replay_buffer_size: int = 200

    api_host: str = "0.0.0.0"
    api_port: int = 8001

    # payment-ingress: HTTP webhooks from real PSPs → Kafka vf.events
    ingest_host: str = "0.0.0.0"
    ingest_port: int = 8002
    # Set VF_INGEST_BEARER_TOKEN in production. Empty = auth disabled (local demo only).
    ingest_bearer_token: str = ""
    # Map Stripe-like webhooks to this node_id (reconciliation graph expects "gateway" by default).
    ingest_default_node_id: str = "gateway"
