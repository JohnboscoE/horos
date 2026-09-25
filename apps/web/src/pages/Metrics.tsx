import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { ErrorNote, Section, Stat } from "../ui/bits";

export function Metrics() {
  const [m, setM] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api("/api/metrics").then(setM).catch((e) => setErr(e.message));
  }, []);
  if (!m) return <ErrorNote error={err} />;

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted">Generated live from the database. Self-test accounts and invoices are excluded. Testnet and mainnet are reported separately.</p>
      {(["testnet", "mainnet"] as const).map((net) => {
        const n = m.networks[net];
        return (
          <Section key={net} title={net}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Freelancers" value={n.freelancers} sub={`${n.clients} clients · ${n.clientsWithMultipleFreelancers} shared by 2+ freelancers`} />
              <Stat label="Invoices" value={n.invoices} sub={`${n.acknowledged} acknowledged`} />
              <Stat label="Settled (acknowledged)" value={n.acknowledged_settled} sub={`${n.paidOnTime} on time · ${n.paidLate} late`} />
              <Stat label="USDC received" value={fmt(n.usdc_received_minor)} sub={`${n.refundsCompleted} refunds · ${fmt(n.refundedMinor)} returned`} />
            </div>
          </Section>
        );
      })}
      <Section title="Agent decisions">
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr className="border-b border-line"><th className="px-4 py-2">Type</th><th className="px-4 py-2">Source</th><th className="px-4 py-2">Outcome</th><th className="px-4 py-2">Count</th></tr>
            </thead>
            <tbody>
              {m.decisions.map((d: any, i: number) => (
                <tr key={i} className="border-b border-line/60"><td className="px-4 py-2">{d.decision_type}</td><td className="px-4 py-2">{d.source}</td><td className="px-4 py-2">{d.final_status}</td><td className="px-4 py-2">{d.n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={`Decision log · ${m.logEntries} entries`}>
        <div className="card space-y-1 text-sm">
          {m.recentAnchors.map((a: any) => (
            <div key={a.count} className="flex flex-wrap gap-2"><span>#{a.count}</span><span className="mono text-muted">{a.chain_head}</span><span className="text-accent">{a.status}</span></div>
          ))}
          {m.recentAnchors.length === 0 && <span className="text-muted">No anchors yet.</span>}
        </div>
      </Section>
    </div>
  );
}
