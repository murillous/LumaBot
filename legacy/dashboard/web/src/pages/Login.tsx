import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Input } from "@/components/ui";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Senha incorreta." : "Falha ao conectar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent font-display text-2xl font-bold text-white shadow-glow">
            L
          </div>
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Luma <span className="gradient-text">Console</span>
            </h1>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">acesso restrito</p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            type="password"
            autoFocus
            placeholder="Senha do dashboard"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button type="submit" size="lg" disabled={loading} className="mt-1">
            {loading ? "Entrando…" : "Entrar"}
          </Button>
        </form>

        <div className="hairline mt-8" />
        <p className="mt-4 text-center font-mono text-[10px] text-muted">LumaBot · WhatsApp AI · Thera</p>
      </div>
    </div>
  );
}
