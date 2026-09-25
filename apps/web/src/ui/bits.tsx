import type { ReactNode } from "react";

const STATUS_COLOR: Record<string, string> = {
  PAID: "text-accent border-accent",
  EXECUTED: "text-accent border-accent",
  COMPLETED: "text-accent border-accent",
  ACKNOWLEDGED: "text-fg border-line",
  SENT: "text-fg border-line",
  OVERDUE: "text-bad border-bad",
  POLICY_REJECTED: "text-bad border-bad",
  FAILED: "text-bad border-bad",
  DISPUTED: "text-warn border-warn",
  PENDING_APPROVAL: "text-warn border-warn",
  OVERPAID: "text-warn border-warn",
  REFUND_PENDING: "text-warn border-warn",
  AWAITING_PAYER: "text-warn border-warn",
};

export function Badge({ children }: { children: string }) {
  const c = STATUS_COLOR[children] ?? "text-muted border-line";
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${c}`}>{children.replace(/_/g, " ")}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>;
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One agent decision, reasoning first: this is what judges and freelancers read. */
export function DecisionCard({ d, actions }: { d: any; actions?: ReactNode }) {
  const p = d.proposal_json;
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-accent">{d.decision_type}</span>
        <span className="text-sm font-semibold">{p.action}</span>
        <Badge>{d.final_status}</Badge>
        <span className="text-xs text-muted">
          {d.source === "MODEL" ? d.model : d.source.toLowerCase()} · confidence {Math.round((p.confidence ?? 0) * 100)}%
        </span>
        <a href={`/log?decision=${d.id}`} className="ml-auto text-xs text-muted hover:text-accent">replay →</a>
      </div>
      <p className="text-sm leading-relaxed">{p.reasoning}</p>
      <div className="flex flex-wrap gap-1">
        {Object.entries(p.params ?? {}).map(([k, v]) => (
          <span key={k} className="rounded bg-ink px-2 py-0.5 font-mono text-[11px] text-muted">
            {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </span>
        ))}
      </div>
      <div className="text-[11px] text-muted">
        evidence: {(p.evidence_refs ?? []).join(", ")}
      </div>
      {d.policy_result?.reasons?.length > 0 && (
        <div className="text-xs text-warn">policy: {d.policy_result.reasons.join("; ")}</div>
      )}
      {actions}
    </div>
  );
}
