import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { loadConfig } from "../src/env.js";
import { buildContext } from "../src/bootstrap.js";
import { createApp } from "../src/app.js";
import type { Ctx } from "../src/context.js";
import type { MockChain } from "../src/chain/reader.js";
import { resetPrivyKeyCache } from "../src/services/privyAuth.js";
import type { VerifiedAccounts } from "../src/services/privyUsers.js";

const APP_ID = "test-privy-app";
let ctx: Ctx & { mockChain: MockChain | null };
let app: ReturnType<typeof createApp>;
let clock = new Date("2026-09-28T12:00:00Z");
let privyToken: (sub: string) => Promise<string>;
const privyAccounts = new Map<string, VerifiedAccounts>();

const alice = privateKeyToAccount(generatePrivateKey()); // Acme's payer
const other = privateKeyToAccount(generatePrivateKey()); // someone else who signed an Acme invoice
const stranger = privateKeyToAccount(generatePrivateKey());

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  privyToken = (sub) =>
    new SignJWT({}).setProtectedHeader({ alg: "ES256" }).setSubject(sub).setIssuer("privy.io").setAudience(APP_ID).setIssuedAt().setExpirationTime("1h").sign(privateKey);
  resetPrivyKeyCache();
  const cfg = loadConfig({
    NETWORK: "testnet",
    MOCK_CIRCLE: "true",
    MOCK_AGENT: "true",
    PRIVY_APP_ID: APP_ID,
    PRIVY_VERIFICATION_KEY: await exportSPKI(publicKey),
  } as NodeJS.ProcessEnv);
  ctx = await buildContext(cfg, { memoryDb: true });
  ctx.now = () => clock;
  // Stand-in for Privy's server API: verified linked accounts per Privy user.
  ctx.privyUsers = { linkedAccounts: async (id) => privyAccounts.get(id) ?? { emails: [], wallets: [] } };
  app = createApp(ctx);
}, 60_000);

async function freelancer(name: string) {
  const r = await request(app).post("/api/signup").send({ name, email: `${name.toLowerCase()}@example.com` });
  return r.body.token as string;
}

async function invoice(token: string, amount: string, clientEmail?: string) {
  const r = await request(app).post("/api/invoices").set("authorization", `Bearer ${token}`).send({ clientName: "Acme DAO", amount, clientEmail });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.invoice as { id: string; pay_token: string; deposit_address: string };
}

async function ack(payToken: string, signer: PrivateKeyAccount) {
  const page = await request(app).get(`/api/pay/${payToken}`);
  const td = page.body.typedData;
  const message = { ...td.message, amount: BigInt(td.message.amount), dueDate: BigInt(td.message.dueDate) };
  const signature = await signer.signTypedData({ domain: td.domain, types: td.types, primaryType: "Invoice", message });
  const r = await request(app).post(`/api/pay/${payToken}/ack`).send({ signature, signer: signer.address });
  expect(r.status).toBe(200);
}

async function walletLogin(acct: PrivateKeyAccount) {
  const n = await request(app).post("/api/client/auth/nonce").send({ address: acct.address });
  const signature = await acct.signMessage({ message: n.body.message });
  return request(app).post("/api/client/auth/wallet").send({ address: acct.address, nonce: n.body.nonce, signature });
}

const dashboard = (token: string) => request(app).get("/api/client/dashboard").set("authorization", `Bearer ${token}`);

let inv1: Awaited<ReturnType<typeof invoice>>;
let inv2: Awaited<ReturnType<typeof invoice>>;
let inv3: Awaited<ReturnType<typeof invoice>>;
let inv4: Awaited<ReturnType<typeof invoice>>;

describe("client dashboard", () => {
  it("setup: two freelancers invoice Acme DAO", async () => {
    const ada = await freelancer("Ada");
    const bob = await freelancer("Bob");
    inv1 = await invoice(ada, "100", "alice@acme.com"); // signed by Alice
    inv2 = await invoice(ada, "50"); // signed by Alice, no email
    inv3 = await invoice(bob, "70"); // signed by someone else at "Acme"
    inv4 = await invoice(bob, "30", "Alice@Acme.com"); // not signed yet, addressed to Alice's email
    await ack(inv1.pay_token, alice);
    await ack(inv2.pay_token, alice);
    await ack(inv3.pay_token, other);
  });

  it("wallet sign-in shows exactly the invoices that wallet signed", async () => {
    const r = await walletLogin(alice);
    expect(r.status).toBe(200);
    const d = await dashboard(r.body.token);
    expect(d.status).toBe(200);
    expect(d.body.invoices.map((i: { id: string }) => i.id).sort()).toEqual([inv1.id, inv2.id].sort());
    expect(d.body.invoices.every((i: { bucket: string }) => i.bucket === "DUE")).toBe(true);
    expect(d.body.totals.outstandingUsdc).toBe("150.00");
    expect(d.body.identities).toEqual([{ kind: "wallet", value: alice.address.toLowerCase(), verifiedVia: "signature" }]);
    expect(d.body.organizations[0]).toMatchObject({ name: "Acme DAO", slug: "acme-dao" });
  });

  it("never shows another freelancer's invoice to the same org (no org-wide access)", async () => {
    const d = await dashboard((await walletLogin(alice)).body.token);
    expect(d.body.invoices.map((i: { id: string }) => i.id)).not.toContain(inv3.id);
    const s = await dashboard((await walletLogin(stranger)).body.token);
    expect(s.body.invoices).toEqual([]);
  });

  it("paid invoices move to PAID", async () => {
    ctx.mockChain!.pay(inv1.deposit_address as `0x${string}`, 100_000_000n);
    await request(app).post(`/api/dev/pay/${inv2.pay_token}`).send({ amount: "0.000001" }); // triggers a watcher pass; tiny partial
    const d = await dashboard((await walletLogin(alice)).body.token);
    const i1 = d.body.invoices.find((i: { id: string }) => i.id === inv1.id);
    expect(i1).toMatchObject({ bucket: "PAID", status: "PAID" });
  });

  it("wallet sign-in challenges are single-use, expire, and must be signed by that wallet", async () => {
    const n = await request(app).post("/api/client/auth/nonce").send({ address: alice.address });
    const sig = await alice.signMessage({ message: n.body.message });
    expect((await request(app).post("/api/client/auth/wallet").send({ address: alice.address, nonce: n.body.nonce, signature: sig })).status).toBe(200);
    expect((await request(app).post("/api/client/auth/wallet").send({ address: alice.address, nonce: n.body.nonce, signature: sig })).status).toBe(401); // replay

    const n2 = await request(app).post("/api/client/auth/nonce").send({ address: alice.address });
    const wrong = await stranger.signMessage({ message: n2.body.message });
    expect((await request(app).post("/api/client/auth/wallet").send({ address: alice.address, nonce: n2.body.nonce, signature: wrong })).status).toBe(401);

    const n3 = await request(app).post("/api/client/auth/nonce").send({ address: alice.address });
    const late = await alice.signMessage({ message: n3.body.message });
    clock = new Date(clock.getTime() + 11 * 60_000);
    expect((await request(app).post("/api/client/auth/wallet").send({ address: alice.address, nonce: n3.body.nonce, signature: late })).status).toBe(401);
  });

  it("Privy sign-in uses Privy's verified email: sees invoices addressed to it, even unsigned", async () => {
    privyAccounts.set("did:privy:alice-email", { emails: ["alice@acme.com"], wallets: [] });
    const r = await request(app).post("/api/client/auth/privy").set("authorization", `Bearer ${await privyToken("did:privy:alice-email")}`).send({});
    expect(r.status).toBe(200);
    const d = await dashboard(r.body.token);
    expect(d.body.invoices.map((i: { id: string }) => i.id).sort()).toEqual([inv1.id, inv4.id].sort());
    expect(d.body.invoices.find((i: { id: string }) => i.id === inv4.id).bucket).toBe("TO_SIGN");
  });

  it("a Privy account with Alice's wallet and email joins her existing client account", async () => {
    privyAccounts.set("did:privy:alice-both", { emails: ["alice.personal@example.com"], wallets: [alice.address.toLowerCase()] });
    const r = await request(app).post("/api/client/auth/privy").set("authorization", `Bearer ${await privyToken("did:privy:alice-both")}`).send({});
    const walletUser = await walletLogin(alice);
    expect(r.body.clientUserId).toBe(walletUser.body.clientUserId);
  });

  it("email sign-in is refused without the Privy app secret, and bad sessions are rejected", async () => {
    const saved = ctx.privyUsers;
    ctx.privyUsers = null;
    const r = await request(app).post("/api/client/auth/privy").set("authorization", `Bearer ${await privyToken("did:privy:x")}`).send({});
    expect(r.status).toBe(501);
    ctx.privyUsers = saved;
    expect((await dashboard("not-a-session")).status).toBe(401);
    // A freelancer session is not a client session.
    const ada = await freelancer("Carol");
    expect((await dashboard(ada)).status).toBe(401);
  });
});
