/**
 * Deterministic JSON: object keys sorted recursively, bigint encoded as decimal string,
 * `undefined` object fields dropped. Used for everything that gets hashed.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "bigint":
      return value.toString();
    case "number":
      if (!Number.isFinite(value)) throw new Error("Non-finite number cannot be canonicalized");
      return value;
    case "string":
    case "boolean":
      return value;
    case "undefined":
      return undefined;
    case "object": {
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalize(v)));
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as object).sort()) {
        const v = normalize((value as Record<string, unknown>)[key]);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    default:
      throw new Error(`Cannot canonicalize value of type ${typeof value}`);
  }
}
