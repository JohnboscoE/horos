import { loadConfig } from "./env.js";
import { buildContext, describeContext } from "./bootstrap.js";
import { createApp, tick } from "./app.js";

const cfg = loadConfig();
const ctx = await buildContext(cfg);
const app = createApp(ctx);

const server = app.listen(cfg.port, () => {
  console.log(`[api] listening on :${cfg.port} ${describeContext(ctx)}`);
});
// Explicit timeouts for long-polling clients behind proxies (Railway).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// With the in-memory chain there is no separate worker process, so run the loops here.
if (ctx.mockChain || process.env.RUN_WORKER_IN_API === "true") {
  const every = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick(ctx);
    } finally {
      running = false;
    }
  }, every);
  console.log(`[api] background loops every ${every}ms`);
}
