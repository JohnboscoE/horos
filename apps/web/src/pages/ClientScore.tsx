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
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Reliability"
              value={
                <span className="flex items-center gap-2">
                  {s.reliability === null ? "—" : `${Math.round(s.reliability * 100)}%`}
                  {s.trend === "improving" && <span className="rounded-full border border-primary px-2 py-0.5 text-[11px] font-semibold text-primary">↑ Improving</span>}
                  {s.trend === "declining" && <span className="rounded-full border border-warn px-2 py-0.5 text-[11px] font-semibold text-warn">↓ Declining</span>}
                </span>
              }
              sub="Recent invoices count most (90-day half-life)"
            />
            <Stat
              label="Recent streak"
              value={s.recent.total ? `${s.recent.onTime}/${s.recent.total}` : "—"}
              sub={`last ${s.recent.total} invoice${s.recent.total === 1 ? "" : "s"} paid on time`}
            />
            <Stat
              label="All-time on time"
              value={s.onTimeRate === null ? "—" : `${Math.round(s.onTimeRate * 100)}%`}
              sub={`${s.onTimeCount} of ${s.settledCount + s.openOverdueCount} · avg ${s.avgDaysLate ?? 0} days late`}
            />
            <Stat label="Invoices / freelancers" value={`${s.invoiceCount} / ${s.distinctFreelancers}`} sub={`confidence ${Math.round(s.confidence * 100)}%`} />
          </div>
          <div className="card text-sm text-muted-foreground">
            <b className="text-foreground">How a client rebuilds their record.</b> Reliability weighs each invoice by how recent it is
            (half weight after 90 days) and by how late it was (a day or two late costs far less than a month). Unpaid invoices never fade.
            Invoices older than 18 months drop out of the score but stay in the history below.
            {s.onTimeUnderStrictTerms > 0 && <> This client has paid {s.onTimeUnderStrictTerms} invoice{s.onTimeUnderStrictTerms === 1 ? "" : "s"} on time under strict terms (deposit or short terms).</>}
            {s.agedOutCount > 0 && <> {s.agedOutCount} older invoice{s.agedOutCount === 1 ? " has" : "s have"} aged out of scoring.</>}
          </div>
        </>
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
