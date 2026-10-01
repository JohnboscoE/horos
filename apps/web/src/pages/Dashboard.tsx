import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, auth, date, fmt } from "../api";
import { Badge, ErrorNote, Section, Stat } from "../ui/bits";
import { ShareRecord } from "../ui/ShareRecord";

export function Dashboard() {
  const nav = useNavigate();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [forecast, setForecast] = useState<any>(null);
  const [pending, setPending] = useState(0);
  const [meId, setMeId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ clientName: "", clientOrg: "", clientEmail: "", amount: "", description: "", deliverableUrl: "" });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"ALL" | "OPEN" | "PAID" | "OTHER">("ALL");

  const load = async () => {
    try {
      const [inv, fc, dec] = await Promise.all([api("/api/invoices"), api("/api/me/forecast"), api("/api/decisions?status=PENDING_APPROVAL")]);
      setInvoices(inv);
      setForecast(fc);
      setPending(dec.length);
      if (!meId) api("/api/me").then((m) => setMeId(m.freelancer.id)).catch(() => {});
    } catch (e) {
      if ((e as any).status === 401) {
        auth.clear();
        nav("/");
      } else setErr((e as Error).message);
    }
  };
  useEffect(() => {
    if (!auth.get()) {
      nav("/");
      return;
    }
    load();
    // Payments land in the background; keep the list current without a manual reload.
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
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
          deliverableUrl: form.deliverableUrl.trim() || undefined,
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
  const paid = invoices.filter((i) => ["PAID", "OVERPAID", "REFUND_PENDING", "REFUNDED"].includes(i.status));
  const received = invoices.reduce((s, i) => s + BigInt(i.paid_minor), 0n);
  const groups = { ALL: invoices, OPEN: open, PAID: paid, OTHER: invoices.filter((i) => !open.includes(i) && !paid.includes(i)) };
  const shown = groups[tab];

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open receivables" value={fmt(receivable, "USDC")} sub={`${open.length} open invoice${open.length === 1 ? "" : "s"}`} />
        <Stat label="Overdue" value={invoices.filter((i) => i.status === "OVERDUE").length} />
        <Stat
          label="Forecast shortfall (30d)"
          value={<span className={forecast && BigInt(forecast.totalShortfallMinor) > 0n ? "text-warn" : ""}>{forecast ? fmt(forecast.totalShortfallMinor, "USDC") : "—"}</span>}
          sub={<Link to="/settings" className="hover:text-accent">edit cash needs →</Link>}
        />
        <Stat label="Awaiting your approval" value={pending} sub={<Link to="/approvals" className="hover:text-accent">review →</Link>} />
      </div>

      {meId && <ShareRecord freelancerId={meId} />}

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
            <label className="label">What did you deliver?</label>
            <textarea className="input" rows={2} placeholder="e.g. Landing page redesign, 3 screens" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="label">Link to the work (optional)</label>
            <input className="input" type="url" placeholder="https://figma.com/… or https://github.com/…" value={form.deliverableUrl} onChange={(e) => setForm({ ...form, deliverableUrl: e.target.value })} />
            <p className="mt-1 text-xs text-muted">The client signs this link with the invoice, confirming they received the work.</p>
          </div>
          <ErrorNote error={err} />
          <button className="btn w-full" disabled={busy}>{busy ? "Agent is setting terms…" : "Create — agent proposes terms"}</button>
        </form>

        <Section
          title="Your invoices"
          action={<span className="text-xs text-muted">Received to date <span className="font-semibold text-fg">{fmt(received, "USDC")}</span></span>}
        >
          <div className="flex flex-wrap gap-1 rounded-xl bg-ink p-1 text-sm">
            {([["ALL", "All"], ["OPEN", "Open"], ["PAID", "Paid"], ["OTHER", "Drafts & cancelled"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 ${tab === k ? "bg-panel text-accent" : "text-muted hover:text-fg"}`}>
                {label} <span className="text-xs opacity-70">{groups[k].length}</span>
              </button>
            ))}
          </div>
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
                {shown.map((i) => (
                  <tr key={i.id} className="cursor-pointer border-b border-line/60 hover:bg-ink" onClick={() => nav(`/invoices/${i.id}`)}>
                    <td className="px-4 py-3">
                      <div>{i.client_name}</div>
                      <div className="text-xs text-muted">{i.description || i.client_slug}</div>
                    </td>
                    <td className="px-4 py-3">{fmt(i.amount_minor, i.currency)}</td>
                    <td className="px-4 py-3">{date(i.due_date)}</td>
                    <td className="px-4 py-3 text-xs text-muted">{i.terms_json ? `net ${i.terms_json.net_days}` : "pending"}</td>
                    <td className="px-4 py-3"><Badge>{i.status}</Badge></td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">{invoices.length === 0 ? "No invoices yet. Create your first one on the left." : "Nothing in this list."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
