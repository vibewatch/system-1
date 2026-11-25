import { computeCorrectnessSummary, type DecisionQuestion } from "./demo-data";
import type { DecisionRunResult } from "./foundry";
import { recordingMatches, type ReplayBundle } from "./replay";

export function compareLatency(decision?: DecisionRunResult | null, baseline?: DecisionRunResult | null) {
  if (!decision?.ok || !baseline?.ok || decision.latency_ms <= 0 || baseline.latency_ms <= 0) return null;
  const difference = baseline.latency_ms - decision.latency_ms;
  return {
    winner: difference === 0 ? "tie" : difference > 0 ? "decision1" : "baseline",
    multiplier: Math.max(decision.latency_ms, baseline.latency_ms) / Math.min(decision.latency_ms, baseline.latency_ms),
    savedMs: Math.abs(difference),
  };
}

export function prioritizeQuestions(
  questions: DecisionQuestion[],
  expected: Record<string, string> | undefined,
  decision?: DecisionRunResult | null,
  baseline?: DecisionRunResult | null,
) {
  const summary = computeCorrectnessSummary(questions, expected, decision?.ok ? decision.answers : undefined, baseline?.ok ? baseline.answers : undefined);
  const priorities = new Map(summary.rows.map((row) => [row.questionId,
    expected?.[row.questionId] && ((decision?.ok && !row.d1Match) || (baseline?.ok && !row.terraMatch))
      ? 0 : decision?.ok && baseline?.ok && !row.modelsAgree ? 1 : 2,
  ]));
  return [...questions].sort((a, b) => priorities.get(a.id)! - priorities.get(b.id)!);
}

export function summarizeReplayEvidence(bundle: ReplayBundle) {
  const decisionLatencies: number[] = [];
  const baselineLatencies: number[] = [];
  let decisionWins = 0;
  let baselineWins = 0;
  let ties = 0;
  let failedPairs = 0;
  let labeledQuestions = 0;
  let decisionCorrect = 0;
  let baselineCorrect = 0;
  for (const recording of bundle.recordings) {
    if (recording.action !== "run_compare") continue;
    const result = (tier: string): DecisionRunResult | undefined => recording.events.find(
      (event) => event.event === "compare_model_done" && event.data.tier === tier,
    )?.data.result;
    const decision = result("decision1");
    const baseline = result("terra");
    const latency = compareLatency(decision, baseline);
    if (!latency) { failedPairs++; continue; }
    decisionLatencies.push(decision!.latency_ms);
    baselineLatencies.push(baseline!.latency_ms);
    if (latency.winner === "decision1") decisionWins++;
    else if (latency.winner === "baseline") baselineWins++;
    else ties++;
    const sample = bundle.scenarios.find((sample) => (sample.testCases?.length
      ? sample.testCases : [{ content: sample.content }]).some((testCase) =>
      recordingMatches(recording, "run_compare", { state: testCase.content, questions: sample.questions })));
    const testCase = sample?.testCases?.find((testCase) => testCase.content === recording.payload.state);
    const expected = testCase?.expected || sample?.expected;
    if (!expected) continue;
    const score = computeCorrectnessSummary(recording.payload.questions, expected, decision!.answers, baseline!.answers);
    labeledQuestions += score.totalQuestions;
    decisionCorrect += score.d1Correct;
    baselineCorrect += score.terraCorrect;
  }
  const percentile = (values: number[], fraction: number) => values.length
    ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)]
    : null;
  return {
    pairs: decisionLatencies.length, failedPairs, decisionWins, baselineWins, ties,
    decisionP50: percentile(decisionLatencies, 0.5), baselineP50: percentile(baselineLatencies, 0.5),
    decisionP95: percentile(decisionLatencies, 0.95), baselineP95: percentile(baselineLatencies, 0.95),
    labeledQuestions, decisionCorrect, baselineCorrect,
  };
}
