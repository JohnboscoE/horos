import type { Hex } from "viem";
import type { Ctx } from "../context.js";
import { newId } from "../context.js";
import type { Queryable } from "../db/db.js";

type Kind = "RECORD_ACK" | "RECORD_SETTLED" | "RECORD_DISPUTE" | "RESOLVE_DISPUTE" | "ANCHOR";

/** Durable outbox: written in the same transaction as the state change it reflects. */
export async function enqueueChainJob(q: Queryable, kind: Kind, jobKey: string, payload: Record<string, unknown>) {
  await q.query(
    `INSERT INTO chain_jobs (id, kind, job_key, payload, status) VALUES ($1,$2,$3,$4,'PENDING')
     ON CONFLICT (job_key) DO NOTHING`,
    [newId("job"), kind, jobKey, JSON.stringify(payload)],
  );
}

interface JobRow {
  id: string;
  kind: Kind;
  job_key: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const MAX_ATTEMPTS = 8;
/** Settle/dispute writes need the ack to exist onchain first, so process in this order. */
const ORDER = ["RECORD_ACK", "RECORD_SETTLED", "RECORD_DISPUTE", "RESOLVE_DISPUTE", "ANCHOR"];

/**
 * Submit pending attester writes. Retries reuse the same job; the contract rejects duplicate writes
 * and the attester treats that as success, so a crash between send and DB update is harmless.
 */
export async function processChainJobs(ctx: Ctx, limit = 20): Promise<number> {
  if (ctx.cfg.killSwitch) return 0;
  const jobs = await ctx.db.query<JobRow>(
    `SELECT id, kind, job_key, payload, attempts FROM chain_jobs
     WHERE status IN ('PENDING','SUBMITTED') AND attempts < $1 ORDER BY created_at LIMIT $2`,
    [MAX_ATTEMPTS, limit],
  );
  jobs.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  let done = 0;
  for (const job of jobs) {
    await ctx.db.query("UPDATE chain_jobs SET status = 'SUBMITTED', attempts = attempts + 1, updated_at = now() WHERE id = $1", [job.id]);
    try {
      const tx = await runJob(ctx, job);
      const txHash = tx === "ALREADY_DONE" ? null : tx;
      await ctx.db.tx(async (q) => {
        await q.query("UPDATE chain_jobs SET status = 'CONFIRMED', tx_hash = $2, last_error = NULL, updated_at = now() WHERE id = $1", [job.id, txHash]);
        await afterConfirm(q, job, txHash);
      });
      done++;
    } catch (e) {
      const failed = job.attempts + 1 >= MAX_ATTEMPTS;
      await ctx.db.query("UPDATE chain_jobs SET status = $2, last_error = $3, updated_at = now() WHERE id = $1", [
        job.id,
        failed ? "FAILED" : "PENDING",
        (e as Error).message.slice(0, 500),
      ]);
      // Stop this round on the first error: later jobs may depend on it (settle needs ack).
      break;
    }
  }
  return done;
}

async function runJob(ctx: Ctx, job: JobRow): Promise<Hex | "ALREADY_DONE"> {
  const p = job.payload;
  switch (job.kind) {
    case "RECORD_ACK":
      return ctx.attester.recordAcknowledged({
        invoiceHash: p.invoiceHash as Hex,
        clientIdHash: p.clientIdHash as Hex,
        freelancerIdHash: p.freelancerIdHash as Hex,
        dueDate: BigInt(p.dueDate as number),
        amountBand: p.amountBand as number,
      });
    case "RECORD_SETTLED":
      return ctx.attester.recordSettled(p.invoiceHash as Hex, BigInt(p.paidAt as number));
    case "RECORD_DISPUTE":
      return ctx.attester.recordDispute(p.invoiceHash as Hex, p.responseHash as Hex);
    case "RESOLVE_DISPUTE":
      return ctx.attester.resolveDispute(p.invoiceHash as Hex);
    case "ANCHOR":
      return ctx.attester.anchor(p.chainHead as Hex, BigInt(p.count as number));
  }
}

async function afterConfirm(q: Queryable, job: JobRow, txHash: Hex | null) {
  const h = job.payload.invoiceHash;
  switch (job.kind) {
    case "RECORD_ACK":
      await q.query("UPDATE record_entries SET ack_tx = COALESCE($2, ack_tx) WHERE invoice_hash = $1", [h, txHash]);
      break;
    case "RECORD_SETTLED":
      await q.query("UPDATE record_entries SET settle_tx = COALESCE($2, settle_tx) WHERE invoice_hash = $1", [h, txHash]);
      break;
    case "RECORD_DISPUTE":
      await q.query("UPDATE record_entries SET dispute_tx = COALESCE($2, dispute_tx) WHERE invoice_hash = $1", [h, txHash]);
      break;
    case "ANCHOR":
      await q.query("UPDATE decision_anchors SET status = 'CONFIRMED', tx_hash = $2 WHERE count = $1", [job.payload.count, txHash]);
      break;
  }
}
