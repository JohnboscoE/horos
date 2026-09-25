import {
  keccak256,
  recoverMessageAddress,
  toBytes,
  zeroHash,
  isAddressEqual,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import { canonicalJson } from "./canonical.js";

/**
 * Append-only, hash-chained, signed decision log.
 *
 * Each entry is immutable. Status changes (approved, rejected, executed) are new entries that
 * reference the original decision, so the chain is a full audit trail and never needs rewriting.
 *
 *   entryHash = keccak256(canonicalJson({ seq, prevHash, body }))
 *   signature = EIP-191 personal_sign by the attester over the raw 32-byte entryHash
 */

export const GENESIS_HASH: Hex = zeroHash;

export type LogEventKind =
  | "DECISION_PROPOSED"
  | "DECISION_APPROVED"
  | "DECISION_REJECTED"
  | "DECISION_EXECUTED"
  | "DECISION_FAILED"
  | "FALLBACK_USED";

export interface LogBody {
  kind: LogEventKind;
  decisionId: string;
  /** Free-form structured payload; must be canonical-JSON-able. */
  data: Record<string, unknown>;
  /** ISO timestamp. */
  at: string;
}

export interface LogEntry {
  seq: number;
  prevHash: Hex;
  body: LogBody;
  entryHash: Hex;
  signature: Hex;
}

export function computeEntryHash(seq: number, prevHash: Hex, body: LogBody): Hex {
  return keccak256(toBytes(canonicalJson({ seq, prevHash, body })));
}

export async function signEntry(
  signer: LocalAccount,
  seq: number,
  prevHash: Hex,
  body: LogBody,
): Promise<LogEntry> {
  const entryHash = computeEntryHash(seq, prevHash, body);
  const signature = await signer.signMessage({ message: { raw: entryHash } });
  return { seq, prevHash, body, entryHash, signature };
}

export type ChainVerification =
  | { ok: true; count: number; head: Hex }
  | { ok: false; brokenAt: number; reason: string };

/**
 * Verify a contiguous slice of the chain. Pass `startPrevHash` to verify a slice that doesn't start
 * at genesis. Accepts any of `signers` (attester rotation).
 */
export async function verifyChain(
  entries: LogEntry[],
  signers: Address[],
  startPrevHash: Hex = GENESIS_HASH,
): Promise<ChainVerification> {
  let prev = startPrevHash;
  let expectedSeq = entries[0]?.seq ?? 0;
  for (const e of entries) {
    if (e.seq !== expectedSeq) return { ok: false, brokenAt: e.seq, reason: `sequence gap: expected ${expectedSeq}` };
    if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq, reason: "prevHash does not link to previous entry" };
    const recomputed = computeEntryHash(e.seq, e.prevHash, e.body);
    if (recomputed !== e.entryHash) return { ok: false, brokenAt: e.seq, reason: "entryHash mismatch (entry was modified)" };
    let signer: Address;
    try {
      signer = await recoverMessageAddress({ message: { raw: e.entryHash }, signature: e.signature });
    } catch {
      return { ok: false, brokenAt: e.seq, reason: "unrecoverable signature" };
    }
    if (!signers.some((s) => isAddressEqual(s, signer))) {
      return { ok: false, brokenAt: e.seq, reason: `signed by unknown key ${signer}` };
    }
    prev = e.entryHash;
    expectedSeq++;
  }
  return { ok: true, count: entries.length, head: prev };
}
