import type { WsMessage } from "../types";

export function connectWebSocket(url: string, onMessage: (msg: WsMessage) => void): WebSocket {
  const socket = new WebSocket(url);
  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage;
      onMessage(msg);
    } catch {
      // ignore malformed frames
    }
  };
  return socket;
}
