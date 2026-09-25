const BASE = import.meta.env.VITE_API_URL ?? "";
const TOKEN_KEY = "horos_token";

export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const t = auth.get();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

/** 6-decimal minor units (string from the API) → display string. */
export function fmt(minor: string | number | bigint | null | undefined, currency = ""): string {
  if (minor === null || minor === undefined) return "—";
  const v = BigInt(minor);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${frac}${currency ? ` ${currency}` : ""}`;
}

export const pct = (bps: number | undefined | null) => (bps == null ? "—" : `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`);
export const date = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
