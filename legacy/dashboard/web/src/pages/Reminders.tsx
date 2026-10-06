import { useEffect, useState } from "react";
import { BellRing, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { Reminder } from "@/lib/types";
import { Button, Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui";

export function Reminders() {
  const [items, setItems] = useState<Reminder[]>([]);
  const load = () => api.reminders().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  async function cancel(id: number) {
    await api.cancelReminder(id);
    load();
  }

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Lembretes</h1>
        <p className="text-sm text-fg-soft">Agendados pela Luma ou pelo comando <span className="font-mono text-xs">!lembrete</span>.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" /> Pendentes ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted">Nenhum lembrete pendente.</p>
          ) : (
            <div className="space-y-2">
              {items.map((r) => (
                <div key={r.id} className="flex items-start gap-3 rounded-md border border-border bg-bg/40 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{r.text}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      <span className="font-mono">⏰ {formatDate(r.fireAt)}</span>
                      <Badge tone={r.isGroup ? "accent" : "neutral"}>{r.isGroup ? "grupo" : "privado"}</Badge>
                      {r.mentionJids.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> {r.mentionJids.length}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-danger" onClick={() => cancel(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
