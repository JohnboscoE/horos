import type { Ctx } from "../context.js";

/**
 * Public traction metrics, generated from the database. Reported per network; self-test invoices and
 * self-test accounts are excluded (SPEC §7: no wash traffic).
 */
export async function metrics(ctx: Ctx) {
  const q = <T>(sql: string, p: unknown[] = []) => ctx.db.query<T>(sql, p);
  const out: Record<string, unknown> = {};
  for (const network of ["testnet", "mainnet"]) {
    const base = "i.network = $1 AND i.is_self_test = FALSE AND f.is_self_test = FALSE";
    const [inv] = await q<Record<string, string>>(
      `SELECT count(*)::text AS invoices,
              count(*) FILTER (WHERE i.ack_method = 'EIP712')::text AS acknowledged,
              count(*) FILTER (WHERE i.paid_at IS NOT NULL)::text AS settled,
              count(*) FILTER (WHERE i.paid_at IS NOT NULL AND i.ack_method = 'EIP712')::text AS acknowledged_settled,
              COALESCE(SUM(i.paid_minor) FILTER (WHERE i.currency = 'USDC'), 0)::text AS usdc_received_minor,
              COALESCE(SUM(i.paid_minor) FILTER (WHERE i.currency = 'EURC'), 0)::text AS eurc_received_minor,
              count(DISTINCT i.freelancer_id)::text AS freelancers,
              count(DISTINCT i.client_id)::text AS clients
       FROM invoices i JOIN freelancers f ON f.id = i.freelancer_id WHERE ${base}`,
      [network],
    );
    const [overlap] = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT i.client_id FROM invoices i JOIN freelancers f ON f.id = i.freelancer_id
         WHERE ${base} GROUP BY i.client_id HAVING count(DISTINCT i.freelancer_id) >= 2) t`,
      [network],
    );
    const [onTime] = await q<{ on_time: string; late: string }>(
      `SELECT count(*) FILTER (WHERE i.paid_at <= i.due_date)::text AS on_time,
              count(*) FILTER (WHERE i.paid_at > i.due_date)::text AS late
       FROM invoices i JOIN freelancers f ON f.id = i.freelancer_id WHERE ${base} AND i.paid_at IS NOT NULL`,
      [network],
    );
    const [refunds] = await q<{ n: string; minor: string }>(
      `SELECT count(*)::text AS n, COALESCE(SUM(r.amount_minor), 0)::text AS minor FROM refund_intents r
       JOIN invoices i ON i.id = r.invoice_id JOIN freelancers f ON f.id = i.freelancer_id WHERE ${base} AND r.status = 'COMPLETED'`,
      [network],
    );
    out[network] = { ...inv, clientsWithMultipleFreelancers: overlap?.n, paidOnTime: onTime?.on_time, paidLate: onTime?.late, refundsCompleted: refunds?.n, refundedMinor: refunds?.minor };
  }
  const decisions = await q<{ decision_type: string; source: string; final_status: string; n: string }>(
    "SELECT decision_type, source, final_status, count(*)::text AS n FROM agent_decisions GROUP BY 1,2,3 ORDER BY 1,2,3",
  );
  const [log] = await q<{ n: string }>("SELECT count(*)::text AS n FROM decision_log");
  const anchors = await q<{ count: number; chain_head: string; tx_hash: string | null; status: string; created_at: Date }>(
    "SELECT count, chain_head, tx_hash, status, created_at FROM decision_anchors ORDER BY count DESC LIMIT 5",
  );
  return { generatedAt: ctx.now().toISOString(), networks: out, decisions, logEntries: log?.n, recentAnchors: anchors };
}
