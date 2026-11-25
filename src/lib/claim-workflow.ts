import { CLAIM_EXTRACTION_PROMPT, CLAIM_POLICY, CLAIM_QUESTIONS, claimOutcome, parseClaimFields, type ClaimField } from "./claims";
import type { DecisionRunResult } from "./foundry";

interface Dependencies {
  decisionName: string;
  baselineName: string;
  evaluateDecision: (content: string) => Promise<DecisionRunResult>;
  evaluateBaseline: (content: string) => Promise<DecisionRunResult>;
  extract: (system: string, content: string) => Promise<{ ok: boolean; text: string; latency_ms: number; error?: string }>;
  emit: (event: string, data: Record<string, unknown>) => void;
  isCurrent?: () => boolean;
}

export async function runClaimWorkflow(payload: Record<string, unknown>, deps: Dependencies) {
  const t0 = performance.now();
  const emit = (event: string, data: Record<string, unknown>) => {
    if (deps.isCurrent?.() !== false) deps.emit(event, { ...data, runId: payload.runId, elapsed_ms: Math.round(performance.now() - t0) });
  };
  if (typeof payload.content !== "string" || !payload.content.trim() || payload.schemaVersion !== 2
      || payload.policy !== CLAIM_POLICY || JSON.stringify(payload.questions) !== JSON.stringify(CLAIM_QUESTIONS)) {
    emit("agent_done", { outcome: claimOutcome(null, []), error: "Unsupported Claims request or policy schema." });
    return;
  }
  const content = payload.content;
  emit("claim_started", { decisionName: deps.decisionName, baselineName: deps.baselineName });
  const evaluate = async (tier: "decision1" | "terra", call: Dependencies["evaluateDecision"]) => {
    const started = performance.now();
    let result: DecisionRunResult;
    try { result = await call(content); }
    catch (error) {
      result = { ok: false, status: 0, model: tier === "decision1" ? deps.decisionName : deps.baselineName,
        endpointUsed: "", latency_ms: Math.round(performance.now() - started), answers: {},
        usage: { input_tokens: 0, output_tokens: 0 }, rawPayload: null, requestPayload: null, error: String(error) };
    }
    emit("claim_gate_result", { tier, result });
    return result;
  };
  const extract = async () => {
    let fields: ClaimField[] = [];
    let error: string | undefined;
    let latency_ms = 0;
    try {
      const result = await deps.extract(CLAIM_EXTRACTION_PROMPT, content);
      latency_ms = result.latency_ms;
      if (!result.ok) throw new Error(result.error || "Extraction request failed.");
      fields = parseClaimFields(result.text, content);
    } catch (failure) { error = String(failure); }
    emit("claim_extraction_result", { fields, error, latency_ms, model: deps.baselineName });
    return { fields, error };
  };
  const [decision, baseline, extraction] = await Promise.all([
    evaluate("decision1", deps.evaluateDecision), evaluate("terra", deps.evaluateBaseline), extract(),
  ]);
  emit("agent_done", {
    outcome: claimOutcome(decision, extraction.fields, extraction.error),
    comparisonFailed: !baseline.ok, extractionFailed: Boolean(extraction.error),
  });
}
