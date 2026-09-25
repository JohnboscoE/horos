import { describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { GENESIS_HASH, signEntry, verifyChain, type LogBody, type LogEntry } from "../src/decisionLog.js";
import { clientIdHash, freelancerIdHash, invoiceHash, invoiceTypedData, verifyInvoiceAck, type InvoiceMessage } from "../src/hashing.js";
import { canonicalJson } from "../src/canonical.js";

const attester = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());

async function buildChain(n: number): Promise<LogEntry[]> {
  const out: LogEntry[] = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const body: LogBody = { kind: "DECISION_PROPOSED", decisionId: `d${i}`, data: { amount: BigInt(i) * 10n, i }, at: "2026-09-27T00:00:00.000Z" };
    const e = await signEntry(attester, i, prev, body);
    out.push(e);
    prev = e.entryHash;
  }
  return out;
}

describe("canonicalJson", () => {
  it("is key-order independent and handles bigint", () => {
    expect(canonicalJson({ b: 1, a: { d: 2n, c: [1, undefined] } })).toBe(canonicalJson({ a: { c: [1, undefined], d: 2n }, b: 1 }));
    expect(canonicalJson({ x: 1n, y: undefined })).toBe('{"x":"1"}');
  });
});

describe("decision log", () => {
  it("verifies an intact chain", async () => {
    const chain = await buildChain(5);
    const v = await verifyChain(chain, [attester.address]);
    expect(v).toEqual({ ok: true, count: 5, head: chain[4]!.entryHash });
  });

  it("detects a modified entry", async () => {
    const chain = await buildChain(4);
    chain[2] = { ...chain[2]!, body: { ...chain[2]!.body, data: { amount: 999n } } };
    const v = await verifyChain(chain, [attester.address]);
    expect(v).toMatchObject({ ok: false, brokenAt: 2 });
  });

  it("detects a deleted entry", async () => {
    const chain = await buildChain(4);
    chain.splice(1, 1);
    expect((await verifyChain(chain, [attester.address])).ok).toBe(false);
  });

  it("detects a forged signer", async () => {
    const chain = await buildChain(2);
    const forged = await signEntry(other, 2, chain[1]!.entryHash, { kind: "DECISION_APPROVED", decisionId: "x", data: {}, at: "t" });
    const v = await verifyChain([...chain, forged], [attester.address]);
    expect(v).toMatchObject({ ok: false, brokenAt: 2, reason: expect.stringMatching(/unknown key/) });
  });

  it("accepts rotated signers", async () => {
    const chain = await buildChain(1);
    const next = await signEntry(other, 1, chain[0]!.entryHash, { kind: "DECISION_APPROVED", decisionId: "d0", data: {}, at: "t" });
    expect((await verifyChain([...chain, next], [attester.address, other.address])).ok).toBe(true);
  });
});

describe("EIP-712 invoice acknowledgment", () => {
  const client = privateKeyToAccount(generatePrivateKey());
  const msg: InvoiceMessage = {
    invoiceId: "inv_123",
    freelancerIdHash: freelancerIdHash("f1"),
    freelancerName: "Ada",
    clientOrg: "acme-dao",
    currency: "USDC",
    amount: 250_000_000n,
    dueDate: 1_760_000_000n,
    netDays: 14,
    depositBps: 0,
    earlyPayDiscountBps: 150,
    depositAddress: "0x1111111111111111111111111111111111111111",
  };

  it("verifies the client's signature and rejects tampering", async () => {
    const sig = await client.signTypedData(invoiceTypedData(5_042_002, msg));
    expect(await verifyInvoiceAck(5_042_002, msg, sig, client.address)).toBe(true);
    expect(await verifyInvoiceAck(5_042_002, { ...msg, amount: 1n }, sig, client.address)).toBe(false);
    expect(await verifyInvoiceAck(1, msg, sig, client.address)).toBe(false); // other chain
    expect(await verifyInvoiceAck(5_042_002, msg, sig, other.address)).toBe(false);
  });

  it("invoiceHash binds chain and content", () => {
    expect(invoiceHash(5_042_002, msg)).not.toBe(invoiceHash(5_042, msg));
    expect(invoiceHash(5_042_002, msg)).not.toBe(invoiceHash(5_042_002, { ...msg, netDays: 30 }));
  });
});

describe("clientIdHash (crypto-shredding)", () => {
  it("depends on the private salt and normalizes slug case", () => {
    const s1 = `0x${"11".repeat(32)}` as const;
    const s2 = `0x${"22".repeat(32)}` as const;
    expect(clientIdHash("Acme-DAO", s1)).toBe(clientIdHash("acme-dao", s1));
    expect(clientIdHash("acme-dao", s1)).not.toBe(clientIdHash("acme-dao", s2));
  });
});
