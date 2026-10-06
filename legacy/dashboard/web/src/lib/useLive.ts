import { useEffect, useRef, useState, useCallback } from "react";
import type { BotStatus, LogEntry, WsEvent } from "./types";

const MAX_LOGS = 500;

export interface LiveState {
  status: BotStatus;
  qr: string | null;
  publicUrl: string | null;
  logs: LogEntry[];
  connected: boolean;
}

/**
 * Mantém o estado ao vivo do bot via WebSocket, com reconexão exponencial.
 * O servidor envia um evento `init` com o estado completo ao conectar.
 */
export function useLive(): LiveState {
  const [status, setStatus] = useState<BotStatus>("stopped");
  const [qr, setQr] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);

  const connect = useCallback(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retryRef.current = 0;
    };

    ws.onmessage = (ev) => {
      let data: WsEvent;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (data.type) {
        case "init":
          setStatus(data.status);
          setQr(data.qr);
          setPublicUrl(data.publicUrl);
          setLogs(data.logs ?? []);
          break;
        case "status":
          setStatus(data.status);
          break;
        case "log":
          setLogs((prev) => {
            const next = [...prev, { timestamp: data.timestamp, level: data.level, message: data.message }];
            return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
          });
          break;
        case "qr":
          setQr(data.dataUrl);
          break;
        case "qr_clear":
          setQr(null);
          break;
        case "tunnel_url":
          setPublicUrl(data.url);
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (closedRef.current) return;
      const delay = Math.min(1000 * 2 ** retryRef.current++, 15000);
      setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  return { status, qr, publicUrl, logs, connected };
}
