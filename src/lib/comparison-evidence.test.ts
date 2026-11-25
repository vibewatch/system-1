import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compareLatency, prioritizeQuestions, summarizeReplayEvidence } from "./comparison-evidence";
import { computeCorrectnessSummary, type DecisionQuestion, type StudioSample } from "./demo-data";
import { normalizeDecision1Answer, type DecisionRunResult } from "./foundry";
import { ComparisonProof } from "../components/ComparisonProof";
import { recordingMatches, type ReplayBundle } from "./replay";
import { getTriageWorkers } from "./triage-config";
import { BrowserFoundryDispatcher, DEFAULT_AZURE_CONFIG } from "./client-foundry";
import { evaluateCatalogSample, summarizeCatalogReports } from "./catalog-evidence";

const questions: DecisionQuestion[] = ["agreed", "baseline-error", "decision-error", "unlabeled"].map((id) => ({
  id, label: id, type: "noul", instructions: `Evaluate ${id}`,
}));
const expected = { agreed: "yes", "baseline-error": "yes", "decision-error": "yes" };
const result = (latency: number, wrong: string[] = []): DecisionRunResult => ({
  ok: true, status: 200, model: "test", endpointUsed: "https://example.invalid", latency_ms: latency,
  usage: { input_tokens: 100, output_tokens: 4 }, rawPayload: {}, requestPayload: {},
  answers: Object.fromEntries(questions.map((q) => [q.id, normalizeDecision1Answer(q, { noul: wrong.includes(q.id) ? 0.1 : 0.9 })])),
});
const sample: StudioSample = { id: "test", label: "Test", category: "Test", content: "Shared input", questions, expected };

test("latency conclusions support either winner, ties and failures", () => {
  assert.equal(compareLatency(result(100), result(400))?.winner, "decision1");
  assert.equal(compareLatency(result(400), result(100))?.winner, "baseline");
  assert.equal(compareLatency(result(100), result(100))?.winner, "tie");
  assert.equal(compareLatency({ ...result(100), ok: false }, result(400)), null);
  assert.equal(compareLatency(result(100), null), null);
});

test("errors from either model sort before agreements without mutating questions", () => {
  const ordered = prioritizeQuestions(questions, expected, result(100, ["decision-error"]), result(400, ["baseline-error"]));
  assert.deepEqual(ordered.map((q) => q.id), ["baseline-error", "decision-error", "agreed", "unlabeled"]);
  assert.equal(questions[0].id, "agreed");
  assert.equal(computeCorrectnessSummary(questions, undefined, result(100).answers, result(400).answers).totalQuestions, 0);
  assert.equal(computeCorrectnessSummary(questions, expected, result(100).answers, result(400).answers).totalQuestions, 3);
});

test("suite statistics exclude failed pairs and do not score changed question schemas", () => {
  const recording = (id: string, decision: DecisionRunResult, baseline: DecisionRunResult) => ({
    id, label: id, action: "run_compare" as const, durationMs: 1,
    payload: { state: sample.content, questions },
    events: [
      { event: "compare_model_done", data: { tier: "decision1", result: decision }, offsetMs: 0 },
      { event: "compare_model_done", data: { tier: "terra", result: baseline }, offsetMs: 0 },
      { event: "compare_finished", data: {}, offsetMs: 1 },
    ],
  });
  const bundle: ReplayBundle = {
    version: 1, recordedAt: "2026-11-25T00:00:00Z", endpoint: "", models: { decision1: "Decision-1.1", terra: "baseline" },
    scenarios: [sample], recordings: [
      recording("first", result(100, ["decision-error"]), result(400)),
      recording("second", result(300), result(200)),
      recording("failed", { ...result(1), ok: false }, result(5000)),
    ],
  };
  const summary = summarizeReplayEvidence(bundle);
  assert.equal(summary.pairs, 2);
  assert.equal(summary.failedPairs, 1);
  assert.equal(summary.decisionWins, 1);
  assert.equal(summary.baselineWins, 1);
  assert.equal(summary.decisionP50, 100);
  assert.equal(summary.decisionP95, 300);
  assert.equal(summary.labeledQuestions, 6);
  assert.equal(summary.decisionCorrect, 5);
  bundle.recordings[0].payload.questions = questions.map((q) => ({ ...q, instructions: "Changed" }));
  assert.equal(summarizeReplayEvidence(bundle).labeledQuestions, 3);
});

test("equal-worker live requests cannot replay unequal-worker recordings", () => {
  const recording = {
    id: "triage", label: "Triage", action: "start_triage" as const, durationMs: 1, events: [],
    payload: { rate: 10, raceTerra: true },
  };
  assert(recordingMatches(recording, "start_triage", { rate: 10, raceTerra: true, comparisonMode: "demo" }));
  assert(!recordingMatches(recording, "start_triage", { rate: 10, raceTerra: true, comparisonMode: "equal" }));
  assert.deepEqual(getTriageWorkers("equal"), { decision1: 4, terra: 4 });
  assert.deepEqual(getTriageWorkers(undefined), { decision1: 8, terra: 4 });
});

test("rendered proof announces a baseline win and labels unscored answers and assumed costs", () => {
  const props = {
    sample, state: sample.content, questions, decision: result(400), baseline: result(100),
    decisionName: "Decision-1.1", baselineName: "Baseline", running: false, replayMode: true,
  };
  const html = renderToStaticMarkup(React.createElement(ComparisonProof, props));
  assert.match(html, /Baseline returned 4.0× faster/);
  assert.match(html, /Not scored/);
  assert.match(html, /Method, confidence &amp; cost assumptions/);
  const failed = renderToStaticMarkup(React.createElement(ComparisonProof, {
    ...props, decision: null, decisionError: "Access denied",
  }));
  assert.match(failed, /Request failure/);
  assert.doesNotMatch(failed, /returned 4.0× faster/);
});

test("catalog excludes failed and incomplete pairs but retains genuine reference mismatches", async () => {
  const withCases: StudioSample = { ...sample, testCases: ["failed", "incomplete", "valid", "transport"].map((id) => ({
    id, title: id, scenarioType: "edge", content: id, expected,
  })) };
  const report = await evaluateCatalogSample(withCases, async (state) => {
    if (state === "transport") throw new Error("Offline");
    const decision1 = state === "failed" ? { ...result(0), ok: false, status: 503 }
      : state === "incomplete" ? { ...result(100), answers: {} } : result(100, ["decision-error"]);
    return { decision1, terra: result(400) };
  });
  const stats = summarizeCatalogReports([report]);
  assert.equal(stats.pairs, 1);
  assert.equal(stats.failed, 3);
  assert.equal(stats.totalQuestions, 3);
  assert.equal(stats.d1Correct, 2);
  assert.equal(stats.terraCorrect, 3);
  assert.equal(stats.d1AvgMs, 100);
  assert.equal(stats.terraAvgMs, 400);
  assert(report.cases[0].failures[0].includes("503"));
  assert.equal(report.cases[1].summary, null);
});

test("catalog aggregation weights individual cases and respects an empty filtered report set", async () => {
  const first = await evaluateCatalogSample({ ...sample, testCases: ["a", "b"].map((id) => ({
    id, title: id, scenarioType: "edge", content: id, expected,
  })) }, async () => ({ decision1: result(100), terra: result(400) }));
  const second = await evaluateCatalogSample({ ...sample, id: "second" },
    async () => ({ decision1: result(400), terra: result(100) }));
  const stats = summarizeCatalogReports([first, second]);
  assert.equal(stats.d1AvgMs, 200);
  assert.equal(stats.terraAvgMs, 300);
  assert.equal(summarizeCatalogReports([second]).d1AvgMs, 400);
  assert.equal(summarizeCatalogReports([]).pairs, 0);
  assert.equal(summarizeCatalogReports([]).d1AvgMs, null);
});

test("browser equal-worker triage reports every failed attempt instead of silently dropping it", async () => {
  const events: Array<{ event: string; data: any }> = [];
  const dispatcher = new BrowserFoundryDispatcher({ ...DEFAULT_AZURE_CONFIG, accessToken: "" }, (event) => events.push(event));
  await dispatcher.dispatch("start_triage", { rate: 30, raceTerra: true, comparisonMode: "equal" });
  const started = events.find((event) => event.event === "triage_started")!.data;
  assert.equal(started.decisionConcurrency, 4);
  assert.equal(started.terraConcurrency, 4);
  const completed = events.filter((event) => event.event === "triage_item_done");
  assert.equal(completed.length, 80);
  assert(completed.every((event) => event.data.ok === false && event.data.error));
  assert.equal(completed.filter((event) => event.data.lane === "decision1").length, 40);
  assert.equal(events.filter((event) => event.event === "triage_done").length, 1);
});
