/**
 * All Horos accounting happens in ERC-20 minor units (6 decimals for USDC and EURC).
 *
 * Arc gotcha: native USDC (gas, msg.value, eth_getBalance) uses 18 decimals, while the USDC ERC-20
 * interface uses 6 decimals. Both views share one balance. Every conversion goes through this file.
 */

export const TOKEN_DECIMALS = 6;
export const NATIVE_DECIMALS = 18;
export const ONE_TOKEN = 10n ** BigInt(TOKEN_DECIMALS); // 1_000_000n
const NATIVE_PER_MINOR = 10n ** BigInt(NATIVE_DECIMALS - TOKEN_DECIMALS); // 1e12

export const BPS_DENOMINATOR = 10_000n;

const AMOUNT_RE = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;

/** Parse a human decimal string ("12.5") into minor units. Rejects negatives, exponents and >6 decimals. */
export function parseAmount(input: string): bigint {
  const s = input.trim();
  const m = AMOUNT_RE.exec(s);
  if (!m) throw new Error(`Invalid amount "${input}": expected a non-negative decimal with at most 6 places`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? "").padEnd(TOKEN_DECIMALS, "0"));
  return whole * ONE_TOKEN + frac;
}

/** Format minor units as a decimal string with at least 2 and at most 6 fraction digits. */
export function formatAmount(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = abs / ONE_TOKEN;
  let frac = (abs % ONE_TOKEN).toString().padStart(TOKEN_DECIMALS, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

/**
 * Convert an 18-decimal native balance (eth_getBalance on Arc) to 6-decimal minor units.
 * Rounds down; `dust` is the sub-minor remainder that cannot be represented in ERC-20 units.
 */
export function nativeToMinor(wei: bigint): { minor: bigint; dust: bigint } {
  if (wei < 0n) throw new Error("Negative native amount");
  return { minor: wei / NATIVE_PER_MINOR, dust: wei % NATIVE_PER_MINOR };
}

/** Convert 6-decimal minor units to the 18-decimal native representation. */
export function minorToNative(minor: bigint): bigint {
  if (minor < 0n) throw new Error("Negative minor amount");
  return minor * NATIVE_PER_MINOR;
}

/** Apply basis points, rounding down. */
export function applyBps(amount: bigint, bps: number | bigint): bigint {
  const b = BigInt(bps);
  if (b < 0n || b > BPS_DENOMINATOR) throw new Error(`bps out of range: ${bps}`);
  return (amount * b) / BPS_DENOMINATOR;
}

export type AmountBand = 0 | 1 | 2 | 3;

/** 0 = <100 · 1 = 100–999 · 2 = 1,000–9,999 · 3 = >=10,000 (USDC-equivalent minor units). */
export function amountBand(minorUsdcEquivalent: bigint): AmountBand {
  if (minorUsdcEquivalent < 0n) throw new Error("Negative amount");
  if (minorUsdcEquivalent < 100n * ONE_TOKEN) return 0;
  if (minorUsdcEquivalent < 1_000n * ONE_TOKEN) return 1;
  if (minorUsdcEquivalent < 10_000n * ONE_TOKEN) return 2;
  return 3;
}

export const AMOUNT_BAND_LABELS: Record<AmountBand, string> = {
  0: "< 100",
  1: "100 – 999",
  2: "1,000 – 9,999",
  3: "10,000+",
};

/** Serialize bigint minor units for JSON / Postgres (BIGINT round-trips as string in node-postgres). */
export function minorToString(minor: bigint): string {
  return minor.toString();
}

export function minorFromString(s: string | number | bigint): bigint {
  if (typeof s === "bigint") return s;
  if (typeof s === "number") {
    if (!Number.isSafeInteger(s)) throw new Error(`Unsafe integer minor amount: ${s}`);
    return BigInt(s);
  }
  if (!/^-?\d+$/.test(s)) throw new Error(`Invalid minor amount string: ${s}`);
  return BigInt(s);
}
