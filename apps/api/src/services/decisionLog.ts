import { GENESIS_HASH, signEntry, verifyChain, type LogBody, type LogEntry } from "@horos/core";
import type { Address, Hex } from "viem";
import type { Queryable } from "../db/db.js";
import type { Ctx } from "../context.js";

/** Serializes appends across processes (API + worker) sharing one database. */
const LOG_LOCK = 470_301;

interface LogRow {
  seq: number;
  prev_hash: string;
  entry_hash: string;
  body: LogBody;
  signature: string;
  signer: string;
}

/** Append one entry. Must run inside a transaction (`q`) so the entry commits with the change it records. */
export async function appendLog(ctx: Ctx, q: Queryable, body: LogBody): Promise<LogEntry> {
  await q.query("SELECT pg_advisory_xact_lock($1)", [LOG_LOCK]);
  const head = await q.query<{ seq: number; entry_hash: string }>(
    "SELECT seq, entry_hash FROM decision_log ORDER BY seq DESC LIMIT 1",
  );
  const seq = head[0] ? head[0].seq + 1 : 0;
  const prev = (head[0]?.entry_hash as Hex | undefined) ?? GENESIS_HASH;
  const entry = await signEntry(ctx.logSigner, seq, prev, body);
  await q.query(
    `INSERT INTO decision_log (seq, prev_hash, entry_hash, body, signature, signer, decision_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [seq, prev, entry.entryHash, JSON.stringify(body), entry.signature, ctx.logSigner.address, body.decisionId],
  );
  return entry;
}

function toEntry(r: LogRow): LogEntry {
  return {
    seq: r.seq,
    prevHash: r.prev_hash as Hex,
    entryHash: r.entry_hash as Hex,
    body: r.body,
    signature: r.signature as Hex,
  };
}

export async function readLog(ctx: Ctx, opts: { decisionId?: string; fromSeq?: number; limit?: number } = {}) {
  if (opts.decisionId) {
    const rows = await ctx.db.query<LogRow>("SELECT * FROM decision_log WHERE decision_id = $1 ORDER BY seq", [opts.decisionId]);
    return rows.map(toEntry);
  }
  const rows = await ctx.db.query<LogRow>("SELECT * FROM decision_log WHERE seq >= $1 ORDER BY seq LIMIT $2", [
    opts.fromSeq ?? 0,
    opts.limit ?? 500,
  ]);
  return rows.map(toEntry);
}

/** Verify the chain (or from `fromSeq`) against the current signer plus explicitly trusted rotated-out keys. */
export async function verifyLog(ctx: Ctx, fromSeq = 0) {
  const rows = await ctx.db.query<LogRow>("SELECT * FROM decision_log WHERE seq >= $1 ORDER BY seq", [fromSeq]);
  const signers: Address[] = [ctx.logSigner.address, ...ctx.cfg.previousLogSigners];
  let start: Hex = GENESIS_HASH;
  if (fromSeq > 0) {
    const prev = await ctx.db.query<{ entry_hash: string }>("SELECT entry_hash FROM decision_log WHERE seq = $1", [fromSeq - 1]);
    start = (prev[0]?.entry_hash as Hex) ?? GENESIS_HASH;
  }
  return verifyChain(rows.map(toEntry), signers, start);
}

export async function logHead(ctx: Ctx): Promise<{ count: number; head: Hex }> {
  const r = await ctx.db.query<{ seq: number; entry_hash: string }>("SELECT seq, entry_hash FROM decision_log ORDER BY seq DESC LIMIT 1");
  return r[0] ? { count: r[0].seq + 1, head: r[0].entry_hash as Hex } : { count: 0, head: GENESIS_HASH };
}
