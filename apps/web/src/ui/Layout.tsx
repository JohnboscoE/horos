import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, auth } from "../api";

export function Layout() {
  const nav = useNavigate();
  const [health, setHealth] = useState<any>(null);
  useEffect(() => {
    api("/api/health").then(setHealth).catch(() => setHealth(null));
  }, []);
  const authed = !!auth.get();
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-accent-dim text-accent" : "text-muted hover:text-fg"}`;

  return (
    <div className="app-grain min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <NavLink to="/" className="mr-4 flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-3 w-3 rounded-sm bg-accent" /> Horos
          </NavLink>
          <nav className="flex flex-wrap gap-1">
            {authed && (
              <>
                <NavLink to="/dashboard" className={link}>Invoices</NavLink>
                <NavLink to="/approvals" className={link}>Approvals</NavLink>
                <NavLink to="/settings" className={link}>Policy & cash</NavLink>
              </>
            )}
            <NavLink to="/log" className={link}>Decision log</NavLink>
            <NavLink to="/metrics" className={link}>Metrics</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted">
            {health && (
              <span className="hidden sm:inline">
                {health.network} · agent: {health.agent} · attester: {health.attester}
                {health.killSwitch && <span className="ml-2 text-bad">KILL SWITCH ON</span>}
              </span>
            )}
            {authed && (
              <button className="btn-ghost px-3 py-1" onClick={() => { auth.clear(); nav("/"); }}>
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted">
        {health?.disclaimer ?? "Horos is a beta. It records objective payment facts only."}
      </footer>
    </div>
  );
}
