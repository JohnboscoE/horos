import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { DecisionCard, ErrorNote, Section } from "../ui/bits";

export function Approvals() {
  const [pending, setPending] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);

  const load = async () => {
    try {
      const all = await api("/api/decisions");
      setPending(all.filter((d: any) => d.final_status === "PENDING_APPROVAL"));
      setRecent(all.filter((d: any) => d.final_status !== "PENDING_APPROVAL").slice(0, 20));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const act = async (path: string, body: unknown = {}) => {
    setErr(null);
    try {
      await api(path, { body });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const subjectLink = (d: any) => (d.subject_type === "invoice" ? <Link className="text-xs text-muted hover:text-accent" to={`/invoices/${d.subject_id}`}>invoice →</Link> : null);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          The agent proposes; your policy decides. Anything outside your bounds, above your approval threshold, or that pauses work with a client lands here.
        </p>
        <button
          className="btn-ghost"
          disabled={ticking}
          onClick={async () => {
            setTicking(true);
            await act("/api/agent/tick");
            setTicking(false);
          }}
        >
          {ticking ? "Running…" : "Run agent loops now"}
        </button>
      </div>
      <ErrorNote error={err} />
      <Section title={`Awaiting approval (${pending.length})`}>
        {pending.length === 0 && <p className="text-sm text-muted">Nothing needs you right now.</p>}
        {pending.map((d) => (
          <DecisionCard
            key={d.id}
            d={d}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn" onClick={() => act(`/api/decisions/${d.id}/approve`)}>Approve</button>
                <button className="btn-ghost" onClick={() => act(`/api/decisions/${d.id}/reject`, { reason: "rejected in UI" })}>Reject</button>
                {subjectLink(d)}
              </div>
            }
          />
        ))}
      </Section>
      <Section title="Recent decisions">
        {recent.map((d) => <DecisionCard key={d.id} d={d} actions={subjectLink(d)} />)}
      </Section>
    </div>
  );
}
