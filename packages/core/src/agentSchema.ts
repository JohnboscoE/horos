// Zod v4 (shipped inside zod@3.25 as "zod/v4"): required by the Anthropic SDK's zodOutputFormat helper.
import { z } from "zod/v4";

/** Strict JSON the model must return. Anything else is retried once, then replaced by a deterministic fallback. */

const bps = z.number().int().min(0).max(10_000);
const minorString = z.string().regex(/^\d+$/, "minor units as a base-10 integer string");

const common = {
  reasoning: z.string().min(20).max(2_000),
  evidence_refs: z.array(z.string().min(1).max(120)).min(1).max(20),
  confidence: z.number().min(0).max(1),
};

export const SetTermsProposal = z
  .object({
    decision_type: z.literal("SET_TERMS"),
    action: z.literal("PROPOSE_TERMS"),
    params: z
      .object({
        net_days: z.number().int().min(0).max(365),
        deposit_bps: bps,
        early_pay_discount_bps: bps,
      })
      .strict(),
    ...common,
  })
  .strict();

export const EarlyPayOfferProposal = z
  .object({
    decision_type: z.literal("EARLY_PAY_OFFER"),
    action: z.enum(["OFFER_DISCOUNTS", "NO_OFFER"]),
    params: z
      .object({
        offers: z
          .array(
            z
              .object({
                invoice_id: z.string().min(1),
                discount_bps: bps,
                valid_for_days: z.number().int().min(1).max(30),
              })
              .strict(),
          )
          .max(20),
      })
      .strict(),
    ...common,
  })
  .strict();

export const COLLECTION_ACTIONS = [
  "REMINDER",
  "DISCOUNT_OFFER",
  "LATE_FEE_NOTICE",
  "ESCALATE",
  "FLAG_PAUSE_WORK",
] as const;
export type CollectionAction = (typeof COLLECTION_ACTIONS)[number];

export const CollectionStepProposal = z
  .object({
    decision_type: z.literal("COLLECTION_STEP"),
    action: z.enum(COLLECTION_ACTIONS),
    params: z
      .object({
        discount_bps: bps.optional(),
        late_fee_bps: bps.optional(),
        message: z.string().min(1).max(1_200),
      })
      .strict(),
    ...common,
  })
  .strict();

export const ReconcileProposal = z
  .object({
    decision_type: z.literal("RECONCILE"),
    action: z.enum(["PROPOSE_REFUND", "REQUEST_BALANCE", "NO_ACTION"]),
    params: z
      .object({
        refund_amount_minor: minorString.optional(),
        note: z.string().min(1).max(600),
      })
      .strict(),
    ...common,
  })
  .strict();

export const AgentProposal = z.discriminatedUnion("decision_type", [
  SetTermsProposal,
  EarlyPayOfferProposal,
  CollectionStepProposal,
  ReconcileProposal,
]);

export type AgentProposal = z.infer<typeof AgentProposal>;
export type SetTermsProposal = z.infer<typeof SetTermsProposal>;
export type EarlyPayOfferProposal = z.infer<typeof EarlyPayOfferProposal>;
export type CollectionStepProposal = z.infer<typeof CollectionStepProposal>;
export type ReconcileProposal = z.infer<typeof ReconcileProposal>;
export type DecisionType = AgentProposal["decision_type"];

/**
 * Every evidence ref the model cites must exist in the snapshot it was given.
 * Returns the refs that don't, which makes the output invalid.
 */
export function unknownEvidenceRefs(proposal: Pick<AgentProposal, "evidence_refs">, available: Iterable<string>): string[] {
  const set = new Set(available);
  return proposal.evidence_refs.filter((r) => !set.has(r));
}
