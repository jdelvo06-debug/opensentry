import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMessage } from "../types";

type MessageHandler = (msg: ServerMessage) => void;

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(
    (scenarioId: string) => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const ws = new WebSocket(`${protocol}//${host}/ws/game`);

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ scenario_id: scenarioId }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMessage;
        onMessage(msg);
      };

      ws.onclose = () => {
        setConnected(false);
      };

      wsRef.current = ws;
    },
    [onMessage],
  );

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { connect, send, disconnect, connected };
}
