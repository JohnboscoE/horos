import { useEffect, useState } from "react";
import { api, date, fmt } from "../api";
import { ErrorNote, Section } from "../ui/bits";

export function Settings() {
  const [policy, setPolicy] = useState<any>(null);
  const [cash, setCash] = useState("0");
  const [needs, setNeeds] = useState<any[]>([]);
  const [forecast, setForecast] = useState<any>(null);
  const [need, setNeed] = useState({ label: "", amount: "", dueDate: "" });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = async () => {
    const [me, n, fc] = await Promise.all([api("/api/me"), api("/api/me/cash-needs"), api("/api/me/forecast")]);
    const p = me.policy;
    setPolicy({
      minTermsDays: p.min_terms_days,
      maxTermsDays: p.max_terms_days,
      maxDiscountBps: p.max_discount_bps,
      maxDepositBps: p.max_deposit_bps,
      lateFeeBpsCap: p.late_fee_bps_cap,
      approvalThreshold: fmt(p.approval_threshold_minor).replace(/,/g, ""),
    });
    setCash(me.cashOnHand);
    setNeeds(n);
    setForecast(fc);
  };
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  const save = async (fn: () => Promise<unknown>, msg: string) => {
    setErr(null);
    try {
      await fn();
      setSaved(msg);
      setTimeout(() => setSaved(null), 2000);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!policy) return <ErrorNote error={err} />;
  const fields: [keyof typeof policy, string][] = [
    ["minTermsDays", "Min terms (days)"],
    ["maxTermsDays", "Max terms (days)"],
    ["maxDiscountBps", "Max discount (bps)"],
    ["maxDepositBps", "Max deposit (bps)"],
    ["lateFeeBpsCap", "Late fee cap (bps)"],
    ["approvalThreshold", "Approve above (USDC)"],
  ];

  return (
    <div className="space-y-8">
      <ErrorNote error={err} />
      {saved && <div className="text-sm text-accent">{saved}</div>}
      <Section title="Policy bounds: the agent auto-applies only inside these">
        <form
          className="card grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            const body = { ...policy };
            for (const k of ["minTermsDays", "maxTermsDays", "maxDiscountBps", "maxDepositBps", "lateFeeBpsCap"]) body[k] = Number(body[k]);
            save(() => api("/api/me/policy", { method: "PUT", body }), "Policy saved");
          }}
        >
          {fields.map(([k, label]) => (
            <div key={k as string}>
              <label className="label">{label}</label>
              <input className="input" value={policy[k]} onChange={(e) => setPolicy({ ...policy, [k]: e.target.value })} />
            </div>
          ))}
          <button className="btn sm:col-span-3 lg:col-span-6 lg:justify-self-start">Save policy</button>
        </form>
      </Section>

      <Section title="Cash forecast (30 days)">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card space-y-3">
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save(() => api("/api/me/cash", { method: "PUT", body: { cashOnHand: cash } }), "Saved"); }}>
              <div className="flex-1">
                <label className="label">Cash on hand (USDC)</label>
                <input className="input" value={cash} onChange={(e) => setCash(e.target.value.replace(/,/g, ""))} />
              </div>
              <button className="btn-ghost">Save</button>
            </form>
            <form
              className="grid gap-2 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                save(() => api("/api/me/cash-needs", { body: need }), "Cash need added").then(() => setNeed({ label: "", amount: "", dueDate: "" }));
              }}
            >
              <input className="input" placeholder="Rent" value={need.label} onChange={(e) => setNeed({ ...need, label: e.target.value })} required />
              <input className="input" placeholder="1200" value={need.amount} onChange={(e) => setNeed({ ...need, amount: e.target.value })} required />
              <input className="input" type="date" value={need.dueDate} onChange={(e) => setNeed({ ...need, dueDate: e.target.value })} required />
              <button className="btn">Add need</button>
            </form>
            <ul className="divide-y divide-line text-sm">
              {needs.map((n) => (
                <li key={n.id} className="flex items-center justify-between py-2">
                  <span>{n.label} · {fmt(n.amount_minor)} · {date(n.due_date)}</span>
                  <button className="text-xs text-muted hover:text-bad" onClick={() => save(() => api(`/api/me/cash-needs/${n.id}`, { method: "DELETE" }), "Removed")}>remove</button>
                </li>
              ))}
            </ul>
          </div>
          <div className="card space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">Starting balance</span>{fmt(forecast?.startingBalanceMinor)}</div>
            <div className="flex justify-between"><span className="text-muted">Shortfall</span><span className={BigInt(forecast?.totalShortfallMinor ?? 0) > 0n ? "text-warn" : "text-accent"}>{fmt(forecast?.totalShortfallMinor)}</span></div>
            <div className="mt-2 space-y-1">
              {(forecast?.events ?? []).map((e: any, i: number) => (
                <div key={i} className="flex justify-between gap-2 border-b border-line/50 py-1 text-xs">
                  <span>{new Date(e.at * 1000).toISOString().slice(0, 10)} · {e.kind === "NEED" ? "need" : "expected receipt"} <span className="text-muted">{e.ref}</span></span>
                  <span className={BigInt(e.balanceMinor) < 0n ? "text-bad" : ""}>{fmt(e.deltaMinor)} → {fmt(e.balanceMinor)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">Receipts are expected at due date plus the client's typical lateness. A shortfall triggers the agent's early-pay offers.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
