import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { loadConfig } from "../src/env.js";
import { buildContext } from "../src/bootstrap.js";
import { createApp, tick } from "../src/app.js";
import type { Ctx } from "../src/context.js";
import type { MockChain } from "../src/chain/reader.js";

let ctx: Ctx & { mockChain: MockChain | null };
let app: ReturnType<typeof createApp>;
const clock = new Date("2026-10-01T12:00:00Z");
const clientA = privateKeyToAccount(generatePrivateKey());
const clientB = privateKeyToAccount(generatePrivateKey());

async function signupAs(name: string) {
  const r = await request(app).post("/api/signup").send({ name, email: `${name.toLowerCase()}@example.com` });
  expect(r.status).toBe(201);
  return { token: r.body.token as string, id: r.body.freelancerId as string };
}

async function newInvoice(token: string, body: object) {
  const r = await request(app).post("/api/invoices").set("authorization", `Bearer ${token}`).send({ clientName: "Acme DAO", amount: "100", ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.invoice as { id: string; pay_token: string; invoice_hash: string };
}

async function signPage(payToken: string, signer = clientA) {
  const page = await request(app).get(`/api/pay/${payToken}`);
  const td = page.body.typedData;
  const message = { ...td.message, amount: BigInt(td.message.amount), dueDate: BigInt(td.message.dueDate) };
  const signature = await signer.signTypedData({ domain: td.domain, types: td.types, primaryType: "Invoice", message });
  return { page, signature };
}

beforeAll(async () => {
  const cfg = loadConfig({ NETWORK: "testnet", MOCK_CIRCLE: "true", MOCK_AGENT: "true", MAX_INVOICE_USDC: "5000" } as NodeJS.ProcessEnv);
  ctx = await buildContext(cfg, { memoryDb: true });
  ctx.now = () => clock;
  app = createApp(ctx);
}, 60_000);

describe("proof of work and the freelancer record", () => {
  let ada: { token: string; id: string };
  let inv: Awaited<ReturnType<typeof newInvoice>>;

  it("the client signs the work link: it's in the EIP-712 message with an acceptance sentence", async () => {
    ada = await signupAs("Ada");
    inv = await newInvoice(ada.token, { description: "Landing page redesign", deliverableUrl: "https://figma.com/file/abc" });
    const page = await request(app).get(`/api/pay/${inv.pay_token}`);
    expect(page.body.invoice.deliverableUrl).toBe("https://figma.com/file/abc");
    expect(page.body.typedData.message.deliverable).toBe("https://figma.com/file/abc");
    expect(page.body.typedData.message.description).toBe("Landing page redesign");
    expect(page.body.typedData.message.acceptance).toMatch(/received the work/);
    expect(page.body.typedData.types.Invoice.map((f: { name: string }) => f.name)).toContain("deliverable");
  });

  it("only http(s) links are accepted", async () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "not a url"]) {
      const r = await request(app).post("/api/invoices").set("authorization", `Bearer ${ada.token}`).send({ clientName: "Acme DAO", amount: "1", deliverableUrl: bad });
      expect(r.status, bad).toBe(400);
    }
  });

  it("changing the link before signing rebuilds the message, so an old signature no longer verifies", async () => {
    const { signature } = await signPage(inv.pay_token);
    const r = await request(app).put(`/api/invoices/${inv.id}/deliverable`).set("authorization", `Bearer ${ada.token}`).send({ url: "https://github.com/ada/site" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.invoice.invoice_hash).not.toBe(inv.invoice_hash);
    const stale = await request(app).post(`/api/pay/${inv.pay_token}/ack`).send({ signature, signer: clientA.address });
    expect(stale.status).toBe(400);
    const fresh = await signPage(inv.pay_token);
    expect(fresh.page.body.typedData.message.deliverable).toBe("https://github.com/ada/site");
    const ok = await request(app).post(`/api/pay/${inv.pay_token}/ack`).send({ signature: fresh.signature, signer: clientA.address });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("after the client signs, the link is locked", async () => {
    const r = await request(app).put(`/api/invoices/${inv.id}/deliverable`).set("authorization", `Bearer ${ada.token}`).send({ url: "https://evil.example" });
    expect(r.status).toBe(409);
  });

  it("another freelancer can't change the link", async () => {
    const bob = await signupAs("Bob");
    const other = await newInvoice(ada.token, {});
    const r = await request(app).put(`/api/invoices/${other.id}/deliverable`).set("authorization", `Bearer ${bob.token}`).send({ url: "https://x.example" });
    expect(r.status).toBe(404);
  });

  it("the public record counts signed invoices, distinct clients, on-time payments and proof of work", async () => {
    await request(app).post(`/api/dev/pay/${inv.pay_token}`).send({ amount: "100" });
    await tick(ctx);
    const second = await newInvoice(ada.token, { clientName: "Beta Labs" });
    const { signature } = await signPage(second.pay_token, clientB);
    await request(app).post(`/api/pay/${second.pay_token}/ack`).send({ signature, signer: clientB.address });

    const r = await request(app).get(`/api/freelancers/${ada.id}/record`);
    expect(r.status).toBe(200);
    expect(r.body.freelancer.name).toBe("Ada");
    expect(r.body.counts).toMatchObject({ signedInvoices: 2, distinctClients: 2, paid: 1, paidOnTime: 1, withProofOfWork: 1 });
    expect(JSON.stringify(r.body)).not.toMatch(/Acme|Beta/); // no client names on the freelancer's page

    const page = await request(app).get(`/api/pay/${second.pay_token}`);
    expect(page.body.freelancerRecord.counts.signedInvoices).toBe(2);
  });

  it("invoices signed with the freelancer's own wallet don't count", async () => {
    const [fr] = await ctx.db.query<{ main_wallet_address: string }>("SELECT main_wallet_address FROM freelancers WHERE id = $1", [ada.id]);
    const self = await newInvoice(ada.token, { clientName: "Self Co" });
    await ctx.db.query("UPDATE invoices SET ack_method = 'EIP712', ack_signer = $2, ack_at = now() WHERE id = $1", [self.id, fr!.main_wallet_address]);
    const r = await request(app).get(`/api/freelancers/${ada.id}/record`);
    expect(r.body.counts.signedInvoices).toBe(2);
  });

  it("unknown freelancers are a 404", async () => {
    expect((await request(app).get("/api/freelancers/fl_nope/record")).status).toBe(404);
  });
});
