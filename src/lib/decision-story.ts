import type { DecisionQuestion, RuntimeScenario } from "./demo-data";
import type { DecisionRunResult, ExtractedSpan, NormalizedDecision } from "./foundry";

export interface NavigationProgress {
  index: number;
  current: string;
  target: string;
  path: string[];
  lastEvaluated?: string;
  appliedChoice?: string;
  status: "evaluating" | "advanced" | "reached" | "review";
  reason?: string;
}

export function refundGate(answers: Record<string, NormalizedDecision>): "waiting" | "allow" | "review" | "block" {
  const action = answers.next_action?.key;
  if (!action) return "waiting";
  if (action === "block_redirect") return "block";
  if (action === "allow_original_refund" && (answers.approval_valid?.value ?? 0) >= 0.7 && (answers.recipient_changed?.value ?? 1) <= 0.3) return "allow";
  return "review";
}

export function storyAction(scenario: RuntimeScenario, answers: Record<string, NormalizedDecision>) {
  const choice = answers.next_action;
  if (!choice) return null;
  const action = scenario.story?.actions[String(choice.key)];
  if (scenario.id === "refund-guard" && refundGate(answers) === "review") {
    return scenario.story?.actions.pause_for_confirmation || null;
  }
  if (scenario.id === "brand-radar" && choice.key !== "no_match" && (answers.embedded_override?.value ?? 0) >= 0.7) {
    return { label: "Hold for editorial review", detail: "The model flags an embedded matching instruction. The application holds the brand recommendation for review, even when its choice is confident. Original scores and choices remain visible.", tone: "review" as const };
  }
  if (!action || choice.value < 0.65) {
    return { label: "Request a human review", detail: "No sufficiently confident supported action was returned. The 65% threshold is a demo policy, not a safety guarantee.", tone: "review" as const };
  }
  return action;
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
  emit("runtime_started", { scenarioId: scenario.id, pick: {}, ending: scenario.endings[0], questions, inputSource: scenario.navigation ? "graph-state" : "scripted", headerLen: scenario.inputScope === "checkpoint" ? 0 : scenario.header.length });
  try {
    if (scenario.navigation) {
      const graph = scenario.navigation;
      const path = [graph.start];
      let current = graph.start;
      let outcome: NavigationProgress["status"] = current === graph.target ? "reached" : "review";
      if (outcome === "reached") emit("runtime_navigation_state", { index: 0, current, target: graph.target, path: [...path], status: outcome });
      for (let index = 0; index < graph.maxSteps && current !== graph.target; index++) {
        if (signal.aborted) return;
        const node = graph.nodes.find((item) => item.id === current);
        if (!node) throw new Error("The current graph node does not exist.");
        const available = node.links.map((id) => graph.nodes.find((item) => item.id === id)).filter((item) => item !== undefined);
        const stepQuestions = questions.map((question) => question.id === "next_action" ? {
          ...question,
          criteria: {
            ...Object.fromEntries(available.map((item) => [item.id, item.summary])),
            human_review: "No supported confident onward link; stop for guidance.",
          },
        } : question);
        const state = scenario.header + "LAST SNAPSHOT / CURRENT STATE: " + JSON.stringify({
          current, target: graph.target, visited: path,
          availableLinks: available.map(({ id, label, summary }) => ({ id, label, summary })),
        });
        emit("runtime_story_stage", { index, title: node.label, total: graph.maxSteps });
        emit("runtime_navigation_state", { index, current, target: graph.target, path: [...path], lastEvaluated: current, status: "evaluating" });
        const delta = `${index ? "\n\n" : ""}${state}`;
        transcript += delta;
        emit("runtime_token", { delta, transcript, words: transcript.split(/\s+/).length, spans: [], elapsed_ms: elapsed() });
        emit("runtime_evaluation_started", { index, modelInput: state, chars: state.length, questions: stepQuestions, questionIds: stepQuestions.map((item) => item.id), elapsed_ms: elapsed() });
        const [primary] = await Promise.all(([0, 1] as const).map(async (tier) => {
          const result = await decide(tier, state, stepQuestions);
          if (signal.aborted || failed) return;
          if (!result.ok) throw new Error(result.error || "A model failed to select a graph link.");
          emit(tier === 0 ? "runtime_decision" : "runtime_terra_decision", {
            tier: tier === 0 ? "decision1" : "terra", model: result.model, index, currentNode: current,
            elapsed_ms: elapsed(), latency_ms: result.latency_ms, textLen: transcript.length, chars: state.length,
            answers: result.answers, usage: result.usage,
          });
          return result;
        }));
        if (signal.aborted || !primary) return;
        const choice = primary.answers.next_action;
        const next = typeof choice?.key === "string" ? choice.key : "";
        const legal = available.some((item) => item.id === next);
        if (!legal || choice.value < 0.65 || path.includes(next)) {
          outcome = "review";
          emit("runtime_navigation_state", {
            index, current, target: graph.target, path: [...path], lastEvaluated: current, status: "review",
            reason: !legal ? "No supported legal link was selected." : choice.value < 0.65 ? "Choice probability is below the 65% demo threshold." : "The selected link revisits a node; stop instead of looping.",
          });
          break;
        }
        const previous = current;
        current = next;
        path.push(next);
        outcome = current === graph.target ? "reached" : "advanced";
        emit("runtime_navigation_state", { index, current, target: graph.target, path: [...path], lastEvaluated: previous, appliedChoice: next, status: outcome });
        if (index === graph.maxSteps - 1 && outcome !== "reached") {
          outcome = "review";
          emit("runtime_navigation_state", { index, current, target: graph.target, path: [...path], lastEvaluated: previous, status: outcome, reason: "The bounded step budget is exhausted." });
        }
        await sleep(650);
      }
      if (!signal.aborted) emit("runtime_done", { ok: true, outcome, model: "graph-state", inputSource: "graph-state", elapsed_ms: elapsed(), usage: { input_tokens: 0, output_tokens: 0 } });
      return;
    }
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
      const state = scenario.inputScope === "checkpoint" ? stage.text : scenario.header + transcript;
      emit("runtime_evaluation_started", { index, modelInput: state, chars: state.length, inputScope: scenario.inputScope || "history", questions, questionIds: questions.map((question) => question.id), elapsed_ms: elapsed() });
      const pair = Promise.all(([0, 1] as const).map((tier) => decide(tier, state, questions).then((result) => {
          if (signal.aborted || failed) return;
          if (!result.ok) throw new Error(result.error || "A model failed to evaluate the story.");
          emit(tier === 0 ? "runtime_decision" : "runtime_terra_decision", {
            tier: tier === 0 ? "decision1" : "terra", model: result.model, latency_ms: result.latency_ms,
            index, elapsed_ms: elapsed(), textLen: transcript.length, chars: state.length, answers: result.answers, usage: result.usage,
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
