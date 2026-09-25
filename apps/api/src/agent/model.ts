import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  CollectionStepProposal,
  EarlyPayOfferProposal,
  ReconcileProposal,
  SetTermsProposal,
  type DecisionType,
} from "@horos/core";
import { SYSTEM_PROMPT, renderUserMessage } from "./prompt.js";
import type { Snapshot } from "./snapshot.js";

/** Returns the model's raw (unvalidated) output. Validation happens in the runner. */
export interface AgentModel {
  readonly name: string;
  propose(snapshot: Snapshot): Promise<unknown>;
}

const SCHEMAS = {
  SET_TERMS: SetTermsProposal,
  EARLY_PAY_OFFER: EarlyPayOfferProposal,
  COLLECTION_STEP: CollectionStepProposal,
  RECONCILE: ReconcileProposal,
} as const satisfies Record<DecisionType, unknown>;

export class AnthropicAgentModel implements AgentModel {
  private readonly client: Anthropic;

  constructor(apiKey: string, readonly name: string) {
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  }

  async propose(snapshot: Snapshot): Promise<unknown> {
    const response = await this.client.messages.parse({
      model: this.name,
      max_tokens: 16_000,
      output_config: {
        effort: "medium",
        format: zodOutputFormat(SCHEMAS[snapshot.decisionType]),
      },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: renderUserMessage(snapshot) }],
    });
    if (response.stop_reason === "refusal") throw new Error("model refused");
    if (response.stop_reason === "max_tokens") throw new Error("model output truncated");
    if (response.parsed_output) return response.parsed_output;
    // Fall back to the raw text so the runner can report exactly why it didn't validate.
    const text = response.content.find((b) => b.type === "text");
    return text && "text" in text ? safeJson(text.text) : null;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
