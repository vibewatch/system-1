import type { DecisionQuestion, RuntimeScenario } from "./demo-data";
import type { DecisionRunResult, ExtractedSpan, NormalizedDecision } from "./foundry";

export function refundGate(answers: Record<string, NormalizedDecision>): "waiting" | "allow" | "review" | "block" {
  const action = answers.next_action?.key;
  if (!action) return "waiting";
  if (action === "block_redirect") return "block";
  if (action === "allow_original_refund" && (answers.approval_valid?.value ?? 0) >= 0.7 && (answers.recipient_changed?.value ?? 1) <= 0.3) return "allow";
  return "review";
}

export async function runDecisionStory({
  scenario, questions, signal, emit, decide, extract,
}: {
  scenario: RuntimeScenario;
  questions: DecisionQuestion[];
  signal: AbortSignal;
  emit: (event: string, data: Record<string, any>) => void;
  decide: (tier: 0 | 1, state: string, questions: DecisionQuestion[]) => Promise<DecisionRunResult>;
  extract: (state: string) => Promise<{ spans: ExtractedSpan[]; latency_ms: number }>;
}) {
  const started = performance.now();
  let transcript = "";
  let spans: ExtractedSpan[] = [];
  let failed = false;
  const elapsed = () => Math.round(performance.now() - started);
  const sleep = (ms: number) => new Promise<void>((done) => {
    if (signal.aborted) return done();
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); done(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
  emit("runtime_started", { scenarioId: scenario.id, pick: {}, ending: scenario.endings[0], questions, inputSource: "scripted", headerLen: scenario.header.length });
  try {
    for (const [index, stage] of (scenario.stages || []).entries()) {
      if (signal.aborted || failed) return;
      emit("runtime_story_stage", { index, title: stage.title, total: scenario.stages!.length });
      const words = `${index ? "\n\n" : ""}${stage.text}`.match(/\S+\s*|\s+/g) || [];
      for (let offset = 0; offset < words.length; offset += 3) {
        if (signal.aborted || failed) return;
        const delta = words.slice(offset, offset + 3).join("");
        transcript += delta;
        emit("runtime_token", { delta, transcript, words: (transcript.match(/\S+/g) || []).length, spans, elapsed_ms: elapsed() });
        await sleep(65);
      }
      const state = scenario.header + transcript;
      const pair = Promise.all(([0, 1] as const).map((tier) => decide(tier, state, questions).then((result) => {
          if (signal.aborted || failed) return;
          if (!result.ok) throw new Error(result.error || "A model failed to evaluate the story.");
          emit(tier === 0 ? "runtime_decision" : "runtime_terra_decision", {
            tier: tier === 0 ? "decision1" : "terra", model: result.model, latency_ms: result.latency_ms,
            textLen: transcript.length, chars: state.length, answers: result.answers, usage: result.usage,
          });
      })));
      const extraction = extract(transcript).then((result) => {
        if (signal.aborted || failed) return;
        spans = result.spans;
        emit("runtime_extract", { spans, latency_ms: result.latency_ms });
      });
      await Promise.all([pair, extraction]);
      await sleep(650);
    }
    if (!signal.aborted) emit("runtime_done", { ok: true, model: "scripted-input", elapsed_ms: elapsed(), inputSource: "scripted", usage: { input_tokens: 0, output_tokens: 0 } });
  } catch (error) {
    failed = true;
    if (!signal.aborted) {
      emit("error", { message: (error as Error).message });
      emit("runtime_done", { ok: false, error: (error as Error).message, elapsed_ms: elapsed() });
    }
  }
}
