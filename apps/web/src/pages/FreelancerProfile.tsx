import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/api";
import { ErrorNote } from "@/ui/bits";
import { BANDS, FreelancerRecordCard, type FreelancerRecordData } from "@/ui/FreelancerRecord";

/** Public, shareable track record. A freelancer sends this link to a prospective client before any work starts. */
export function FreelancerProfile() {
  const { id } = useParams();
  const [d, setD] = useState<(FreelancerRecordData & { disclaimer: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api(`/api/freelancers/${id}/record`).then(setD).catch((e) => setErr(e.status === 404 ? "This freelancer record doesn't exist." : e.message));
  }, [id]);

  return (
    <div className="app-grain min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-3 w-3 rounded-sm bg-accent" /> Horos
          </Link>
          <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">Freelancer record</span>
          <Link to="/client" className="ml-auto text-xs text-muted hover:text-accent">Client sign-in →</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:py-8">
        <ErrorNote error={err} />
        {!d ? (
          !err && <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <FreelancerRecordCard record={d} linkToProfile={false} />

            {d.recent.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent client-signed invoices</h2>
                <div className="card overflow-x-auto p-0">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="text-left text-xs uppercase text-muted">
                      <tr className="border-b border-line">
                        <th className="px-4 py-3">Signed</th>
                        <th className="px-4 py-3">Amount (USDC)</th>
                        <th className="px-4 py-3">Payment</th>
                        <th className="px-4 py-3">Work</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.recent.map((r, i) => (
                        <tr key={i} className="border-b border-line/60">
                          <td className="px-4 py-3">{r.month}</td>
                          <td className="px-4 py-3">{BANDS[r.amountBand]}</td>
                          <td className="px-4 py-3">
                            {!r.paid ? <span className="text-muted">Not paid yet</span> : r.onTime ? <span className="text-accent">Paid on time</span> : <span>Paid late</span>}
                            {r.disputed && <span className="ml-2 text-xs text-warn">disputed</span>}
                          </td>
                          <td className="px-4 py-3">{r.proofOfWork ? "Linked and confirmed by client" : <span className="text-muted">No link</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted">Amounts are shown as bands and clients aren't named, to protect both sides' privacy.</p>
              </section>
            )}

            <div className="card space-y-2 text-sm">
              <div className="font-semibold">How to work with a freelancer you haven't met</div>
              <ul className="space-y-1 text-muted">
                <li>· Start with a small first milestone, then invoice the rest.</li>
                <li>· Open the linked work before you sign. Your signature confirms you received it.</li>
                <li>· Pay only to the deposit address on the Horos invoice page.</li>
              </ul>
            </div>
            <p className="text-xs text-muted">{d.disclaimer}</p>
          </>
        )}
      </main>
    </div>
  );
}
