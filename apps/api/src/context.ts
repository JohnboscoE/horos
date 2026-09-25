import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex, LocalAccount } from "viem";
import type { AppConfig } from "./env.js";
import type { Db } from "./db/db.js";
import type { ChainReader } from "./chain/reader.js";
import type { Attester } from "./chain/attester.js";
import type { CircleGateway } from "./circle/gateway.js";
import type { AgentModel } from "./agent/model.js";

/** Everything services need. Built once in server.ts / worker.ts, or by tests with mocks. */
export interface Ctx {
  cfg: AppConfig;
  db: Db;
  chain: ChainReader;
  attester: Attester;
  circle: CircleGateway;
  /** null → deterministic stub (MOCK_AGENT) */
  model: AgentModel | null;
  /** Signs decision-log entries. Same key as the onchain attester when configured. */
  logSigner: LocalAccount;
  now: () => Date;
}

/**
 * Log signer: the attester key if configured; otherwise (testnet dev only) a local key persisted in
 * the kv table so the chain stays verifiable across restarts.
 */
export async function resolveLogSigner(cfg: AppConfig, db: Db): Promise<LocalAccount> {
  if (cfg.attesterKey) return privateKeyToAccount(cfg.attesterKey);
  if (cfg.network.network === "mainnet") throw new Error("ATTESTER_PRIVATE_KEY is required on mainnet");
  const rows = await db.query<{ value: string }>("SELECT value FROM kv WHERE key = 'dev_log_signer_key'");
  let key = rows[0]?.value as Hex | undefined;
  if (!key) {
    key = `0x${randomBytes(32).toString("hex")}`;
    await db.query("INSERT INTO kv (key, value) VALUES ('dev_log_signer_key', $1) ON CONFLICT (key) DO NOTHING", [key]);
    key = (await db.query<{ value: string }>("SELECT value FROM kv WHERE key = 'dev_log_signer_key'"))[0]!.value as Hex;
  }
  return privateKeyToAccount(key);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}
