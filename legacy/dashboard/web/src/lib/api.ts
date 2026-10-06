import type {
  ConfigChange,
  ConfigGroup,
  RankingEntry,
  Reminder,
  StatusResponse,
  WaUser,
} from "./types";

/** Erro com status HTTP para o caller distinguir 401 (não autenticado). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      /* corpo não-JSON */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  login: (password: string) =>
    request<{ ok: boolean; token: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  status: () => request<StatusResponse>("/api/status"),
  stats: () => request<Record<string, number>>("/api/stats"),

  botStart: () => request("/api/bot/start", { method: "POST" }),
  botStop: () => request("/api/bot/stop", { method: "POST" }),
  botRestart: () => request("/api/bot/restart", { method: "POST" }),

  getConfig: () => request<{ groups: ConfigGroup[] }>("/api/config"),
  saveConfig: (changes: ConfigChange[]) =>
    request("/api/config", { method: "PUT", body: JSON.stringify({ changes }) }),

  users: () => request<WaUser[]>("/api/users"),
  setNickname: (jid: string, nickname: string) =>
    request(`/api/users/${encodeURIComponent(jid)}/nick`, {
      method: "PUT",
      body: JSON.stringify({ nickname }),
    }),

  ranking: (scope: "global" | "group", jid?: string) =>
    request<RankingEntry[]>(
      `/api/ranking?scope=${scope}${jid ? `&jid=${encodeURIComponent(jid)}` : ""}`
    ),

  reminders: () => request<Reminder[]>("/api/reminders"),
  cancelReminder: (id: number) => request(`/api/reminders/${id}`, { method: "DELETE" }),
};
