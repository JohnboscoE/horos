import type { Queryable } from "../db/db.js";
import { HttpError } from "../errors.js";

/**
 * A freelancer's public track record: the client-side view of "is this person real, and do they deliver?"
 * Facts only, and only from invoices a client signed with a wallet (EIP-712). Self-test invoices and
 * invoices signed by the freelancer's own wallet are left out, so nobody builds a record by paying themselves.
 * Client names are never shown here; the client's side of the record lives on its own public page.
 */
export interface FreelancerRecord {
  freelancer: { id: string; name: string; memberSince: Date };
  counts: {
    signedInvoices: number;
    distinctClients: number;
    paid: number;
    paidOnTime: number;
    withProofOfWork: number;
    disputed: number;
  };
  recent: { month: string; amountBand: number; paid: boolean; onTime: boolean | null; proofOfWork: boolean; disputed: boolean }[];
}

interface Row {
  client_id: string;
  ack_at: Date;
  due_date: Date | null;
  paid_at: Date | null;
  deliverable_url: string | null;
  amount_band: number | null;
  disputed: boolean | null;
}

export async function freelancerRecord(q: Queryable, freelancerId: string): Promise<FreelancerRecord> {
  const fr = (await q.query<{ id: string; name: string; created_at: Date; main_wallet_address: string | null; onboarded_at: Date | null }>(
    "SELECT id, name, created_at, main_wallet_address, onboarded_at FROM freelancers WHERE id = $1",
    [freelancerId],
  ))[0];
  if (!fr || !fr.onboarded_at) throw new HttpError(404, "Freelancer not found");

  const rows = await q.query<Row>(
    `SELECT i.client_id, i.ack_at, i.due_date, i.paid_at, i.deliverable_url, r.amount_band, r.disputed
     FROM invoices i LEFT JOIN record_entries r ON r.invoice_id = i.id
     WHERE i.freelancer_id = $1 AND i.ack_method = 'EIP712' AND NOT i.is_self_test
       AND lower(i.ack_signer) IS DISTINCT FROM lower($2)
     ORDER BY i.ack_at DESC`,
    [fr.id, fr.main_wallet_address],
  );

  const onTime = (r: Row) => (r.paid_at && r.due_date ? new Date(r.paid_at) <= new Date(r.due_date) : null);
  return {
    freelancer: { id: fr.id, name: fr.name, memberSince: fr.created_at },
    counts: {
      signedInvoices: rows.length,
      distinctClients: new Set(rows.map((r) => r.client_id)).size,
      paid: rows.filter((r) => r.paid_at).length,
      paidOnTime: rows.filter((r) => onTime(r) === true).length,
      withProofOfWork: rows.filter((r) => r.deliverable_url).length,
      disputed: rows.filter((r) => r.disputed).length,
    },
    recent: rows.slice(0, 12).map((r) => ({
      month: new Date(r.ack_at).toISOString().slice(0, 7),
      amountBand: r.amount_band ?? 0,
      paid: !!r.paid_at,
      onTime: onTime(r),
      proofOfWork: !!r.deliverable_url,
      disputed: !!r.disputed,
    })),
  };
}
