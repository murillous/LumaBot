export type BotStatus =
  | "stopped"
  | "starting"
  | "connecting"
  | "qr_wait"
  | "running"
  | "error";

export interface StatusResponse {
  status: BotStatus;
  uptime: number;
  reconnects: number;
  pid: number | null;
  hasQR: boolean;
  qr: string | null;
  publicUrl: string | null;
}

export type LogLevel = "info" | "warn" | "error" | "success";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

export interface ConfigField {
  key: string;
  source: "env" | "config";
  section?: string;
  label: string;
  type: "text" | "number" | "boolean" | "secret" | "select" | "textarea" | "json";
  options?: string[];
  placeholder?: string;
  advanced?: boolean;
  step?: number;
  min?: number;
  max?: number;
  value: unknown;
}

export interface ConfigGroup {
  id: string;
  title: string;
  description?: string;
  fields: ConfigField[];
}

export interface ConfigChange {
  key: string;
  source: "env" | "config";
  section?: string;
  value: unknown;
}

export interface WaUser {
  jid: string;
  displayName: string;
  nickname: string;
  pushName: string;
  lastSeen: string;
}

export interface RankingEntry {
  jid: string;
  name: string;
  count: number;
  lastAt: string;
}

export interface Reminder {
  id: number;
  chatJid: string;
  isGroup: boolean;
  creatorJid: string;
  mentionJids: string[];
  text: string;
  fireAt: number;
  fired: boolean;
}

export type WsEvent =
  | { type: "init"; status: BotStatus; qr: string | null; publicUrl: string | null; logs: LogEntry[] }
  | { type: "log"; timestamp: number; level: LogLevel; message: string }
  | { type: "status"; status: BotStatus }
  | { type: "qr"; dataUrl: string }
  | { type: "qr_clear" }
  | { type: "tunnel_url"; url: string | null };
