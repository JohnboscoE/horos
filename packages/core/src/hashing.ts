import {
  encodePacked,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
  isAddressEqual,
  type Address,
  type Hex,
} from "viem";
import { canonicalJson } from "./canonical.js";

/**
 * EIP-712 invoice acknowledgment. The client signs the full invoice (including the agreed terms),
 * so wallets display what is being acknowledged. invoiceHash is the EIP-712 digest, which binds chainId.
 */
export const INVOICE_TYPES = {
  Invoice: [
    { name: "invoiceId", type: "string" },
    { name: "freelancerIdHash", type: "bytes32" },
    { name: "freelancerName", type: "string" },
    { name: "clientOrg", type: "string" },
    { name: "currency", type: "string" },
    { name: "amount", type: "uint256" },
    { name: "dueDate", type: "uint64" },
    { name: "netDays", type: "uint16" },
    { name: "depositBps", type: "uint16" },
    { name: "earlyPayDiscountBps", type: "uint16" },
    { name: "depositAddress", type: "address" },
  ],
} as const;

/**
 * v2 adds proof of work: the client signs the work description, a link to the delivered work and an
 * acceptance sentence, so the signature also confirms the work was received. Invoices whose terms were
 * fixed before v2 keep the v1 type (their stored message has no `acceptance`).
 */
export const INVOICE_TYPES_V2 = {
  Invoice: [
    ...INVOICE_TYPES.Invoice,
    { name: "description", type: "string" },
    { name: "deliverable", type: "string" },
    { name: "acceptance", type: "string" },
  ],
} as const;

export const isV2Invoice = (m: Pick<InvoiceMessage, "acceptance">) => m.acceptance !== undefined;

export function invoiceTypes(message: Pick<InvoiceMessage, "acceptance">) {
  return isV2Invoice(message) ? INVOICE_TYPES_V2 : INVOICE_TYPES;
}

/** The sentence a v2 signer agrees to. */
export function acceptanceText(hasDeliverable: boolean): string {
  return hasDeliverable
    ? "I received the work linked above and accept this invoice and its terms."
    : "I accept this invoice and its terms.";
}

export interface InvoiceMessage {
  invoiceId: string;
  freelancerIdHash: Hex;
  freelancerName: string;
  clientOrg: string;
  currency: "USDC" | "EURC";
  /** Minor units (6 decimals). */
  amount: bigint;
  /** Unix seconds. */
  dueDate: bigint;
  netDays: number;
  depositBps: number;
  earlyPayDiscountBps: number;
  depositAddress: Address;
  /** v2 only: what the work was, a link to it, and the sentence the client signs. Absent on v1 invoices. */
  description?: string;
  deliverable?: string;
  acceptance?: string;
}

export function invoiceDomain(chainId: number) {
  return { name: "Horos", version: "1", chainId } as const;
}

export function invoiceTypedData(chainId: number, message: InvoiceMessage) {
  return {
    domain: invoiceDomain(chainId),
    types: invoiceTypes(message) as typeof INVOICE_TYPES_V2,
    primaryType: "Invoice" as const,
    // A v1 message has no v2 fields and is hashed with the v1 type, so the cast is only for viem's typing.
    message: message as Required<InvoiceMessage>,
  };
}

export function invoiceHash(chainId: number, message: InvoiceMessage): Hex {
  return hashTypedData(invoiceTypedData(chainId, message));
}

/** Returns true iff `signature` is `expectedSigner`'s EIP-712 signature over the invoice. */
export async function verifyInvoiceAck(
  chainId: number,
  message: InvoiceMessage,
  signature: Hex,
  expectedSigner: Address,
): Promise<boolean> {
  try {
    const recovered = await recoverTypedDataAddress({ ...invoiceTypedData(chainId, message), signature });
    return isAddressEqual(recovered, expectedSigner);
  } catch {
    return false;
  }
}

/**
 * Onchain client id. `salt` is private and stored only in our DB: deleting it makes every onchain
 * entry for this client unlinkable (crypto-shredding for erasure requests).
 */
export function clientIdHash(orgSlug: string, salt: Hex): Hex {
  return keccak256(encodePacked(["string", "bytes32"], [orgSlug.toLowerCase(), salt]));
}

export function freelancerIdHash(freelancerId: string): Hex {
  return keccak256(toBytes(`horos:freelancer:${freelancerId}`));
}

/** Hash of any JSON-able value via canonical JSON (used for input snapshots). */
export function hashCanonical(value: unknown): Hex {
  return keccak256(toBytes(canonicalJson(value)));
}
