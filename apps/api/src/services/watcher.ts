import { attributeBalanceChange, minorFromString } from "@horos/core";
import { getAddress, type Address } from "viem";
import type { Ctx } from "../context.js";
import type { IncomingTransfer } from "../chain/reader.js";
import { ingestPayments } from "./payments.js";

const MAX_BLOCK_RANGE = 5_000n;
const MAX_CATCHUP = 50_000n;
const ADDRESS_CHUNK = 100;

interface Watched {
  id: string;
  deposit_address: string;
  currency: "USDC" | "EURC";
  paid_minor: string;
  outgoing_minor: string;
}

/**
 * One watcher pass.
 *
 * Detection is by balance, not by logs: expected = recorded incoming - our own outgoing (refunds + gas).
 * If the ERC-20 balance at block B exceeds expected, the difference is a payment. Transfer logs in
 * (lastBlock, B] only attribute it to a tx and sender; anything unexplained by logs (e.g. a native
 * transfer) is recorded under a deterministic (address, block) key. Balance and logs are both read at
 * the same block B so RPC lag can't split them.
 */
let running: Promise<unknown> = Promise.resolve();

/**
 * Passes never overlap in a process: two concurrent passes can read the same balance change and credit
 * it twice (once via its log, once as unattributed). Run a single worker process per database.
 */
export function watchOnce(ctx: Ctx): Promise<{ block: bigint; detected: number; anomalies: string[] }> {
  return withWatcherLock(() => watchPass(ctx));
}

/** Runs `fn` in the watcher's queue, so nothing else that records payments overlaps a watcher pass. */
export function withWatcherLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = running.then(fn);
  running = next.catch(() => {});
  return next;
}

/**
 * The client reports the transaction they just sent. We read it from the chain ourselves and record
 * only USDC transfers to this invoice's deposit address, so the client can't claim anything that
 * didn't happen. Idempotent with the watcher (same UNIQUE(tx_hash, log_index), same queue).
 */
export async function recordReportedPayment(
  ctx: Ctx,
  invoice: { id: string; deposit_address: string; currency: "USDC" | "EURC" },
  txHash: `0x${string}`,
): Promise<{ state: "recorded" | "already_recorded" | "pending" | "no_transfer"; amountMinor: bigint }> {
  const token = invoice.currency === "USDC" ? ctx.cfg.network.usdc : ctx.cfg.network.eurc;
  if (!token) return { state: "no_transfer", amountMinor: 0n };
  return withWatcherLock(async () => {
    const transfers = await ctx.chain.transfersInTx(txHash, token);
    if (transfers === null) return { state: "pending" as const, amountMinor: 0n };
    const mine = transfers.filter((t) => t.to.toLowerCase() === invoice.deposit_address.toLowerCase() && t.amount > 0n);
    if (mine.length === 0) return { state: "no_transfer" as const, amountMinor: 0n };
    const amountMinor = mine.reduce((s, t) => s + t.amount, 0n);
    const inserted = await ingestPayments(
      ctx,
      invoice.id,
      mine.map((t) => ({ txHash: t.txHash, logIndex: t.logIndex, from: t.from, amount: t.amount, attributed: true })),
      mine[0]!.blockNumber,
    );
    return { state: inserted > 0 ? ("recorded" as const) : ("already_recorded" as const), amountMinor };
  });
}

async function watchPass(ctx: Ctx): Promise<{ block: bigint; detected: number; anomalies: string[] }> {
  const latest = await ctx.chain.latestBlock();
  const lastRow = await ctx.db.query<{ value: string }>("SELECT value FROM kv WHERE key = 'watcher_last_block'");
  let last = lastRow[0] ? BigInt(lastRow[0].value) : latest - 1n;
  // Far behind (worker was down, or the cursor came from another chain, e.g. the in-memory demo chain):
  // jump to near the head. Detection is by balance, so nothing is missed; transfers older than the
  // window are recorded without their log attribution (sender) instead of crawling millions of blocks.
  if (latest - last > MAX_CATCHUP || last > latest) {
    console.warn(`[watcher] cursor at block ${last}, head is ${latest}: jumping ahead`);
    last = latest - MAX_BLOCK_RANGE;
  }
  const to = latest - last > MAX_BLOCK_RANGE ? last + MAX_BLOCK_RANGE : latest;
  const from = last + 1n;

  const watched = await ctx.db.query<Watched>(
    `SELECT id, deposit_address, currency, paid_minor, outgoing_minor FROM invoices
     WHERE deposit_address IS NOT NULL AND status <> 'DRAFT' AND network = $1
       AND created_at > now() - interval '120 days'`,
    [ctx.cfg.network.network],
  );

  let detected = 0;
  const anomalies: string[] = [];
  for (const currency of ["USDC", "EURC"] as const) {
    const token = currency === "USDC" ? ctx.cfg.network.usdc : ctx.cfg.network.eurc;
    const group = watched.filter((w) => w.currency === currency);
    if (!token || group.length === 0) continue;

    const logs: IncomingTransfer[] = [];
    for (let i = 0; i < group.length; i += ADDRESS_CHUNK) {
      const addrs = group.slice(i, i + ADDRESS_CHUNK).map((w) => getAddress(w.deposit_address));
      logs.push(...(await ctx.chain.incomingTransfers(token, addrs, from, to)));
    }

    for (const w of group) {
      const addr = getAddress(w.deposit_address) as Address;
      const balance = await ctx.chain.tokenBalance(token, addr, to);
      const expected = minorFromString(w.paid_minor) - minorFromString(w.outgoing_minor);
      const mine = logs.filter((l) => l.to.toLowerCase() === addr.toLowerCase());
      if (balance === expected && mine.length === 0) continue;

      // Drop logs we've already recorded (e.g. a previous pass processed part of this range).
      const fresh: IncomingTransfer[] = [];
      for (const l of mine) {
        const seen = await ctx.db.query("SELECT 1 FROM payments WHERE tx_hash = $1 AND log_index = $2", [l.txHash, l.logIndex]);
        if (!seen[0]) fresh.push(l);
      }
      const r = attributeBalanceChange({
        address: addr,
        blockNumber: to,
        previousBalance: expected,
        currentBalance: balance,
        incomingTransfers: fresh,
        knownOutgoing: 0n,
      });
      if (r.anomaly) {
        // Never ingest on an anomaly: a later pass (or a human) resolves it without double counting.
        anomalies.push(`${w.id}: ${r.anomaly}`);
        continue;
      }
      if (r.payments.length) detected += await ingestPayments(ctx, w.id, r.payments, to);
    }
  }

  await ctx.db.query(
    "INSERT INTO kv (key, value) VALUES ('watcher_last_block', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [to.toString()],
  );
  for (const a of anomalies) console.warn(`[watcher] anomaly ${a}`);
  return { block: to, detected, anomalies };
}
