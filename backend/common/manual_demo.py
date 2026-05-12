"""Helpers for scripted demo payments (websocket-api /demo/scenario)."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from common.constants import (
    CRYPTO_PATH,
    PAYMENT_RAIL_CARD,
    PAYMENT_RAIL_CRYPTO,
    PAYMENT_RAIL_TRANSFER,
    STANDARD_PATH,
)
from common.models import ControlCommand, ControlType, EventType, TransactionEvent
from common.utils import new_id, now_utc


class DemoScenarioKey(StrEnum):
    CLEAN = "clean"
    FEE_MISMATCH_GATEWAY = "fee_mismatch_gateway"
    FEE_MISMATCH_CRYPTO = "fee_mismatch_crypto"
    FEE_MISMATCH_BANK = "fee_mismatch_bank"
    DELAY_GATEWAY = "delay_gateway"
    DELAY_CRYPTO = "delay_crypto"
    DELAY_BANK = "delay_bank"
    DUPLICATE_GATEWAY = "duplicate_gateway"
    DUPLICATE_BANK = "duplicate_bank"
    MISSING_GATEWAY = "missing_gateway"
    MISSING_CRYPTO = "missing_crypto"
    MISSING_BANK = "missing_bank"


class DemoScenarioRequest(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)
    currency: str = Field(default="USD", min_length=3, max_length=8)
    payment_rail: Literal["card_acquiring", "bank_transfer", "crypto_settlement"] = (
        PAYMENT_RAIL_CRYPTO
    )
    transfer_scheme: Literal["instant_local", "ach_like", "cross_border"] = "instant_local"
    scenario: DemoScenarioKey = DemoScenarioKey.CLEAN
    transaction_id: str | None = Field(default=None, max_length=128)
    delay_ms: int | None = Field(default=None, ge=400, le=120_000)
    # Optional merchant payout context (demo UI → graph node metadata)
    payout_method: Literal["bank_account", "card"] | None = None
    from_account_label: str | None = Field(default=None, max_length=120)
    beneficiary_name: str | None = Field(default=None, max_length=160)
    beneficiary_account: str | None = Field(default=None, max_length=120)
    payment_purpose: str | None = Field(default=None, max_length=240)
    # Optional bridge desk context (crypto_settlement → graph metadata)
    bridge_asset: str | None = Field(default=None, max_length=32)
    bridge_chain: str | None = Field(default=None, max_length=48)
    mint_to_address: str | None = Field(default=None, max_length=120)
    bridge_memo: str | None = Field(default=None, max_length=200)


def normalize_demo_transaction_id(raw: str | None) -> str:
    if raw and raw.strip():
        safe = "".join(c for c in raw.strip() if c.isalnum() or c in "-_")
        if safe:
            return safe[:120]
    return f"demo-{new_id('tx')}"


def _merchant_profile(
    payment_rail: str, currency: str, transfer_scheme: str
) -> dict:
    if payment_rail == PAYMENT_RAIL_CARD:
        return {
            "payment_rail": PAYMENT_RAIL_CARD,
            "flow_type": "standard",
            "path": STANDARD_PATH,
            "tx_kind": "card",
            "currency": "USD",
            "settlement_rail": "fiat_card_rtp",
            "scheme": "issuer_acquirer",
        }
    if payment_rail == PAYMENT_RAIL_TRANSFER:
        return {
            "payment_rail": PAYMENT_RAIL_TRANSFER,
            "flow_type": "standard",
            "path": STANDARD_PATH,
            "tx_kind": "transfer",
            "currency": currency.upper(),
            "settlement_rail": "account_transfer",
            "scheme": transfer_scheme,
        }
    return {
        "payment_rail": PAYMENT_RAIL_CRYPTO,
        "flow_type": "crypto",
        "path": CRYPTO_PATH,
        "tx_kind": "card",
        "currency": "USD",
        "settlement_rail": "crypto_bridge",
        "scheme": "stablecoin_bridge",
    }


def build_merchant_init_event(req: DemoScenarioRequest, transaction_id: str) -> TransactionEvent:
    prof = _merchant_profile(req.payment_rail, req.currency, req.transfer_scheme)
    cur = prof["currency"]
    meta: dict = {}
    if req.payout_method:
        meta["payout_method"] = req.payout_method
    if req.from_account_label:
        meta["from_account_label"] = req.from_account_label.strip()
    if req.beneficiary_name:
        meta["beneficiary_name"] = req.beneficiary_name.strip()
    if req.beneficiary_account:
        meta["beneficiary_account"] = req.beneficiary_account.strip()
    if req.payment_purpose:
        meta["payment_purpose"] = req.payment_purpose.strip()
    if req.bridge_asset:
        meta["bridge_asset"] = req.bridge_asset.strip()
    if req.bridge_chain:
        meta["bridge_chain"] = req.bridge_chain.strip()
    if req.mint_to_address:
        meta["mint_to_address"] = req.mint_to_address.strip()
    if req.bridge_memo:
        meta["bridge_memo"] = req.bridge_memo.strip()
    meta.update(
        {
            "path": prof["path"],
            "flow_type": prof["flow_type"],
            "payment_rail": prof["payment_rail"],
            "tx_kind": prof["tx_kind"],
            "fee_model": "none",
            "fee_basis": "merchant_gross",
            "settlement_rail": prof["settlement_rail"],
            "transfer_scheme": prof["scheme"],
            "demo_script": True,
        }
    )
    return TransactionEvent(
        event_id=new_id("evt"),
        transaction_id=transaction_id,
        node_id="merchant",
        event_type=EventType.PAYMENT_INITIATED,
        amount=round(req.amount, 2),
        currency=cur,
        fee=0.0,
        timestamp=now_utc(),
        metadata=meta,
    )


def scenario_requires_crypto_path(scenario: DemoScenarioKey) -> bool:
    return scenario in (
        DemoScenarioKey.FEE_MISMATCH_CRYPTO,
        DemoScenarioKey.DELAY_CRYPTO,
        DemoScenarioKey.MISSING_CRYPTO,
    )


def validate_scenario_for_rail(scenario: DemoScenarioKey, payment_rail: str) -> str | None:
    if scenario == DemoScenarioKey.CLEAN:
        return None
    if scenario_requires_crypto_path(scenario) and payment_rail != PAYMENT_RAIL_CRYPTO:
        return "This scenario needs payment_rail=crypto_settlement (gateway → exchange → bank)."
    return None


def build_control_commands_for_scenario(
    scenario: DemoScenarioKey,
    transaction_id: str,
    delay_override_ms: int | None,
) -> list[ControlCommand]:
    if scenario == DemoScenarioKey.CLEAN:
        return []

    def cmd(
        ctype: ControlType,
        target: str,
        delay_ms: int | None = None,
    ) -> ControlCommand:
        return ControlCommand(
            command_id=new_id("cmd"),
            type=ctype,
            target_node=target,
            count=1,
            delay_ms=delay_ms,
            transaction_id=transaction_id,
            created_at=now_utc(),
        )

    d_gw = delay_override_ms or 2000
    d_cr = delay_override_ms or 2200
    d_bk = delay_override_ms or 2500

    match scenario:
        case DemoScenarioKey.FEE_MISMATCH_GATEWAY:
            return [cmd(ControlType.FEE_MISMATCH, "gateway")]
        case DemoScenarioKey.FEE_MISMATCH_CRYPTO:
            return [cmd(ControlType.FEE_MISMATCH, "crypto_exchange")]
        case DemoScenarioKey.FEE_MISMATCH_BANK:
            return [cmd(ControlType.FEE_MISMATCH, "bank")]
        case DemoScenarioKey.DELAY_GATEWAY:
            return [cmd(ControlType.DELAY, "gateway", d_gw)]
        case DemoScenarioKey.DELAY_CRYPTO:
            return [cmd(ControlType.DELAY, "crypto_exchange", d_cr)]
        case DemoScenarioKey.DELAY_BANK:
            return [cmd(ControlType.DELAY, "bank", d_bk)]
        case DemoScenarioKey.DUPLICATE_GATEWAY:
            return [cmd(ControlType.DUPLICATE, "gateway")]
        case DemoScenarioKey.DUPLICATE_BANK:
            return [cmd(ControlType.DUPLICATE, "bank")]
        case DemoScenarioKey.MISSING_GATEWAY:
            return [cmd(ControlType.MISSING, "gateway")]
        case DemoScenarioKey.MISSING_CRYPTO:
            return [cmd(ControlType.MISSING, "crypto_exchange")]
        case DemoScenarioKey.MISSING_BANK:
            return [cmd(ControlType.MISSING, "bank")]
    return []
