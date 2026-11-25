"use client";

import React, { useMemo, useState } from "react";
import {
  computeCorrectnessSummary, computeUseCaseEconomics,
  DECISION1_INPUT_PRICE_PER_1M_USD, DECISION1_OUTPUT_PRICE_PER_1M_USD,
  TERRA_INPUT_PRICE_PER_1M_USD, TERRA_OUTPUT_PRICE_PER_1M_USD,
  type DecisionQuestion, type StudioSample,
} from "@/lib/demo-data";
import { compareLatency, summarizeReplayEvidence } from "@/lib/comparison-evidence";
import type { DecisionRunResult } from "@/lib/foundry";
import type { ReplayBundle } from "@/lib/replay";

interface Props {
  sample: StudioSample;
  questions: DecisionQuestion[];
  state: string;
  expected?: Record<string, string>;
  decision: DecisionRunResult | null;
  baseline: DecisionRunResult | null;
  decisionName: string;
  baselineName: string;
  decisionError?: string;
  baselineError?: string;
  running: boolean;
  replayMode: boolean;
  replayBundle?: ReplayBundle | null;
}

export function ComparisonProof(props: Props) {
  const { decision, baseline, decisionName, baselineName, expected, questions, running } = props;
  const [dailyVolume, setDailyVolume] = useState<number | undefined>();
  const paired = Boolean(decision?.ok && baseline?.ok);
  const latency = compareLatency(decision, baseline);
  const correctness = computeCorrectnessSummary(questions, expected, decision?.ok ? decision.answers : undefined, baseline?.ok ? baseline.answers : undefined);
  const economics = computeUseCaseEconomics({ ...props.sample, content: props.state, questions },
    decision?.ok ? decision.usage : undefined, baseline?.ok ? baseline.usage : undefined, dailyVolume);
  const measuredUsage = paired && (decision?.usage.input_tokens || 0) > 0 && (baseline?.usage.input_tokens || 0) > 0;
  const suite = useMemo(() => props.replayBundle ? summarizeReplayEvidence(props.replayBundle) : null, [props.replayBundle]);
  const winnerName = latency?.winner === "baseline" ? baselineName : decisionName;
  const headline = latency
    ? latency.winner === "tie" ? "Same request latency in this case"
      : `${winnerName} returned ${latency.multiplier.toFixed(1)}× faster`
    : props.decisionError || props.baselineError ? "Request failure — no paired winner"
      : running ? "Same input. Two models. Waiting for both results."
        : "Compare speed, correctness and estimated cost";
  const correctnessNote = paired && correctness.totalQuestions > 0
    ? `${decisionName}: ${correctness.d1Correct}/${correctness.totalQuestions} correct. ${baselineName}: ${correctness.terraCorrect}/${correctness.totalQuestions} correct. ${
      correctness.d1Correct === correctness.terraCorrect ? "Correctness is tied in this case."
        : `${correctness.d1Correct > correctness.terraCorrect ? decisionName : baselineName} matches more reference answers in this case.`
    }`
    : "Correctness is scored only when reference answers exist and both requests succeed.";
  const latencyMax = Math.max(decision?.ok ? decision.latency_ms : 0, baseline?.ok ? baseline.latency_ms : 0, 1);
  const modelRows = [
    { name: decisionName, result: decision, error: props.decisionError, tone: "d1", correct: correctness.d1Correct, cost: economics.d1CostPer1kUsd },
    { name: baselineName, result: baseline, error: props.baselineError, tone: "terra", correct: correctness.terraCorrect, cost: economics.terraCostPer1kUsd },
  ];
  return (
    <section className="comparison-proof" aria-label="Paired model evidence">
      <div className="comparison-outcome" aria-live="polite">
        <span className="eyebrow">{props.replayMode ? "Recorded" : "Live"} single-case evidence</span>
        <h2>{headline}</h2>
        <p>{correctnessNote}</p>
      </div>
      <div className="comparison-scorecards">
        <div className="comparison-metric">
          <h3>Request latency <small>lower is better</small></h3>
          {modelRows.map((row) => <div className={`comparison-row ${row.tone}`} key={row.tone}>
            <div><span>{row.name}</span><b>{row.error ? "Failed" : row.result?.ok ? `${row.result.latency_ms} ms` : running ? "Running…" : "—"}</b></div>
            <div className="comparison-track"><i style={{ width: `${row.result?.ok ? row.result.latency_ms / latencyMax * 100 : 0}%` }} /></div>
          </div>)}
          <p>{latency ? `${latency.savedMs.toLocaleString()} ms difference. Same-scale bars.` : "No speed ratio until both requests succeed."}</p>
        </div>
        <div className="comparison-metric">
          <h3>Reference correctness <small>higher is better</small></h3>
          {modelRows.map((row) => <div className={`comparison-row ${row.tone}`} key={row.tone}>
            <div><span>{row.name}</span><b>{row.error ? "Failed" : row.result?.ok && correctness.totalQuestions > 0 ? `${row.correct}/${correctness.totalQuestions}` : "Not scored"}</b></div>
            <div className="comparison-track"><i style={{ width: `${row.result?.ok && correctness.totalQuestions ? row.correct / correctness.totalQuestions * 100 : 0}%` }} /></div>
          </div>)}
          <p>Manually supplied reference answers. Confidence is not accuracy; calibration has not been evaluated.</p>
        </div>
        <div className="comparison-metric">
          <h3>Estimated cost / 1,000 calls <small>lower is better</small></h3>
          {modelRows.map((row) => <div className={`comparison-row ${row.tone}`} key={row.tone}>
            <div><span>{row.name}</span><b>${row.cost.toFixed(4)}</b></div>
            <div className="comparison-track"><i style={{ width: `${row.cost / Math.max(economics.d1CostPer1kUsd, economics.terraCostPer1kUsd, 0.000001) * 100}%` }} /></div>
          </div>)}
          <p>{measuredUsage ? `${props.replayMode ? "Recorded" : "Measured"} token usage` : "Estimated token usage"} × assumed rates. Not an Azure bill.</p>
        </div>
      </div>
      {(props.decisionError || props.baselineError) && <div className="comparison-error" role="alert">
        {modelRows.filter((row) => row.error).map((row) => <p key={row.tone}>{row.name}: {row.error}</p>)}
      </div>}
      <p className="comparison-method">Same input and question schema; different API formats and potentially different resources, regions and network conditions. These are observed request timings, not isolated model-compute benchmarks.</p>
      {suite && <details className="comparison-details">
        <summary>Recorded suite: {suite.pairs} successful pairs · {props.replayBundle!.models.decision1} faster in {suite.decisionWins} · view P50, P95 and correctness</summary>
        <div className="wb-table-wrap"><table className="wb-table">
          <thead><tr><th>Recorded suite metric</th><th>{props.replayBundle!.models.decision1}</th><th>{props.replayBundle!.models.terra}</th></tr></thead>
          <tbody>
            <tr><td>Latency P50</td><td>{suite.decisionP50 ?? "—"} ms</td><td>{suite.baselineP50 ?? "—"} ms</td></tr>
            <tr><td>Latency P95</td><td>{suite.decisionP95 ?? "—"} ms</td><td>{suite.baselineP95 ?? "—"} ms</td></tr>
            <tr><td>Faster paired cases</td><td>{suite.decisionWins}/{suite.pairs}</td><td>{suite.baselineWins}/{suite.pairs}</td></tr>
            <tr><td>Reference answers matched</td><td>{suite.labeledQuestions ? `${suite.decisionCorrect}/${suite.labeledQuestions}` : "Not scored"}</td><td>{suite.labeledQuestions ? `${suite.baselineCorrect}/${suite.labeledQuestions}` : "Not scored"}</td></tr>
          </tbody>
        </table></div>
        <p>{suite.ties} latency ties; {suite.failedPairs} failed/incomplete pairs excluded from timing and correctness. Recorded {props.replayBundle!.recordedAt.slice(0, 10)}. Finite examples, not a general accuracy or calibration benchmark.</p>
      </details>}
      <details className="comparison-details">
        <summary>Business impact and pricing assumptions</summary>
        <div className="comparison-impact">
          <label>Calls per day <input type="number" min={1} max={1000000000} value={economics.dailyVolume}
            onChange={(event) => setDailyVolume(Math.max(1, Math.min(1000000000, Number(event.target.value) || 1)))} /></label>
          <p>At {economics.dailyVolume.toLocaleString()} calls/day over 30 days: {decisionName} ≈ ${economics.d1MonthlyUsd.toFixed(2)}; {baselineName} ≈ ${economics.terraMonthlyUsd.toFixed(2)}.
            {" "}{economics.monthlySavingsUsd >= 0 ? `${decisionName} saves` : `${baselineName} saves`} an estimated ${Math.abs(economics.monthlySavingsUsd).toFixed(2)}/month.</p>
          <p>Repository default rates per 1M tokens: {decisionName} ${DECISION1_INPUT_PRICE_PER_1M_USD} input / ${DECISION1_OUTPUT_PRICE_PER_1M_USD} output;
            {" "}{baselineName} ${TERRA_INPUT_PRICE_PER_1M_USD} input / ${TERRA_OUTPUT_PRICE_PER_1M_USD} output.
            Price source: repository assumptions. Current deployment rates and verification date are not supplied. Verify your Azure pricing before budgeting.</p>
        </div>
      </details>
    </section>
  );
}
