from __future__ import annotations

from .utils import approx_equal


def safe_approx_equal(left: float | None, right: float | None, tol: float = 0.01) -> bool:
    if left is None or right is None:
        return False
    return approx_equal(left, right, tol)
