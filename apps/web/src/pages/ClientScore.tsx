import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, date } from "../api";
import { Badge, ErrorNote, Stat } from "../ui/bits";

const BANDS = ["< 100", "100 – 999", "1,000 – 9,999", "10,000+"];

export function ClientScore() {
  const { slug } = useParams();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api(`/api/clients/${slug}/score`).then(setD).catch((e) => setErr(e.message));
  }, [slug]);
  if (!d) return <ErrorNote error={err} />;
  const s = d.score;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{d.client.name} <span className="text-base text-muted">{d.client.slug}</span></h1>
      {d.insufficientData ? (
        <div className="card text-sm">
          <b>Insufficient data.</b> A score is shown once there are at least 3 acknowledged, undisputed invoices from 2 or more
          freelancers (currently {d.counts.invoices} from {d.counts.freelancers}). Until then, the agent treats this client as new.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Paid on time" value={`${Math.round(s.onTimeRate * 100)}%`} sub={`${s.onTimeCount} of ${s.settledCount + s.openOverdueCount}`} />
          <Stat label="Avg days late" value={s.avgDaysLate} />
          <Stat label="Invoices / freelancers" value={`${s.invoiceCount} / ${s.distinctFreelancers}`} />
          <Stat label="Confidence" value={`${Math.round(s.confidence * 100)}%`} />
        </div>
      )}
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr className="border-b border-line"><th className="px-4 py-3">Due</th><th className="px-4 py-3">Paid</th><th className="px-4 py-3">Band</th><th className="px-4 py-3">Client response</th><th className="px-4 py-3">Onchain</th></tr>
          </thead>
          <tbody>
            {d.entries.map((e: any, i: number) => (
              <tr key={i} className="border-b border-line/60">
                <td className="px-4 py-3">{date(e.due_date)}</td>
                <td className="px-4 py-3">{date(e.paid_at)}</td>
                <td className="px-4 py-3">{BANDS[e.amount_band]}</td>
                <td className="px-4 py-3">{e.disputed && <Badge>DISPUTED</Badge>} {e.response_text && <span className="text-muted">“{e.response_text}”</span>} {!e.verified && <Badge>UNVERIFIED</Badge>}</td>
                <td className="mono px-4 py-3 text-muted">{e.settle_tx ?? e.ack_tx ?? "pending"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{d.disclaimer}</p>
    </div>
  );
}
