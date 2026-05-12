"""Runtime fee parameters: env defaults (Settings) + optional Redis overrides (vf:fee_settings)."""

from __future__ import annotations

from typing import Any

import orjson
from pydantic import BaseModel, Field, field_validator
from redis.asyncio import Redis

from common.config import Settings

FEE_SETTINGS_REDIS_KEY = "vf:fee_settings"

_FLOAT_KEYS = (
    "gateway_fee_rate",
    "gateway_fixed_fee",
    "bank_fee_rate",
    "bank_fee_floor",
    "crypto_network_fee_rate",
    "crypto_network_fee_floor",
    "policy_max_bank_fee_vs_gateway",
)


def defaults_from_settings(settings: Settings) -> dict[str, Any]:
    return {
        "fee_payer": settings.fee_payer,
        "gateway_fee_model": settings.gateway_fee_model,
        "gateway_fee_rate": settings.gateway_fee_rate,
        "gateway_fixed_fee": settings.gateway_fixed_fee,
        "bank_fee_rate": settings.bank_fee_rate,
        "bank_fee_floor": settings.bank_fee_floor,
        "crypto_network_fee_rate": settings.crypto_network_fee_rate,
        "crypto_network_fee_floor": settings.crypto_network_fee_floor,
        "policy_max_bank_fee_vs_gateway": settings.policy_max_bank_fee_vs_gateway,
    }


def _parse_redis_overrides(raw: str | bytes) -> dict[str, Any]:
    try:
        b = raw.encode("utf-8") if isinstance(raw, str) else raw
        data = orjson.loads(b)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def parse_stored_fee_overrides(raw: str | bytes | None) -> dict[str, Any]:
    if not raw:
        return {}
    return _parse_redis_overrides(raw)


def _coerce_merged(base: dict[str, Any], settings: Settings) -> dict[str, Any]:
    out = dict(base)
    fall = defaults_from_settings(settings)
    out["fee_payer"] = "sender"
    model = str(out.get("gateway_fee_model", "percent")).lower()
    out["gateway_fee_model"] = model if model in ("percent", "fixed") else "percent"
    for key in _FLOAT_KEYS:
        try:
            out[key] = float(out[key])
        except (TypeError, ValueError):
            out[key] = fall[key]
    out["gateway_fee_rate"] = max(0.0, min(1.0, float(out["gateway_fee_rate"])))
    out["bank_fee_rate"] = max(0.0, min(1.0, float(out["bank_fee_rate"])))
    out["crypto_network_fee_rate"] = max(0.0, min(1.0, float(out["crypto_network_fee_rate"])))
    out["bank_fee_floor"] = max(0.0, float(out["bank_fee_floor"]))
    out["crypto_network_fee_floor"] = max(0.0, float(out["crypto_network_fee_floor"]))
    out["gateway_fixed_fee"] = max(0.0, float(out["gateway_fixed_fee"]))
    out["policy_max_bank_fee_vs_gateway"] = max(0.01, float(out["policy_max_bank_fee_vs_gateway"]))
    return out


async def load_fee_settings(redis: Redis, settings: Settings) -> dict[str, Any]:
    base = defaults_from_settings(settings)
    raw = await redis.get(FEE_SETTINGS_REDIS_KEY)
    if raw:
        ov = parse_stored_fee_overrides(raw)
        for k, v in ov.items():
            if k in base and v is not None:
                base[k] = v
    return _coerce_merged(base, settings)


class FeeSettingsPublic(BaseModel):
    """Serializable fee config for API / UI."""

    fee_payer: str = Field(description="Only sender is supported.")
    gateway_fee_model: str
    gateway_fee_rate: float
    gateway_fixed_fee: float
    bank_fee_rate: float
    bank_fee_floor: float
    crypto_network_fee_rate: float
    crypto_network_fee_floor: float
    policy_max_bank_fee_vs_gateway: float


class FeeSettingsPatch(BaseModel):
    gateway_fee_model: str | None = None
    gateway_fee_rate: float | None = None
    gateway_fixed_fee: float | None = None
    bank_fee_rate: float | None = None
    bank_fee_floor: float | None = None
    crypto_network_fee_rate: float | None = None
    crypto_network_fee_floor: float | None = None
    policy_max_bank_fee_vs_gateway: float | None = None

    @field_validator("gateway_fee_model")
    @classmethod
    def _gateway_fee_model(cls, v: str | None) -> str | None:
        if v is None:
            return v
        x = v.strip().lower()
        if x not in ("percent", "fixed"):
            raise ValueError("gateway_fee_model must be 'percent' or 'fixed'")
        return x
