import { loadConfig } from "./env.js";
import { buildContext, describeContext } from "./bootstrap.js";
import { tick } from "./app.js";

/**
 * Worker: watcher, collections, early-pay offers, refund executor, anchoring, onchain outbox.
 * Every step is idempotent, so a restart (or two workers) can't double credit or double refund.
 * On boot it simply resumes: SUBMITTED refunds are polled, PENDING chain jobs retried.
 */
const cfg = loadConfig();
const ctx = await buildContext(cfg);
const every = Number(process.env.WORKER_INTERVAL_MS ?? 5_000);
console.log(`[worker] ${describeContext(ctx)} interval=${every}ms`);

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

while (!stopping) {
  const started = Date.now();
  const out = await tick(ctx);
  const w = out.watcher as { detected?: number } | undefined;
  if (w?.detected) console.log(`[worker] detected ${w.detected} payment(s)`);
  await new Promise((r) => setTimeout(r, Math.max(0, every - (Date.now() - started))));
}
await ctx.db.close();
