import { computeCorrectnessSummary, type CorrectnessSummary, type DecisionQuestion, type StudioSample } from "./demo-data";
import type { DecisionRunResult } from "./foundry";

type Usage = { input_tokens: number; output_tokens: number };
export interface CatalogCaseResult {
  caseId: string;
  caseTitle: string;
  d1LatencyMs: number | null;
  terraLatencyMs: number | null;
  summary: CorrectnessSummary | null;
  failures: string[];
  d1Usage?: Usage;
  terraUsage?: Usage;
}
export interface CatalogReport {
  solutionId: string;
  running: boolean;
  cases: CatalogCaseResult[];
}
export type RunComparePair = (state: unknown, questions: DecisionQuestion[]) => Promise<{
  decision1?: DecisionRunResult; terra?: DecisionRunResult;
}>;

export async function evaluateCatalogSample(sample: StudioSample, run: RunComparePair): Promise<CatalogReport> {
  const cases: CatalogCaseResult[] = [];
  for (const testCase of sample.testCases?.length ? sample.testCases
    : [{ id: `${sample.id}-default`, title: "Primary case", content: sample.content, expected: sample.expected }]) {
    try {
      const { decision1, terra } = await run(testCase.content, sample.questions);
      const failure = (result: DecisionRunResult | undefined, name: string) => {
        if (!result?.ok) return `${name}: request failed${result?.status ? ` (HTTP ${result.status})` : ""}`;
        if (!Number.isFinite(result.latency_ms) || result.latency_ms <= 0 ||
          sample.questions.some((question) => !result.answers?.[question.id])) return `${name}: incomplete result`;
        return null;
      };
      const failures = [failure(decision1, "Decision-1.1"), failure(terra, "Baseline")].filter((value): value is string => Boolean(value));
      cases.push({
        caseId: testCase.id, caseTitle: testCase.title, failures,
        d1LatencyMs: failures.length ? null : decision1!.latency_ms,
        terraLatencyMs: failures.length ? null : terra!.latency_ms,
        summary: failures.length ? null : computeCorrectnessSummary(sample.questions, testCase.expected || sample.expected, decision1!.answers, terra!.answers),
        d1Usage: failures.length ? undefined : decision1!.usage,
        terraUsage: failures.length ? undefined : terra!.usage,
      });
    } catch {
      cases.push({ caseId: testCase.id, caseTitle: testCase.title, failures: ["Comparison request failed"], d1LatencyMs: null, terraLatencyMs: null, summary: null });
    }
  }
  return { solutionId: sample.id, running: false, cases };
}

export function summarizeCatalogReports(reports: CatalogReport[]) {
  const cases = reports.filter((report) => !report.running).flatMap((report) => report.cases);
  const paired = cases.filter((item) => item.summary !== null);
  const averageUsage = (key: "d1Usage" | "terraUsage") => {
    const usages = paired.flatMap((item) => item[key] ? [item[key]!] : []);
    return usages.length === paired.length && usages.length ? {
      input_tokens: usages.reduce((sum, item) => sum + item.input_tokens, 0) / usages.length,
      output_tokens: usages.reduce((sum, item) => sum + item.output_tokens, 0) / usages.length,
    } : undefined;
  };
  return {
    attempted: cases.length, pairs: paired.length, failed: cases.length - paired.length,
    totalQuestions: paired.reduce((sum, item) => sum + item.summary!.totalQuestions, 0),
    d1Correct: paired.reduce((sum, item) => sum + item.summary!.d1Correct, 0),
    terraCorrect: paired.reduce((sum, item) => sum + item.summary!.terraCorrect, 0),
    d1AvgMs: paired.length ? Math.round(paired.reduce((sum, item) => sum + item.d1LatencyMs!, 0) / paired.length) : null,
    terraAvgMs: paired.length ? Math.round(paired.reduce((sum, item) => sum + item.terraLatencyMs!, 0) / paired.length) : null,
    d1Usage: averageUsage("d1Usage"), terraUsage: averageUsage("terraUsage"),
  };
}
