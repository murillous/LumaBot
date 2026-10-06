import type { BotStatus } from "./types";

export interface StatusMeta {
  label: string;
  tone: "neutral" | "primary" | "accent" | "success" | "warn" | "danger";
  dot: string;
  pulse: boolean;
}

export function statusMeta(status: BotStatus): StatusMeta {
  switch (status) {
    case "running":
      return { label: "Online", tone: "success", dot: "rgb(var(--success))", pulse: false };
    case "connecting":
      return { label: "Conectando", tone: "warn", dot: "rgb(var(--warn))", pulse: true };
    case "qr_wait":
      return { label: "Aguardando QR", tone: "accent", dot: "rgb(var(--accent))", pulse: true };
    case "starting":
      return { label: "Iniciando", tone: "warn", dot: "rgb(var(--warn))", pulse: true };
    case "error":
      return { label: "Erro", tone: "danger", dot: "rgb(var(--danger))", pulse: false };
    default:
      return { label: "Offline", tone: "neutral", dot: "rgb(var(--muted))", pulse: false };
  }
}
