from __future__ import annotations

from typing import Any

import orjson
from pydantic import BaseModel


def to_json(value: Any) -> str:
    if isinstance(value, BaseModel):
        return orjson.dumps(value.model_dump()).decode("utf-8")
    return orjson.dumps(value).decode("utf-8")
