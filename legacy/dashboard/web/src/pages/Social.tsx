import { useEffect, useState } from "react";
import { Trophy, Pencil, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import type { RankingEntry, WaUser } from "@/lib/types";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";

export function Social() {
  const [tab, setTab] = useState<"ranking" | "users">("ranking");

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Social</h1>
        <p className="text-sm text-fg-soft">Quem mais fala com a Luma e gestão de apelidos.</p>
      </div>

      <div className="flex gap-1.5">
        {(["ranking", "users"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t ? "bg-primary/15 text-primary" : "text-fg-soft hover:bg-elevated"
            )}
          >
            {t === "ranking" ? "Ranking" : "Usuários"}
          </button>
        ))}
      </div>

      {tab === "ranking" ? <Ranking /> : <Users />}
    </div>
  );
}

function Ranking() {
  const [rows, setRows] = useState<RankingEntry[]>([]);
  useEffect(() => {
    api.ranking("global").then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" /> Ranking global
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma interação registrada ainda.</p>
        ) : (
          <ol className="space-y-1.5">
            {rows.map((r, i) => (
              <li key={r.jid} className="flex items-center gap-3 rounded-md border border-border bg-bg/40 px-3 py-2.5">
                <span className="w-7 text-center font-display text-sm font-bold text-primary">
                  {["🥇", "🥈", "🥉"][i] ?? i + 1}
                </span>
                <span className="flex-1 truncate text-sm">{r.name}</span>
                <span className="font-mono text-sm text-fg-soft">{r.count}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function Users() {
  const [users, setUsers] = useState<WaUser[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = () => api.users().then(setUsers).catch(() => setUsers([]));
  useEffect(() => { load(); }, []);

  async function saveNick(jid: string) {
    await api.setNickname(jid, draft);
    setEditing(null);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usuários conhecidos</CardTitle>
        <p className="mt-1 text-xs text-fg-soft">{users.length} perfis · apelido tem prioridade na exibição.</p>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="text-sm text-muted">Nenhum usuário ainda.</p>
        ) : (
          <div className="space-y-1.5">
            {users.map((u) => (
              <div key={u.jid} className="flex items-center gap-3 rounded-md border border-border bg-bg/40 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.displayName}</div>
                  <div className="truncate font-mono text-[10px] text-muted">{u.jid}</div>
                </div>
                {editing === u.jid ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="h-8 w-32"
                      placeholder="apelido"
                    />
                    <Button size="icon" className="h-8 w-8" onClick={() => saveNick(u.jid)}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setEditing(u.jid); setDraft(u.nickname); }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> {u.nickname ? "Editar" : "Apelido"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
