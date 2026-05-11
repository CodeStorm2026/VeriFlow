from __future__ import annotations

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._active: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._active.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._active.discard(websocket)

    async def broadcast_raw(self, message: str) -> None:
        dead: set[WebSocket] = set()
        for websocket in self._active:
            try:
                await websocket.send_text(message)
            except Exception:
                dead.add(websocket)
        for websocket in dead:
            self.disconnect(websocket)
