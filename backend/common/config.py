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

    simulator_rate_per_sec: float = 2.0
    simulator_jitter_ms: int = 200

    delay_threshold_ms: int = 2000
    missing_threshold_ms: int = 5000

    incident_ttl_minutes: int = 15

    max_recent_transactions: int = 30
    replay_buffer_size: int = 200

    api_host: str = "0.0.0.0"
    api_port: int = 8001
