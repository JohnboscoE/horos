import { describe, expect, it } from "vitest";
import {
  amountBand,
  applyBps,
  formatAmount,
  minorFromString,
  minorToNative,
  nativeToMinor,
  parseAmount,
  ONE_TOKEN,
} from "../src/money.js";

describe("parseAmount", () => {
  it("parses whole and fractional amounts into 6-decimal minor units", () => {
    expect(parseAmount("0")).toBe(0n);
    expect(parseAmount("1")).toBe(1_000_000n);
    expect(parseAmount("12.5")).toBe(12_500_000n);
    expect(parseAmount("0.000001")).toBe(1n);
    expect(parseAmount(" 1000.25 ")).toBe(1_000_250_000n);
  });

  it("rejects bad input instead of silently rounding", () => {
    for (const bad of ["", "-1", "1.0000001", "1e6", "01", "1.", ".5", "abc", "1,000"]) {
      expect(() => parseAmount(bad), bad).toThrow();
    }
  });
});

describe("formatAmount", () => {
  it("formats with 2–6 decimals", () => {
    expect(formatAmount(0n)).toBe("0.00");
    expect(formatAmount(1_000_000n)).toBe("1.00");
    expect(formatAmount(12_500_000n)).toBe("12.50");
    expect(formatAmount(1n)).toBe("0.000001");
    expect(formatAmount(-1_230_000n)).toBe("-1.23");
  });

  it("round-trips with parseAmount", () => {
    for (const s of ["0.00", "1.00", "12.50", "0.000001", "999999.123456"]) {
      expect(formatAmount(parseAmount(s))).toBe(s);
    }
  });
});

describe("native (18) ↔ ERC-20 (6) conversion", () => {
  it("1 USDC native = 1e18 wei = 1e6 minor", () => {
    expect(nativeToMinor(10n ** 18n)).toEqual({ minor: ONE_TOKEN, dust: 0n });
    expect(minorToNative(ONE_TOKEN)).toBe(10n ** 18n);
  });

  it("never records the raw native value as minor units (the 1e12 bug)", () => {
    const wei = 5n * 10n ** 18n;
    const { minor } = nativeToMinor(wei);
    expect(minor).toBe(5_000_000n);
    expect(minor).not.toBe(wei);
  });

  it("rounds down and reports dust", () => {
    expect(nativeToMinor(1_000_000_000_001n)).toEqual({ minor: 1n, dust: 1n });
    expect(nativeToMinor(999_999_999_999n)).toEqual({ minor: 0n, dust: 999_999_999_999n });
  });

  it("rejects negatives", () => {
    expect(() => nativeToMinor(-1n)).toThrow();
    expect(() => minorToNative(-1n)).toThrow();
  });
});

describe("amountBand", () => {
  it("uses the spec thresholds", () => {
    expect(amountBand(0n)).toBe(0);
    expect(amountBand(parseAmount("99.999999"))).toBe(0);
    expect(amountBand(parseAmount("100"))).toBe(1);
    expect(amountBand(parseAmount("999.99"))).toBe(1);
    expect(amountBand(parseAmount("1000"))).toBe(2);
    expect(amountBand(parseAmount("9999.999999"))).toBe(2);
    expect(amountBand(parseAmount("10000"))).toBe(3);
  });
});

describe("applyBps", () => {
  it("rounds down", () => {
    expect(applyBps(1_000_000n, 150)).toBe(15_000n);
    expect(applyBps(3n, 5_000)).toBe(1n);
    expect(() => applyBps(1n, 10_001)).toThrow();
  });
});

describe("minorFromString", () => {
  it("accepts Postgres BIGINT strings and rejects decimals", () => {
    expect(minorFromString("123")).toBe(123n);
    expect(() => minorFromString("1.5")).toThrow();
    expect(() => minorFromString(2 ** 60)).toThrow();
  });
});
