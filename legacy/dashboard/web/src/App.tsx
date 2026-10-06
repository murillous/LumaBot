import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useLive } from "@/lib/useLive";
import { AppShell } from "@/components/AppShell";
import { Login } from "@/pages/Login";
import { Overview } from "@/pages/Overview";
import { Logs } from "@/pages/Logs";
import { Config } from "@/pages/Config";
import { Social } from "@/pages/Social";
import { Reminders } from "@/pages/Reminders";

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="h-10 w-10 animate-pulseorb rounded-lg bg-gradient-to-br from-primary to-accent" />
    </div>
  );
}

function AuthedApp() {
  const live = useLive();
  return (
    <AppShell status={live.status} connected={live.connected}>
      <Routes>
        <Route path="/" element={<Overview status={live.status} qr={live.qr} publicUrl={live.publicUrl} />} />
        <Route path="/logs" element={<Logs logs={live.logs} />} />
        <Route path="/config" element={<Config />} />
        <Route path="/social" element={<Social />} />
        <Route path="/reminders" element={<Reminders />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  function check() {
    api
      .status()
      .then(() => setAuthed(true))
      .catch((e) => setAuthed(e instanceof ApiError && e.status === 401 ? false : true));
  }

  useEffect(check, []);

  if (authed === null) return <Splash />;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return <AuthedApp />;
}
