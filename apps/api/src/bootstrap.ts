import type { AppConfig } from "./env.js";
import { migrate, openDb } from "./db/db.js";
import { MockChain, RpcChainReader, makePublicClient } from "./chain/reader.js";
import { MockAttester, ViemAttester } from "./chain/attester.js";
import { MockCircleGateway } from "./circle/gateway.js";
import { RealCircleGateway } from "./circle/circleGateway.js";
import { resolveLogSigner, type Ctx } from "./context.js";

/**
 * Wire real or mock integrations from config:
 *   MOCK_CIRCLE=true (or no Circle keys) → in-memory Circle + in-memory chain (fully offline dev)
 *   no attester key / contract addresses → mock attester (onchain writes skipped, clearly labelled)
 *   MOCK_AGENT=true (or no Anthropic key) → deterministic agent stub
 */
export async function buildContext(cfg: AppConfig, opts: { memoryDb?: boolean } = {}): Promise<Ctx & { mockChain: MockChain | null }> {
  const db = await openDb({ databaseUrl: cfg.databaseUrl, pgliteDir: cfg.pgliteDir, memory: opts.memoryDb });
  await migrate(db);

  let mockChain: MockChain | null = null;
  let chain;
  let circle;
  if (cfg.circle) {
    if (!cfg.circle.walletSetId) throw new Error("CIRCLE_WALLET_SET_ID is required (run `pnpm --filter @horos/api setup:circle`)");
    circle = new RealCircleGateway(cfg.circle.apiKey, cfg.circle.entitySecret, cfg.circle.walletSetId, cfg.network.circleBlockchain);
    chain = new RpcChainReader(makePublicClient(cfg.network));
  } else {
    mockChain = new MockChain();
    chain = mockChain;
    circle = new MockCircleGateway(mockChain);
  }

  const attester =
    cfg.attesterKey && cfg.paymentRecord && cfg.decisionAnchor
      ? new ViemAttester(cfg.network, makePublicClient(cfg.network), cfg.attesterKey, cfg.paymentRecord, cfg.decisionAnchor)
      : new MockAttester();

  // Loaded lazily so mock mode never depends on the Anthropic SDK.
  const model = cfg.anthropic
    ? new (await import("./agent/model.js")).AnthropicAgentModel(cfg.anthropic.apiKey, cfg.anthropic.model)
    : null;
  const logSigner = await resolveLogSigner(cfg, db);

  return { cfg, db, chain, circle, attester, model, logSigner, now: () => new Date(), mockChain };
}

export function describeContext(ctx: Ctx): string {
  return [
    `network=${ctx.cfg.network.network}`,
    `db=${ctx.cfg.databaseUrl ? "postgres" : "pglite"}`,
    `circle=${ctx.circle.kind}`,
    `attester=${ctx.attester.enabled ? "onchain" : "mock"}`,
    `agent=${ctx.model ? ctx.model.name : "mock"}`,
    `killSwitch=${ctx.cfg.killSwitch}`,
    `logSigner=${ctx.logSigner.address}`,
  ].join(" ");
}
