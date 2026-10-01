import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, date, fmt, pct } from "../api";
import { Badge, DecisionCard, ErrorNote, Section, Stat } from "../ui/bits";

export function InvoiceDetail() {
  const { id } = useParams();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => api(`/api/invoices/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [id]);

  const act = async (path: string, body: unknown = {}) => {
    setErr(null);
    try {
      await api(path, { body });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!d) return <ErrorNote error={err} />;
  const inv = d.invoice;
  const t = inv.terms_json;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{fmt(inv.amount_minor, inv.currency)}</h1>
        <Badge>{inv.status}</Badge>
        <Link to={`/clients/${d.client.org_slug}`} className="text-muted hover:text-accent">{d.client.display_name} →</Link>
      </div>
      <ErrorNote error={err} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Due" value={date(inv.due_date)} sub={t ? `net ${t.net_days} days` : "terms pending"} />
        <Stat label="Paid" value={fmt(inv.paid_minor)} sub={inv.paid_at ? `settled ${date(inv.paid_at)}` : undefined} />
        <Stat label="Deposit / early-pay" value={t ? `${pct(t.deposit_bps)} / ${pct(t.early_pay_discount_bps)}` : "—"} sub={t?.early_pay_offer ? `offer ${pct(t.early_pay_offer.discount_bps)} until ${date(t.early_pay_offer.expires_at)}` : undefined} />
        <Stat
          label="Acknowledged"
          value={inv.ack_at ? (inv.ack_method === "EIP712" ? "Signed" : "Email") : "No"}
          sub={inv.ack_method === "EMAIL" ? "not counted in network record" : inv.ack_signer ? <span className="mono">{inv.ack_signer}</span> : undefined}
        />
      </div>

      <div className="card space-y-2">
        <div className="label">Client link</div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="mono flex-1 rounded bg-ink px-2 py-1.5">{d.payUrl}</code>
          <button
            className="btn-ghost"
            onClick={() => {
              navigator.clipboard.writeText(d.payUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="text-xs text-muted">Deposit address <span className="mono">{inv.deposit_address}</span></div>
        {["DRAFT", "SENT", "ACKNOWLEDGED", "OVERDUE"].includes(inv.status) && BigInt(inv.paid_minor) === 0n && (
          <button className="text-xs text-muted hover:text-bad" onClick={() => act(`/api/invoices/${inv.id}/cancel`)}>Cancel invoice</button>
        )}
      </div>

      <WorkLink inv={inv} onDone={load} />

      {inv.status === "DRAFT" && <ManualTerms id={inv.id} onDone={load} />}

      <Section title="Agent decisions">
        {d.decisions.length === 0 && <p className="text-sm text-muted">None yet.</p>}
        {d.decisions.map((x: any) => (
          <DecisionCard
            key={x.id}
            d={x}
            actions={
              x.final_status === "PENDING_APPROVAL" && (
                <div className="flex gap-2">
                  <button className="btn" onClick={() => act(`/api/decisions/${x.id}/approve`)}>Approve</button>
                  <button className="btn-ghost" onClick={() => act(`/api/decisions/${x.id}/reject`, { reason: "rejected in UI" })}>Reject</button>
                </div>
              )
            }
          />
        ))}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Payments">
          <div className="card space-y-2 text-sm">
            {d.payments.length === 0 && <p className="text-muted">No payments detected.</p>}
            {d.payments.map((p: any) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2 last:border-0">
                <span>{fmt(p.amount_minor)}</span>
                <Badge>{p.classification}</Badge>
                <span className="mono w-full text-muted">{p.log_index === -1 ? "balance-detected (no Transfer log)" : p.tx_hash}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Messages & refunds">
          <div className="card space-y-3 text-sm">
            {d.messages.map((m: any) => (
              <div key={m.id}>
                <div className="text-xs text-muted">{m.audience === "CLIENT" ? "to client" : "to you"} · {m.kind} · {date(m.created_at)}</div>
                <div>{m.body}</div>
              </div>
            ))}
            {d.refunds.map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <span>Refund {fmt(r.amount_minor)}</span>
                <Badge>{r.status}</Badge>
                {r.to_address && <span className="mono text-muted">→ {r.to_address}</span>}
              </div>
            ))}
            {d.messages.length === 0 && d.refunds.length === 0 && <p className="text-muted">Nothing yet.</p>}
          </div>
        </Section>
      </div>

      {d.record && (
        <Section title="Shared record entry">
          <div className="card space-y-1 text-sm">
            <div>Due {date(d.record.due_date)} · paid {date(d.record.paid_at)} · band {d.record.amount_band} {d.record.disputed && <Badge>DISPUTED</Badge>}</div>
            {d.record.response_text && <div className="text-muted">Client response: “{d.record.response_text}”</div>}
            <div className="mono text-muted">ack tx {d.record.ack_tx ?? "pending"} · settle tx {d.record.settle_tx ?? "—"}</div>
          </div>
        </Section>
      )}
    </div>
  );
}

function ManualTerms({ id, onDone }: { id: string; onDone: () => void }) {
  const [t, setT] = useState({ net_days: 14, deposit_bps: 0, early_pay_discount_bps: 0 });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="card grid gap-3 sm:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/invoices/${id}/terms`, { body: t });
          onDone();
        } catch (e) {
          setErr((e as Error).message);
        }
      }}
    >
      <div className="sm:col-span-4 text-sm text-muted">Terms are awaiting your approval. Approve the agent's proposal below, or set your own:</div>
      {(["net_days", "deposit_bps", "early_pay_discount_bps"] as const).map((k) => (
        <div key={k}>
          <label className="label">{k.replace(/_/g, " ")}</label>
          <input className="input" type="number" value={t[k]} onChange={(e) => setT({ ...t, [k]: Number(e.target.value) })} />
        </div>
      ))}
      <button className="btn self-end">Set terms</button>
      <div className="sm:col-span-4"><ErrorNote error={err} /></div>
    </form>
  );
}

/** Proof of work: editable until the client signs (the link is inside the signed message) or pays. */
function WorkLink({ inv, onDone }: { inv: any; onDone: () => void }) {
  const locked = !!inv.ack_at || BigInt(inv.paid_minor) > 0n || inv.status === "CANCELLED";
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(inv.deliverable_url ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (next: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/invoices/${inv.id}/deliverable`, { method: "PUT", body: { url: next } });
      setEditing(false);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="label !mb-0">Proof of work</div>
        {inv.ack_at && inv.deliverable_url && inv.ack_method === "EIP712" && <span className="text-xs text-accent">Client confirmed receipt by signing</span>}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void save(url.trim() || null);
          }}
        >
          <input className="input flex-1" type="url" placeholder="https://figma.com/… or https://github.com/…" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : inv.deliverable_url ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a href={inv.deliverable_url} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">{inv.deliverable_url}</a>
          {!locked && (
            <>
              <button className="text-xs text-muted hover:text-fg" onClick={() => setEditing(true)}>Change</button>
              <button className="text-xs text-muted hover:text-bad" onClick={() => void save(null)} disabled={busy}>Remove</button>
            </>
          )}
        </div>
      ) : locked ? (
        <p className="text-sm text-muted">No work link was attached before the client signed.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          No work link yet. Clients trust an invoice more when they can open what they're paying for.
          <button className="btn-ghost px-3 py-1.5" onClick={() => setEditing(true)}>Add link</button>
        </div>
      )}
      <ErrorNote error={err} />
    </div>
  );
}
