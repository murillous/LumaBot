import { NavLink } from "react-router-dom";
import { Activity, ScrollText, SlidersHorizontal, Trophy, BellRing, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusMeta } from "@/lib/status";
import type { BotStatus } from "@/lib/types";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: "/", label: "Visão geral", icon: Activity },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/config", label: "Config", icon: SlidersHorizontal },
  { to: "/social", label: "Social", icon: Trophy },
  { to: "/reminders", label: "Lembretes", icon: BellRing },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-md bg-gradient-to-br from-primary to-accent font-display text-lg font-bold text-white shadow-glow">
        L
      </div>
      <div className="leading-none">
        <div className="font-display text-base font-bold tracking-tight">Luma</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">console</div>
      </div>
    </div>
  );
}

function StatusPill({ status, connected }: { status: BotStatus; connected: boolean }) {
  const meta = statusMeta(status);
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1.5">
      <span
        className={cn("h-2 w-2 rounded-full", meta.pulse && "animate-pulseorb")}
        style={{ backgroundColor: meta.dot, boxShadow: `0 0 10px ${meta.dot}` }}
      />
      <span className="text-xs font-medium">{meta.label}</span>
      {!connected && <span className="font-mono text-[10px] text-muted">· sem WS</span>}
    </div>
  );
}

export function AppShell({
  status,
  connected,
  children,
}: {
  status: BotStatus;
  connected: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full max-w-[1400px] w-full flex-col overflow-hidden lg:flex-row">
      {/* Rail lateral — desktop */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border px-4 py-6 lg:flex">
        <Brand />
        <nav className="mt-10 flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                  isActive ? "bg-primary/15 text-primary" : "text-fg-soft hover:bg-elevated hover:text-fg"
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto font-mono text-[10px] leading-relaxed text-muted">
          LumaBot · Thera<br />WhatsApp AI
        </div>
      </aside>

      {/* Coluna direita: header + conteúdo */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topo mobile */}
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 lg:hidden">
          <Brand />
          <StatusPill status={status} connected={connected} />
        </header>

        {/* Conteúdo principal */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Status pill — desktop */}
          <div className="hidden shrink-0 items-center justify-between px-8 pb-4 pt-6 lg:flex">
            <div className="h-px flex-1" />
            <StatusPill status={status} connected={connected} />
          </div>

          {/* Área rolável — scroll fica aqui, nunca no body */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pb-28 pt-5 lg:px-8 lg:pb-10 lg:pt-0">
            {children}
          </div>
        </main>
      </div>

      {/* Bottom nav — mobile */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex shrink-0 items-stretch border-t border-border bg-surface/90 backdrop-blur-lg lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition-colors",
                isActive ? "text-primary" : "text-muted"
              )
            }
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
