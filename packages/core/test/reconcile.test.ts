import { describe, expect, it } from "vitest";
import { attributeBalanceChange, classifyPayment } from "../src/reconcile.js";
import { statusAfterPayment, canTransition } from "../src/invoiceState.js";

const AMT = 100_000_000n; // 100 USDC

describe("classifyPayment", () => {
  it("exact", () => {
    expect(classifyPayment(AMT, 0n, AMT)).toEqual({ kind: "EXACT", totalPaid: AMT, outstanding: 0n, excess: 0n });
  });

  it("partial then completing", () => {
    const a = classifyPayment(AMT, 0n, 40_000_000n);
    expect(a).toMatchObject({ kind: "PARTIAL", outstanding: 60_000_000n, excess: 0n });
    const b = classifyPayment(AMT, 40_000_000n, 60_000_000n);
    expect(b).toMatchObject({ kind: "EXACT", outstanding: 0n });
  });

  it("overpaid: excess is only what exceeds the amount", () => {
    expect(classifyPayment(AMT, 40_000_000n, 70_000_000n)).toMatchObject({ kind: "OVERPAID", excess: 10_000_000n });
  });

  it("duplicate: second full payment is entirely excess", () => {
    expect(classifyPayment(AMT, AMT, AMT)).toMatchObject({ kind: "DUPLICATE", excess: AMT, totalPaid: 2n * AMT });
  });

  it("rejects zero/negative incoming", () => {
    expect(() => classifyPayment(AMT, 0n, 0n)).toThrow();
    expect(() => classifyPayment(0n, 0n, 1n)).toThrow();
  });

  it("maps to legal statuses", () => {
    expect(statusAfterPayment("PARTIAL")).toBe("PARTIALLY_PAID");
    expect(statusAfterPayment("EXACT")).toBe("PAID");
    expect(statusAfterPayment("DUPLICATE")).toBe("OVERPAID");
    expect(canTransition("PAID", "OVERPAID")).toBe(true);
    expect(canTransition("PAID", "PARTIALLY_PAID")).toBe(false);
    expect(canTransition("CANCELLED", "PAID")).toBe(false);
    expect(canTransition("ACKNOWLEDGED", "DISPUTED")).toBe(true);
  });
});

describe("attributeBalanceChange", () => {
  const base = { address: "0xAbC", blockNumber: 42n, knownOutgoing: 0n };

  it("attributes logged ERC-20 transfers", () => {
    const r = attributeBalanceChange({
      ...base,
      previousBalance: 0n,
      currentBalance: AMT,
      incomingTransfers: [{ txHash: "0x1", logIndex: 3, from: "0xpayer", amount: AMT }],
    });
    expect(r.anomaly).toBeNull();
    expect(r.payments).toEqual([{ txHash: "0x1", logIndex: 3, from: "0xpayer", amount: AMT, attributed: true }]);
  });

  it("catches a native transfer with no Transfer log", () => {
    const r = attributeBalanceChange({ ...base, previousBalance: 0n, currentBalance: AMT, incomingTransfers: [] });
    expect(r.payments).toEqual([
      { txHash: "balance:0xabc:42", logIndex: -1, from: null, amount: AMT, attributed: false },
    ]);
  });

  it("uses a deterministic key so reprocessing the same block is idempotent", () => {
    const input = { ...base, previousBalance: 0n, currentBalance: 5n, incomingTransfers: [] };
    expect(attributeBalanceChange(input)).toEqual(attributeBalanceChange(input));
  });

  it("accounts for our own outgoing refunds", () => {
    const r = attributeBalanceChange({
      ...base,
      previousBalance: 2n * AMT,
      currentBalance: AMT, // we refunded AMT, nothing came in
      knownOutgoing: AMT,
      incomingTransfers: [],
    });
    expect(r).toEqual({ payments: [], anomaly: null });
  });

  it("flags unexplained outflows", () => {
    const r = attributeBalanceChange({ ...base, previousBalance: AMT, currentBalance: 0n, incomingTransfers: [] });
    expect(r.anomaly).toMatch(/balance fell/);
    expect(r.payments).toEqual([]);
  });

  it("flags logs ahead of balance (RPC lag) without inventing an unattributed payment", () => {
    const r = attributeBalanceChange({
      ...base,
      previousBalance: 0n,
      currentBalance: 0n,
      incomingTransfers: [{ txHash: "0x1", logIndex: 0, from: "0xp", amount: AMT }],
    });
    expect(r.anomaly).toMatch(/RPC lag/);
    expect(r.payments.every((p) => p.attributed)).toBe(true);
  });
});
