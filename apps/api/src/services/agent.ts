import {
  AgentProposal,
  checkPolicy,
  hashCanonical,
  unknownEvidenceRefs,
  type PolicyContext,
  type PolicyResult,
} from "@horos/core";
import type { Ctx } from "../context.js";
import { newId } from "../context.js";
import type { DecisionRow } from "../db/rows.js";
import { fallbackProposal } from "../agent/fallback.js";
import { evidenceKeys, type Snapshot } from "../agent/snapshot.js";
import { appendLog } from "./decisionLog.js";
import { loadPolicy } from "./stats.js";
import { applyDecision } from "./effects.js";
import { HttpError } from "../errors.js";

export interface DecisionRequest {
  freelancerId: string;
  subjectType: "invoice" | "freelancer";
  subjectId: string;
  /** Dedupe key: the same trigger never produces two decisions. */
  triggerKey: string;
  snapshot: Snapshot;
  policyCtx: PolicyContext;
}

type Source = DecisionRow["source"];

interface Attempt {
  ok: boolean;
  error?: string;
  proposal?: AgentProposal;
}

/**
 * The agent loop (SPEC §5.5):
 *   snapshot → model → schema validation → evidence check → policy check → log → (auto-apply | approval queue)
 * The model never touches money or contracts; applyDecision does, and only for AUTO_APPLY/APPROVED.
 */
export async function runDecision(ctx: Ctx, req: DecisionRequest): Promise<DecisionRow> {
  const existing = await ctx.db.query<DecisionRow>("SELECT * FROM agent_decisions WHERE trigger_key = $1", [req.triggerKey]);
  if (existing[0]) return existing[0];

  const policy = await loadPolicy(ctx.db, req.freelancerId);
  const snapshotHash = hashCanonical(req.snapshot);
  const available = evidenceKeys(req.snapshot);
  const attempts: Attempt[] = [];

  const validate = (raw: unknown): Attempt => {
    const parsed = AgentProposal.safeParse(raw);
    if (!parsed.success) return { ok: false, error: `schema: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
    const p = parsed.data;
    if (p.decision_type !== req.snapshot.decisionType) return { ok: false, error: `wrong decision_type ${p.decision_type}` };
    const unknown = unknownEvidenceRefs(p, available);
    if (unknown.length) return { ok: false, error: `unknown evidence refs: ${unknown.join(", ")}` };
    const pr = checkPolicy(p, policy, req.policyCtx);
    if (pr.outcome === "REJECTED") return { ok: false, error: `policy rejected: ${pr.reasons.join("; ")}`, proposal: p };
    return { ok: true, proposal: p };
  };

  let proposal: AgentProposal | undefined;
  let source: Source;
  if (ctx.model) {
    // One try plus one retry, then the deterministic fallback.
    for (let i = 0; i < 2 && !proposal; i++) {
      try {
        const a = validate(await ctx.model.propose(req.snapshot));
        attempts.push(a);
        if (a.ok) proposal = a.proposal;
      } catch (e) {
        attempts.push({ ok: false, error: `model error: ${(e as Error).message}` });
      }
    }
    source = proposal ? "MODEL" : "FALLBACK";
  } else {
    source = "MOCK";
  }
  proposal ??= fallbackProposal(req.snapshot, policy);

  const policyResult: PolicyResult = checkPolicy(proposal, policy, req.policyCtx);
  const finalStatus: DecisionRow["final_status"] =
    policyResult.outcome === "AUTO_APPLY" ? "AUTO_APPLIED" : policyResult.outcome === "NEEDS_APPROVAL" ? "PENDING_APPROVAL" : "POLICY_REJECTED";

  const id = newId("dec");
  const inserted = await ctx.db.tx(async (q) => {
    const rows = await q.query<DecisionRow>(
      `INSERT INTO agent_decisions
        (id, freelancer_id, subject_type, subject_id, decision_type, trigger_key, input_snapshot, input_snapshot_hash,
         proposal_json, reasoning, evidence_refs, source, model, policy_result, final_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (trigger_key) DO NOTHING
       RETURNING *`,
      [
        id,
        req.freelancerId,
        req.subjectType,
        req.subjectId,
        proposal.decision_type,
        req.triggerKey,
        JSON.stringify(req.snapshot),
        snapshotHash,
        JSON.stringify(proposal),
        proposal.reasoning,
        JSON.stringify(proposal.evidence_refs),
        source,
        source === "MODEL" ? ctx.model!.name : null,
        JSON.stringify(policyResult),
        finalStatus,
      ],
    );
    if (!rows[0]) return null; // lost a race on trigger_key
    await appendLog(ctx, q, {
      kind: "DECISION_PROPOSED",
      decisionId: id,
      data: {
        decisionType: proposal.decision_type,
        subject: `${req.subjectType}:${req.subjectId}`,
        inputSnapshotHash: snapshotHash,
        proposal,
        policy: policyResult,
        source,
        model: source === "MODEL" ? ctx.model!.name : null,
        failedAttempts: attempts.filter((a) => !a.ok).map((a) => a.error),
      },
      at: ctx.now().toISOString(),
    });
    return rows[0];
  });

  if (!inserted) {
    return (await ctx.db.query<DecisionRow>("SELECT * FROM agent_decisions WHERE trigger_key = $1", [req.triggerKey]))[0]!;
  }
  if (finalStatus === "AUTO_APPLIED") return applyDecision(ctx, id);
  return inserted;
}

export async function approveDecision(ctx: Ctx, decisionId: string, freelancerId: string): Promise<DecisionRow> {
  const updated = await ctx.db.tx(async (q) => {
    const rows = await q.query<DecisionRow>(
      `UPDATE agent_decisions SET final_status = 'APPROVED', decided_by = $2, updated_at = now()
       WHERE id = $1 AND freelancer_id = $2 AND final_status = 'PENDING_APPROVAL' RETURNING *`,
      [decisionId, freelancerId],
    );
    if (!rows[0]) return null;
    await appendLog(ctx, q, { kind: "DECISION_APPROVED", decisionId, data: { by: freelancerId }, at: ctx.now().toISOString() });
    return rows[0];
  });
  if (!updated) throw new HttpError(409, "Decision is not pending approval");
  return applyDecision(ctx, decisionId);
}

export async function rejectDecision(ctx: Ctx, decisionId: string, freelancerId: string, reason: string): Promise<DecisionRow> {
  return ctx.db.tx(async (q) => {
    const rows = await q.query<DecisionRow>(
      `UPDATE agent_decisions SET final_status = 'REJECTED', decided_by = $2, updated_at = now()
       WHERE id = $1 AND freelancer_id = $2 AND final_status = 'PENDING_APPROVAL' RETURNING *`,
      [decisionId, freelancerId],
    );
    if (!rows[0]) throw new HttpError(409, "Decision is not pending approval");
    await appendLog(ctx, q, { kind: "DECISION_REJECTED", decisionId, data: { by: freelancerId, reason }, at: ctx.now().toISOString() });
    return rows[0];
  });
}
