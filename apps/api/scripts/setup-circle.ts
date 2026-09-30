/**
 * One-time Circle setup:  pnpm --filter @horos/api setup:circle
 *  1. checks the API key + entity secret work
 *  2. finds or creates the Horos wallet set (idempotent)
 *  3. probes wallet creation on the configured Arc blockchain id (the SDK enum has no Arc entry)
 * Prints the wallet set id to put in CIRCLE_WALLET_SET_ID. Never prints secrets.
 */
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { loadConfig } from "../src/env.js";
import { uuidFromKey } from "../src/circle/circleGateway.js";

const cfg = loadConfig();
if (!cfg.circle) {
  console.error("Circle isn't configured: set CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET and MOCK_CIRCLE=false in .env");
  process.exit(1);
}
const client = initiateDeveloperControlledWalletsClient({ apiKey: cfg.circle.apiKey, entitySecret: cfg.circle.entitySecret });

function explain(e: unknown): string {
  const r = (e as { response?: { status?: number; data?: unknown } }).response;
  if (r) return `HTTP ${r.status}: ${JSON.stringify(r.data)}`;
  return (e as Error).message;
}

// 1 + 2: wallet set (creating one proves both the API key and the entity secret work)
let walletSetId = cfg.circle.walletSetId;
try {
  if (walletSetId) {
    const ws = await client.getWalletSet({ id: walletSetId });
    console.log(`✓ Using existing wallet set ${walletSetId} (${ws.data?.walletSet?.custodyType ?? "?"})`);
  } else {
    const ws = await client.createWalletSet({ name: `horos-${cfg.network.network}`, idempotencyKey: uuidFromKey(`walletset:${cfg.network.network}`) });
    walletSetId = ws.data?.walletSet?.id;
    if (!walletSetId) throw new Error("no wallet set id returned");
    console.log(`✓ API key and entity secret work. Wallet set: ${walletSetId}`);
  }
} catch (e) {
  console.error(`✗ Wallet set step failed: ${explain(e)}`);
  console.error("  If this mentions the entity secret, register it in the Circle console (Wallets → Entity Secret).");
  process.exit(1);
}

// 3: probe the Arc blockchain id
const blockchain = cfg.network.circleBlockchain;
try {
  const w = await client.createWallets({
    walletSetId: walletSetId!,
    blockchains: [blockchain as never],
    count: 1,
    accountType: "EOA",
    metadata: [{ name: "horos-setup-probe", refId: "horos-setup-probe" }],
    idempotencyKey: uuidFromKey(`probe:${blockchain}:${walletSetId}`),
  });
  const wallet = w.data?.wallets?.[0];
  console.log(`✓ Circle accepts blockchain "${blockchain}". Probe wallet ${wallet?.address} (id ${wallet?.id})`);
} catch (e) {
  console.error(`✗ Circle rejected blockchain "${blockchain}": ${explain(e)}`);
  process.exit(2);
}

console.log(`\nCIRCLE_WALLET_SET_ID=${walletSetId}`);
