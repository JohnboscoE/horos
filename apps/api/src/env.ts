import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Repo-root .env first, then apps/api/.env (pnpm runs scripts from the package directory).
loadDotenv({ path: [fileURLToPath(new URL("../../../.env", import.meta.url)), ".env"], quiet: true });
import { NETWORKS, parseAmount, type NetworkConfig } from "@horos/core";
import type { Address, Hex } from "viem";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  ARC_RPC_URLS: optionalString,
  DATABASE_URL: optionalString,
  PGLITE_DIR: optionalString,

  CIRCLE_API_KEY: optionalString,
  CIRCLE_ENTITY_SECRET: optionalString,
  CIRCLE_WALLET_SET_ID: optionalString,
  MOCK_CIRCLE: bool,

  ATTESTER_PRIVATE_KEY: optionalString,
  PREVIOUS_LOG_SIGNERS: optionalString,
  PAYMENT_RECORD_ADDRESS: optionalString,
  DECISION_ANCHOR_ADDRESS: optionalString,

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  MOCK_AGENT: bool,

  ONRAMP_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  ONRAMP_API_KEY: optionalString,
  ONRAMP_REFERRER_DOMAIN: optionalString,

  KILL_SWITCH: bool,
  MAX_INVOICE_USDC: z.string().default("500"),

  PORT: z.coerce.number().int().default(8787),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  PUBLIC_WEB_URL: optionalString,
  ANCHOR_EVERY: z.coerce.number().int().min(1).default(25),
});

export interface AppConfig {
  network: NetworkConfig;
  databaseUrl: string | undefined;
  pgliteDir: string;
  circle: { apiKey: string; entitySecret: string; walletSetId: string | undefined } | null;
  attesterKey: Hex | undefined;
  /** Rotated-out log signer addresses still trusted when verifying old entries. */
  previousLogSigners: Address[];
  paymentRecord: Address | undefined;
  decisionAnchor: Address | undefined;
  anthropic: { apiKey: string; model: string } | null;
  /** Arc App Kit Onramp (pay by card). `live` needs an API key; `preview` simulates locally. */
  onramp: { mode: "live"; apiKey: string; referrerDomain: string } | { mode: "preview" } | { mode: "off" };
  killSwitch: boolean;
  maxInvoiceMinor: bigint;
  port: number;
  webOrigin: string;
  publicWebUrl: string;
  anchorEvery: number;
}

export function loadConfig(raw: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = EnvSchema.parse(raw);
  const base = NETWORKS[env.NETWORK];
  const network: NetworkConfig = env.ARC_RPC_URLS
    ? { ...base, rpcUrls: env.ARC_RPC_URLS.split(",").map((s) => s.trim()).filter(Boolean) }
    : base;

  if (network.network === "mainnet") {
    // Mainnet gate (SPEC §10): refuse to boot on unverified values or mock integrations.
    const problems: string[] = [];
    if (network.unverified.length > 0) problems.push(`unverified network values: ${network.unverified.join(", ")}`);
    if (env.MOCK_CIRCLE) problems.push("MOCK_CIRCLE must be false");
    if (!env.DATABASE_URL) problems.push("DATABASE_URL required (no embedded DB on mainnet)");
    if (problems.length) throw new Error(`Refusing to start on mainnet:\n - ${problems.join("\n - ")}`);
  }

  const useCircle = !env.MOCK_CIRCLE && env.CIRCLE_API_KEY && env.CIRCLE_ENTITY_SECRET;
  const useModel = !env.MOCK_AGENT && env.ANTHROPIC_API_KEY;

  return {
    network,
    databaseUrl: env.DATABASE_URL,
    pgliteDir: env.PGLITE_DIR ?? `.pglite/${env.NETWORK}`,
    circle: useCircle
      ? { apiKey: env.CIRCLE_API_KEY!, entitySecret: env.CIRCLE_ENTITY_SECRET!, walletSetId: env.CIRCLE_WALLET_SET_ID }
      : null,
    attesterKey: env.ATTESTER_PRIVATE_KEY as Hex | undefined,
    previousLogSigners: (env.PREVIOUS_LOG_SIGNERS ?? "").split(",").map((s) => s.trim()).filter(Boolean) as Address[],
    paymentRecord: env.PAYMENT_RECORD_ADDRESS as Address | undefined,
    decisionAnchor: env.DECISION_ANCHOR_ADDRESS as Address | undefined,
    anthropic: useModel ? { apiKey: env.ANTHROPIC_API_KEY!, model: env.ANTHROPIC_MODEL } : null,
    onramp: !env.ONRAMP_ENABLED
      ? { mode: "off" }
      : (env.ONRAMP_API_KEY ?? env.CIRCLE_API_KEY) && !env.MOCK_CIRCLE
        ? {
            mode: "live",
            apiKey: (env.ONRAMP_API_KEY ?? env.CIRCLE_API_KEY)!,
            referrerDomain: env.ONRAMP_REFERRER_DOMAIN ?? new URL(env.PUBLIC_WEB_URL ?? env.WEB_ORIGIN.split(",")[0]!.trim()).hostname,
          }
        : { mode: "preview" },
    killSwitch: env.KILL_SWITCH,
    maxInvoiceMinor: parseAmount(env.MAX_INVOICE_USDC),
    port: env.PORT,
    webOrigin: env.WEB_ORIGIN,
    publicWebUrl: env.PUBLIC_WEB_URL ?? env.WEB_ORIGIN,
    anchorEvery: env.ANCHOR_EVERY,
  };
}
