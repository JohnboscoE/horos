import { Link } from "react-router-dom";
import { ArrowUpRight, ShieldCheck } from "lucide-react";

export interface FreelancerRecordData {
  freelancer: { id: string; name: string; memberSince: string };
  counts: { signedInvoices: number; distinctClients: number; paid: number; paidOnTime: number; withProofOfWork: number; disputed: number };
  recent: { month: string; amountBand: number; paid: boolean; onTime: boolean | null; proofOfWork: boolean; disputed: boolean }[];
}

export const BANDS = ["< 100", "100 – 999", "1,000 – 9,999", "10,000+"];

const month = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });

/** "Who is this freelancer?": facts from invoices clients signed, for a client deciding whether to trust them. */
export function FreelancerRecordCard({ record, linkToProfile = true }: { record: FreelancerRecordData; linkToProfile?: boolean }) {
  const c = record.counts;
  const isNew = c.signedInvoices === 0;
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="label">About the freelancer</div>
          <div className="flex items-center gap-2 text-lg font-semibold">
            {record.freelancer.name}
            {!isNew && <ShieldCheck className="h-4 w-4 text-accent" aria-label="Has a client-signed track record" />}
          </div>
          <div className="text-xs text-muted">On Horos since {month(record.freelancer.memberSince)}</div>
        </div>
        {linkToProfile && (
          <Link to={`/freelancers/${record.freelancer.id}`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
            Full record <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        )}
      </div>

      {isNew ? (
        <p className="rounded-lg border border-line bg-ink px-3 py-2 text-sm text-muted">
          New on Horos: no client-signed invoices yet. That isn't a red flag, but for a first job consider a small first milestone or a
          deposit, and check the work link before you sign.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Fact value={c.signedInvoices} label={`invoice${c.signedInvoices === 1 ? "" : "s"} signed by clients`} />
          <Fact value={c.distinctClients} label={`different client${c.distinctClients === 1 ? "" : "s"}`} />
          <Fact value={`${c.paidOnTime}/${c.paid}`} label="paid on time" />
          <Fact value={c.withProofOfWork} label="with linked work" />
        </div>
      )}
      {c.disputed > 0 && <p className="text-xs text-warn">{c.disputed} entr{c.disputed === 1 ? "y is" : "ies are"} disputed by a client.</p>}
      <p className="text-[11px] leading-relaxed text-muted">
        Counted only from invoices a client signed with their own wallet. Invoices signed by the freelancer's own wallet and test invoices
        don't count.
      </p>
    </div>
  );
}

function Fact({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg bg-ink px-3 py-2">
      <div className="text-xl font-semibold text-raised">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
