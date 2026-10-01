import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Copy, ShieldCheck } from "lucide-react";
import { api } from "../api";
import type { FreelancerRecordData } from "./FreelancerRecord";

/** The freelancer's own view of their public record, with the link to send prospective clients. */
export function ShareRecord({ freelancerId }: { freelancerId: string }) {
  const [r, setR] = useState<FreelancerRecordData | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api(`/api/freelancers/${freelancerId}/record`).then(setR).catch(() => {});
  }, [freelancerId]);
  const url = `${window.location.origin}/freelancers/${freelancerId}`;
  const c = r?.counts;

  return (
    <div className="card flex flex-col gap-4 md:flex-row md:items-center">
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" /> Your public record
        </div>
        <p className="text-sm text-muted">
          {c && c.signedInvoices > 0
            ? `${c.signedInvoices} client-signed invoice${c.signedInvoices === 1 ? "" : "s"} from ${c.distinctClients} client${c.distinctClients === 1 ? "" : "s"} · ${c.paidOnTime}/${c.paid} paid on time · ${c.withProofOfWork} with linked work.`
            : "Empty for now. It grows each time a client signs one of your invoices."}{" "}
          Send this link to new clients so they can check you before work starts.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          className="btn-ghost px-3 py-1.5"
          onClick={() => {
            void navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} {copied ? "Copied" : "Copy link"}
        </button>
        <Link to={`/freelancers/${freelancerId}`} className="btn-ghost px-3 py-1.5">
          View <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
