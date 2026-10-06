import { useEffect, useState } from "react";
import { Play, Square, RotateCw, Cpu, Clock, Plug, Sparkles, Image, Film, Download } from "lucide-react";
import { api } from "@/lib/api";
import { statusMeta } from "@/lib/status";
import { formatUptime } from "@/lib/utils";
import type { BotStatus, StatusResponse } from "@/lib/types";
import { Button, Card, CardContent, Badge } from "@/components/ui";

interface Props {
  status: BotStatus;
  qr: string | null;
  publicUrl: string | null;
}

const METRIC_DEFS: { key: string; label: string; icon: typeof Sparkles }[] = [
  { key: "ai_responses", label: "Respostas IA", icon: Sparkles },
  { key: "stickers_created", label: "Figurinhas", icon: Image },
  { key: "gifs_created", label: "GIFs", icon: Film },
  { key: "videos_downloaded", label: "Downloads", icon: Download },
];

export function Overview({ status, qr, publicUrl }: Props) {
  const [info, setInfo] = useState<StatusResponse | null>(null);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const meta = statusMeta(status);

  useEffect(() => {
    const load = () => {
      api.status().then(setInfo).catch(() => {});
      api.stats().then(setStats).catch(() => {});
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [status]);

  async function control(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setTimeout(() => setBusy(false), 800);
    }
  }

  const running = status === "running" || status === "connecting" || status === "qr_wait" || status === "starting";

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Visão geral</h1>
        <p className="text-sm text-fg-soft">Controle e saúde do bot em tempo real.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Estado + controles */}
        <Card className="lg:col-span-2">
          <CardContent className="flex flex-col gap-5 pt-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: meta.dot, boxShadow: `0 0 14px ${meta.dot}` }}
                />
                <span className="font-display text-xl font-medium">{meta.label}</span>
              </div>
              <Badge tone={meta.tone}>{status}</Badge>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Stat icon={Clock} label="Uptime" value={formatUptime(info?.uptime ?? 0)} />
              <Stat icon={Plug} label="Reconexões" value={String(info?.reconnects ?? 0)} />
              <Stat icon={Cpu} label="PID" value={info?.pid ? String(info.pid) : "—"} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="success" disabled={busy || running} onClick={() => control(api.botStart)}>
                <Play className="h-4 w-4" /> Iniciar
              </Button>
              <Button variant="danger" disabled={busy || !running} onClick={() => control(api.botStop)}>
                <Square className="h-4 w-4" /> Parar
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => control(api.botRestart)}>
                <RotateCw className="h-4 w-4" /> Reiniciar
              </Button>
            </div>

            {publicUrl && (
              <div className="min-w-0 w-full overflow-hidden">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-mono text-xs text-accent hover:underline"
                >
                  🌐 {publicUrl}
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* QR */}
        <Card>
          <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-3 pt-5 text-center">
            {qr ? (
              <>
                <img src={qr} alt="QR Code" className="h-44 w-44 rounded-md border border-border bg-white p-1" />
                <p className="text-xs text-fg-soft">Escaneie no WhatsApp</p>
              </>
            ) : (
              <>
                <div className="grid h-16 w-16 place-items-center rounded-full border border-dashed border-border text-muted">
                  <Plug className="h-6 w-6" />
                </div>
                <p className="text-xs text-muted">
                  {status === "running" ? "Conectado — sem QR" : "Nenhum QR no momento"}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {METRIC_DEFS.map((m) => (
          <Card key={m.key}>
            <CardContent className="pt-5">
              <m.icon className="h-5 w-5 text-primary" />
              <div className="mt-3 font-display text-2xl font-bold">{stats[m.key] ?? 0}</div>
              <div className="text-xs text-fg-soft">{m.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg/40 p-3">
      <Icon className="h-4 w-4 text-fg-soft" />
      <div className="mt-2 font-mono text-sm font-medium">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
