import { useCallback, useEffect, useRef, useState } from "react";
import type { PlacementConfig, ServerMessage } from "../types";

type MessageHandler = (msg: ServerMessage) => void;
type ErrorHandler = (error: string) => void;

export interface ConnectOptions {
  scenarioId: string;
  baseId?: string;
  placement?: PlacementConfig;
}

export interface UseWebSocketOptions {
  onMessage: MessageHandler;
  onError?: ErrorHandler;
  /** Max reconnection attempts before giving up (default: 3) */
  maxReconnectAttempts?: number;
}

export function useWebSocket(
  onMessageOrOpts: MessageHandler | UseWebSocketOptions,
) {
  // Support both legacy (just a handler function) and new (options object) call styles
  const opts: UseWebSocketOptions =
    typeof onMessageOrOpts === "function"
      ? { onMessage: onMessageOrOpts }
      : onMessageOrOpts;

  const { onMessage, onError, maxReconnectAttempts = 3 } = opts;

  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lastConnectOptsRef = useRef<ConnectOptions | string | null>(null);

  const reportError = useCallback(
    (message: string) => {
      console.error(`[SKYSHIELD WS] ${message}`);
      setConnectionError(message);
      onError?.(message);
    },
    [onError],
  );

  const connect = useCallback(
    (connectOpts: ConnectOptions | string) => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      lastConnectOptsRef.current = connectOpts;
      reconnectAttemptsRef.current = 0;
      setConnectionError(null);

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const ws = new WebSocket(`${protocol}//${host}/ws/game`);

      ws.onopen = () => {
        setConnected(true);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0;

        try {
          if (typeof connectOpts === "string") {
            ws.send(JSON.stringify({ scenario_id: connectOpts }));
          } else {
            const initMsg: Record<string, unknown> = {
              scenario_id: connectOpts.scenarioId,
            };
            if (connectOpts.baseId) {
              initMsg.base_id = connectOpts.baseId;
            }
            if (connectOpts.placement) {
              const p = connectOpts.placement;
              const placementMsg: Record<string, unknown> = {
                base_id: p.base_id,
                sensors: p.sensors,
                effectors: p.effectors,
                combined: p.combined ?? [],
              };
              if (p.boundary) placementMsg.boundary = p.boundary;
              if (p.placement_bounds_km != null) placementMsg.placement_bounds_km = p.placement_bounds_km;
              initMsg.placement = placementMsg;
            }
            ws.send(JSON.stringify(initMsg));
          }
        } catch (err) {
          reportError(
            `Failed to send init message: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;

          // Basic validation: messages must have a "type" field
          if (!msg || typeof msg !== "object" || !("type" in msg)) {
            console.warn("[SKYSHIELD WS] Received message without type field:", msg);
            return;
          }

          onMessage(msg);
        } catch (err) {
          // JSON parse error or handler error -- log but don't crash the app
          console.error(
            "[SKYSHIELD WS] Failed to process message:",
            err instanceof Error ? err.message : String(err),
            "Raw data:",
            typeof event.data === "string"
              ? event.data.slice(0, 200)
              : event.data,
          );
        }
      };

      ws.onerror = (event) => {
        console.error("[SKYSHIELD WS] Connection error:", event);
        reportError("WebSocket connection error -- server may be down");
      };

      ws.onclose = (event) => {
        setConnected(false);

        // Normal closure (1000) or going-away (1001) -- don't reconnect
        if (event.code === 1000 || event.code === 1001) {
          return;
        }

        // Abnormal closure -- try to reconnect with exponential backoff
        if (
          reconnectAttemptsRef.current < maxReconnectAttempts &&
          lastConnectOptsRef.current
        ) {
          reconnectAttemptsRef.current += 1;
          const attempt = reconnectAttemptsRef.current;
          const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);

          console.warn(
            `[SKYSHIELD WS] Connection lost (code ${event.code}). ` +
            `Reconnecting in ${delay}ms (attempt ${attempt}/${maxReconnectAttempts})...`,
          );

          setTimeout(() => {
            if (lastConnectOptsRef.current) {
              connect(lastConnectOptsRef.current);
            }
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          reportError(
            "Connection lost. Could not reconnect after multiple attempts. Check that the server is running.",
          );
        }
      };

      wsRef.current = ws;
    },
    [onMessage, maxReconnectAttempts, reportError],
  );

  const send = useCallback(
    (data: Record<string, unknown>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify(data));
        } catch (err) {
          reportError(
            `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        console.warn(
          "[SKYSHIELD WS] Attempted to send while not connected. Message dropped:",
          data,
        );
      }
    },
    [reportError],
  );

  const disconnect = useCallback(() => {
    lastConnectOptsRef.current = null; // Prevent auto-reconnect
    wsRef.current?.close(1000, "Client disconnect");
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      lastConnectOptsRef.current = null;
      wsRef.current?.close(1000, "Component unmount");
    };
  }, []);

  return { connect, send, disconnect, connected, connectionError };
}
