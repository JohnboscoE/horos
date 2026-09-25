import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, auth, date, fmt } from "../api";
import { Badge, ErrorNote, Section, Stat } from "../ui/bits";

export function Dashboard() {
  const nav = useNavigate();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [forecast, setForecast] = useState<any>(null);
  const [pending, setPending] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ clientName: "", clientOrg: "", clientEmail: "", amount: "", description: "" });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [inv, fc, dec] = await Promise.all([api("/api/invoices"), api("/api/me/forecast"), api("/api/decisions?status=PENDING_APPROVAL")]);
      setInvoices(inv);
      setForecast(fc);
      setPending(dec.length);
    } catch (e) {
      if ((e as any).status === 401) {
        auth.clear();
        nav("/");
      } else setErr((e as Error).message);
    }
  };
  useEffect(() => {
    if (!auth.get()) nav("/");
    else load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api("/api/invoices", {
        body: {
          clientName: form.clientName,
          clientOrg: form.clientOrg || undefined,
          clientEmail: form.clientEmail || undefined,
          amount: form.amount,
          description: form.description || undefined,
        },
      });
      nav(`/invoices/${r.invoice.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = invoices.filter((i) => ["SENT", "ACKNOWLEDGED", "PARTIALLY_PAID", "OVERDUE"].includes(i.status));
  const receivable = open.reduce((s, i) => s + BigInt(i.amount_minor) - BigInt(i.paid_minor), 0n);

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open receivables" value={fmt(receivable)} sub={`${open.length} open invoice(s)`} />
        <Stat label="Overdue" value={invoices.filter((i) => i.status === "OVERDUE").length} />
        <Stat
          label="Forecast shortfall (30d)"
          value={<span className={forecast && BigInt(forecast.totalShortfallMinor) > 0n ? "text-warn" : ""}>{forecast ? fmt(forecast.totalShortfallMinor) : "—"}</span>}
          sub={<Link to="/settings" className="hover:text-accent">edit cash needs →</Link>}
        />
        <Stat label="Awaiting your approval" value={pending} sub={<Link to="/approvals" className="hover:text-accent">review →</Link>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <form onSubmit={create} className="card h-fit space-y-3">
          <h2 className="font-semibold">New invoice</h2>
          <div>
            <label className="label">Client name</label>
            <input className="input" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required />
          </div>
          <div>
            <label className="label">Organization (optional)</label>
            <input className="input" placeholder="e.g. acme-dao" value={form.clientOrg} onChange={(e) => setForm({ ...form, clientOrg: e.target.value })} />
          </div>
          <div>
            <label className="label">Client email (optional)</label>
            <input className="input" type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} />
          </div>
          <div>
            <label className="label">Amount (USDC)</label>
            <input className="input" inputMode="decimal" placeholder="250.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <ErrorNote error={err} />
          <button className="btn w-full" disabled={busy}>{busy ? "Agent is setting terms…" : "Create — agent proposes terms"}</button>
        </form>

        <Section title="Invoices">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs uppercase text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Terms</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id} className="cursor-pointer border-b border-line/60 hover:bg-ink" onClick={() => nav(`/invoices/${i.id}`)}>
                    <td className="px-4 py-3">
                      <div>{i.client_name}</div>
                      <div className="text-xs text-muted">{i.client_slug}</div>
                    </td>
                    <td className="px-4 py-3">{fmt(i.amount_minor, i.currency)}</td>
                    <td className="px-4 py-3">{date(i.due_date)}</td>
                    <td className="px-4 py-3 text-xs text-muted">{i.terms_json ? `net ${i.terms_json.net_days}` : "pending"}</td>
                    <td className="px-4 py-3"><Badge>{i.status}</Badge></td>
                  </tr>
                ))}
                {invoices.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No invoices yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
