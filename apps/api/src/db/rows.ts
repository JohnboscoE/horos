import type { InvoiceStatus } from "@horos/core";

// BIGINT columns arrive as strings (node-postgres and PGlite); JSONB as parsed objects.

export interface InvoiceRow {
  id: string;
  freelancer_id: string;
  client_id: string;
  currency: "USDC" | "EURC";
  amount_minor: string;
  description: string;
  issued_at: Date;
  due_date: Date | null;
  terms_json: InvoiceTerms | null;
  status: InvoiceStatus;
  invoice_hash: string | null;
  deposit_wallet_id: string | null;
  deposit_address: string | null;
  pay_token: string;
  ack_signature: string | null;
  ack_signer: string | null;
  ack_method: "EIP712" | "EMAIL" | null;
  ack_at: Date | null;
  paid_at: Date | null;
  paid_minor: string;
  outgoing_minor: string;
  off_platform: boolean;
  is_self_test: boolean;
  network: string;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceTerms {
  net_days: number;
  deposit_bps: number;
  early_pay_discount_bps: number;
  decision_id: string;
  /** The exact EIP-712 message the client signs (amount/dueDate as decimal strings). */
  ack_message: Record<string, string | number>;
  early_pay_offer?: { discount_bps: number; expires_at: string; decision_id: string };
}

export interface ClientRow {
  id: string;
  display_name: string;
  org_slug: string;
  salt: string | null;
  client_id_hash: string | null;
  claimed_by_address: string | null;
}

export interface FreelancerRow {
  id: string;
  name: string;
  email: string;
  main_wallet_id: string | null;
  main_wallet_address: string | null;
  is_self_test: boolean;
}

export interface PolicyRow {
  freelancer_id: string;
  min_terms_days: number;
  max_terms_days: number;
  max_discount_bps: number;
  max_deposit_bps: number;
  late_fee_bps_cap: number;
  approval_threshold_minor: string;
}

export interface DecisionRow {
  id: string;
  freelancer_id: string;
  subject_type: "invoice" | "freelancer";
  subject_id: string;
  decision_type: string;
  trigger_key: string;
  input_snapshot: unknown;
  input_snapshot_hash: string;
  proposal_json: import("@horos/core").AgentProposal;
  reasoning: string;
  evidence_refs: string[];
  source: "MODEL" | "MOCK" | "FALLBACK" | "MANUAL";
  model: string | null;
  policy_result: import("@horos/core").PolicyResult;
  final_status: "AUTO_APPLIED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "POLICY_REJECTED" | "EXECUTED" | "FAILED";
  decided_by: string | null;
  created_at: Date;
}

export interface RefundRow {
  id: string;
  invoice_id: string;
  decision_id: string | null;
  amount_minor: string;
  suggested_address: string | null;
  to_address: string | null;
  confirm_token: string;
  status: "AWAITING_PAYER" | "READY" | "SUBMITTED" | "COMPLETED" | "FAILED" | "CANCELLED";
  idempotency_key: string;
  circle_tx_id: string | null;
  tx_hash: string | null;
  attempts: number;
}
