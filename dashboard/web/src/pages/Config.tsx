import { useEffect, useMemo, useState } from "react";
import { Save, RotateCw, AlertTriangle, Check } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ConfigChange, ConfigField, ConfigGroup } from "@/lib/types";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Switch, Textarea, Badge } from "@/components/ui";

const fieldId = (f: ConfigField) => `${f.source}:${f.section ?? "env"}:${f.key}`;

export function Config() {
  const [groups, setGroups] = useState<ConfigGroup[]>([]);
  const [edited, setEdited] = useState<Record<string, unknown>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((r) => setGroups(r.groups)).catch(() => {});
  }, []);

  const dirtyCount = Object.keys(edited).length;
  const hasJsonError = Object.values(jsonErrors).some(Boolean);

  function setValue(f: ConfigField, value: unknown) {
    setSaved(false);
    setSaveError(null);
    setEdited((prev) => ({ ...prev, [fieldId(f)]: value }));
  }

  const changes: ConfigChange[] = useMemo(() => {
    const byId = new Map<string, ConfigField>();
    groups.forEach((g) => g.fields.forEach((f) => byId.set(fieldId(f), f)));
    return Object.entries(edited).map(([id, value]) => {
      const f = byId.get(id)!;
      return { key: f.key, source: f.source, section: f.section, value };
    });
  }, [edited, groups]);

  async function save() {
    if (hasJsonError) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveConfig(changes);
      setEdited({});
      setSaved(true);
    } catch (err) {
      // Sem isto a falha era engolida silenciosamente — o botão "não fazia nada".
      setSaveError(err instanceof Error ? err.message : "Falha ao salvar configuração.");
    } finally {
      setSaving(false);
    }
  }

  if (groups.length === 0) {
    return <div className="animate-fade-up text-sm text-muted">Carregando configuração…</div>;
  }

  const group = groups[active];

  return (
    <div className="animate-fade-up space-y-6 pb-20">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Configuração</h1>
        <p className="text-sm text-fg-soft">Tudo que vive em <span className="font-mono text-xs">src/config</span> — aplicado no reinício.</p>
      </div>

      {/* Seletor de grupo */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {groups.map((g, i) => (
          <button
            key={g.id}
            onClick={() => setActive(i)}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              i === active ? "bg-primary/15 text-primary" : "text-fg-soft hover:bg-elevated"
            )}
          >
            {g.title}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{group.title}</CardTitle>
          {group.description && <p className="mt-1 text-xs text-fg-soft">{group.description}</p>}
        </CardHeader>
        <CardContent className="space-y-5">
          {group.fields.map((f) => (
            <FieldRow
              key={fieldId(f)}
              field={f}
              value={fieldId(f) in edited ? edited[fieldId(f)] : f.value}
              onChange={(v) => setValue(f, v)}
              onJsonError={(err) => setJsonErrors((prev) => ({ ...prev, [fieldId(f)]: err }))}
            />
          ))}
        </CardContent>
      </Card>

      {/* Barra de salvar */}
      {dirtyCount > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-30 mx-auto flex max-w-[760px] items-center justify-between gap-3 rounded-lg border border-border bg-elevated/95 px-4 py-3 shadow-glow backdrop-blur lg:bottom-6">
          <span className="text-xs text-fg-soft">
            {dirtyCount} alteração(ões) pendente(s)
            {hasJsonError && <span className="ml-2 text-danger">· JSON inválido</span>}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setEdited({}); setJsonErrors({}); }}>
              Descartar
            </Button>
            <Button size="sm" disabled={saving || hasJsonError} onClick={save}>
              <Save className="h-4 w-4" /> Salvar
            </Button>
          </div>
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-3 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <Check className="h-4 w-4" /> Salvo. Reinicie o bot para aplicar.
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => api.botRestart()}>
            <RotateCw className="h-4 w-4" /> Reiniciar agora
          </Button>
        </div>
      )}

      {saveError && (
        <div className="flex items-center gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" /> Falha ao salvar: {saveError}
        </div>
      )}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  onJsonError,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
  onJsonError: (err: boolean) => void;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", field.type === "boolean" && "flex-row items-center justify-between")}>
      <div className="flex items-center gap-2">
        <Label>{field.label}</Label>
        {field.advanced && <Badge tone="warn">avançado</Badge>}
        {field.source === "env" && <Badge tone="accent">.env</Badge>}
      </div>
      <FieldInput field={field} value={value} onChange={onChange} onJsonError={onJsonError} />
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  onJsonError,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
  onJsonError: (err: boolean) => void;
}) {
  if (field.type === "boolean") {
    return <Switch checked={!!value} onCheckedChange={onChange} />;
  }
  if (field.type === "select") {
    return (
      <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.options?.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </Select>
    );
  }
  if (field.type === "textarea") {
    return (
      <Textarea
        value={String(value ?? "")}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[200px]"
      />
    );
  }
  if (field.type === "json") {
    return <JsonEditor value={value} onChange={onChange} onJsonError={onJsonError} />;
  }
  return (
    <Input
      type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
      value={value === null || value === undefined ? "" : String(value)}
      placeholder={field.placeholder ?? (field.type === "secret" ? "(inalterado)" : "")}
      step={field.step}
      min={field.min}
      max={field.max}
      onChange={(e) =>
        onChange(field.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)
      }
    />
  );
}

function JsonEditor({
  value,
  onChange,
  onJsonError,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  onJsonError: (err: boolean) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState(false);

  function handle(next: string) {
    setText(next);
    try {
      const parsed = JSON.parse(next);
      setError(false);
      onJsonError(false);
      onChange(parsed);
    } catch {
      setError(true);
      onJsonError(true);
    }
  }

  return (
    <div className="space-y-1">
      <Textarea value={text} onChange={(e) => handle(e.target.value)} className={cn(error && "border-danger/60")} />
      {error && (
        <p className="flex items-center gap-1 text-[11px] text-danger">
          <AlertTriangle className="h-3 w-3" /> JSON inválido
        </p>
      )}
    </div>
  );
}
