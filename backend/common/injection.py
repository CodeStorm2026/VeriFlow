from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from .models import ControlCommand, ControlType


@dataclass
class InjectionPlan:
    type: ControlType
    target_node: str | None
    remaining: int
    transaction_id: str | None
    delay_ms: int | None
    expires_at: datetime | None


class InjectionController:
    def __init__(self) -> None:
        self._plans: list[InjectionPlan] = []

    def add(self, command: ControlCommand) -> None:
        expires_at: datetime | None = None
        if command.delay_ms and command.delay_ms > 0:
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=60)
        self._plans.append(
            InjectionPlan(
                type=command.type,
                target_node=command.target_node,
                remaining=max(1, command.count),
                transaction_id=command.transaction_id,
                delay_ms=command.delay_ms,
                expires_at=expires_at,
            )
        )

    def consume(self, node_id: str, transaction_id: str) -> InjectionPlan | None:
        now = datetime.now(timezone.utc)
        for plan in list(self._plans):
            if plan.expires_at and plan.expires_at < now:
                self._plans.remove(plan)
                continue
            if plan.target_node and plan.target_node != node_id:
                continue
            if plan.transaction_id and plan.transaction_id != transaction_id:
                continue
            if plan.remaining <= 0:
                self._plans.remove(plan)
                continue
            plan.remaining -= 1
            if plan.remaining <= 0:
                self._plans.remove(plan)
            return plan
        return None
