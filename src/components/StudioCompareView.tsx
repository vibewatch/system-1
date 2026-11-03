"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  STUDIO_SAMPLES,
  StudioSample,
  DecisionQuestion,
  QuestionType,
  computeCorrectnessSummary,
  computeUseCaseEconomics,
  getScenarioNarrative,
} from "@/lib/demo-data";
import type { DecisionRunResult } from "@/lib/foundry";
import { CustomSelect } from "./CustomSelect";

function buildClientSystemOnePayload(
  state: unknown,
  questions: DecisionQuestion[],
  deploymentName = "Decision-1"
) {
  const qMap: Record<string, Record<string, unknown>> = {};
  for (const q of questions) {
    const entry: Record<string, unknown> = {
      type: q.type,
      instructions: q.instructions,
    };
    if (q.criteria) {
      entry.criteria = q.criteria;
    }
    qMap[q.id] = entry;
  }
  return {
    model: deploymentName,
    state,
    questions: qMap,
  };
}

interface StudioCompareViewProps {
  sendWs: (action: string, payload?: Record<string, any>) => boolean;
  subscribeWs: (
    handler: (msg: { event: string; data: any; ts: number }) => void
  ) => () => void;
  wsConnected: boolean;
  comparisonModelName?: string;
  endpointUrl?: string;
  allUseCases?: StudioSample[];
  externalSample?: StudioSample | null;
  externalTrigger?: number;
  onOpenFramework?: () => void;
}

export default function StudioCompareView({
  sendWs,
  subscribeWs,
  wsConnected,
  comparisonModelName = "gpt-6.1-terra",
  endpointUrl = "https://icsuaaisea.cognitiveservices.azure.com",
  allUseCases,
  externalSample,
  externalTrigger,
  onOpenFramework,
}: StudioCompareViewProps) {
  const samples =
    allUseCases && allUseCases.length > 0 ? allUseCases : STUDIO_SAMPLES;
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [stateText, setStateText] = useState(
    samples[0].testCases?.[0]?.content || samples[0].content
  );
  const [questions, setQuestions] = useState<DecisionQuestion[]>(() => [
    ...samples[0].questions,
  ]);
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);

  const activeSample = samples.find((s) => s.id === sampleId) || samples[0];
  const activeTestCase =
    activeSample.testCases && activeSample.testCases[activeCaseIndex]
      ? activeSample.testCases[activeCaseIndex]
      : undefined;
  const activeExpected = activeTestCase?.expected || activeSample.expected;
  const activeVerdict =
    activeTestCase?.expectedGateVerdict || activeSample.expectedGateVerdict;
  const narrative = useMemo(
    () => getScenarioNarrative(activeSample),
    [activeSample]
  );

  const [outTab, setOutTab] = useState<
    "table" | "visual" | "probs" | "api"
  >("table");
  const [racing, setRacing] = useState(false);
  const [d1Result, setD1Result] = useState<DecisionRunResult | null>(null);
  const [terraResult, setTerraResult] = useState<DecisionRunResult | null>(
    null
  );

  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<QuestionType>("noul");
  const [newInst, setNewInst] = useState("");
  const [newCriteriaText, setNewCriteriaText] = useState("");

  useEffect(() => {
    return subscribeWs(({ event, data }) => {
      if (event === "compare_started") {
        setRacing(true);
        setD1Result(null);
        setTerraResult(null);
      } else if (event === "compare_model_done") {
        if (data.tier === "decision1") {
          setD1Result(data.result);
        } else if (data.tier === "terra") {
          setTerraResult(data.result);
        }
      } else if (event === "compare_finished") {
        setRacing(false);
      }
    });
  }, [subscribeWs]);

  const [didInitialRun, setDidInitialRun] = useState(false);
  useEffect(() => {
    if (wsConnected && !didInitialRun) {
      setDidInitialRun(true);
      const firstContent =
        STUDIO_SAMPLES[0].testCases?.[0]?.content || STUDIO_SAMPLES[0].content;
      sendWs("run_compare", {
        state: firstContent,
        questions: STUDIO_SAMPLES[0].questions,
        mode: "compare",
      });
    }
  }, [wsConnected, didInitialRun, sendWs]);

  const selectSample = (id: string) => {
    setSampleId(id);
    setActiveCaseIndex(0);
    const s = samples.find((x) => x.id === id);
    if (s) {
      const initialContent = s.testCases?.[0]?.content || s.content;
      setStateText(initialContent);
      setQuestions([...s.questions]);
      if (wsConnected) {
        sendWs("run_compare", {
          state: initialContent,
          questions: s.questions,
          mode: "compare",
        });
      }
    }
  };

  const selectTestCase = (idx: number) => {
    setActiveCaseIndex(idx);
    const tc = activeSample.testCases?.[idx];
    if (tc) {
      setStateText(tc.content);
      if (wsConnected) {
        sendWs("run_compare", {
          state: tc.content,
          questions,
          mode: "compare",
        });
      }
    }
  };

  useEffect(() => {
    if (externalSample && externalTrigger) {
      setSampleId(externalSample.id);
      setActiveCaseIndex(0);
      const initialContent =
        externalSample.testCases?.[0]?.content || externalSample.content;
      setStateText(initialContent);
      setQuestions([...externalSample.questions]);
      if (wsConnected) {
        sendWs("run_compare", {
          state: initialContent,
          questions: externalSample.questions,
          mode: "compare",
        });
      }
    }
  }, [externalSample, externalTrigger, wsConnected, sendWs]);

  const runComparison = () => {
    if (!wsConnected) return;
    sendWs("run_compare", {
      state: stateText,
      questions,
      mode: "compare",
    });
  };

  const removeQuestion = (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  const addQuestion = () => {
    const cleanId = (newKey || newInst)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 28);
    if (!cleanId || !newInst.trim()) return;

    const q: DecisionQuestion = {
      id: cleanId,
      label: newKey.trim() || newInst.trim().slice(0, 32),
      type: newType,
      instructions: newInst.trim(),
    };

    if (newType === "choice") {
      const parts = newCriteriaText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const crit: Record<string, string> = {};
      (parts.length ? parts : ["option_a", "option_b"]).forEach((p) => {
        const [k, desc] = p.split(":").map((x) => x.trim());
        crit[k] = desc || `Select when ${k} applies.`;
      });
      q.criteria = crit;
    } else if (newType === "score") {
      const parts = newCriteriaText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      q.criteria = parts.length ? parts : ["Low", "Medium", "High", "Critical"];
    }

    setQuestions((prev) => [...prev, q]);
    setNewKey("");
    setNewInst("");
    setNewCriteriaText("");
  };

  // Group scenarios by industry for the left sidebar
  const groupedScenarios = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    const filtered = samples.filter(
      (s) =>
        !q ||
        s.label.toLowerCase().includes(q) ||
        (s.industry || "").toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    );
    const groups = new Map<string, StudioSample[]>();
    for (const s of filtered) {
      const ind = s.industry || "Enterprise Core";
      if (!groups.has(ind)) groups.set(ind, []);
      groups.get(ind)!.push(s);
    }
    return Array.from(groups.entries());
  }, [samples, sidebarSearch]);

  const d1Ms = d1Result?.latency_ms || 0;
  const terraMs = terraResult?.latency_ms || 0;
  const maxMs = Math.max(d1Ms, terraMs, 1);
  const speedup =
    d1Ms > 0 && terraMs > 0 ? (terraMs / d1Ms).toFixed(1) : null;

  let agreedCount = 0;
  let comparedCount = 0;
  if (d1Result?.answers && terraResult?.answers) {
    for (const q of questions) {
      const a = d1Result.answers[q.id];
      const b = terraResult.answers[q.id];
      if (a && b) {
        comparedCount++;
        if (a.label.toLowerCase() === b.label.toLowerCase()) {
          agreedCount++;
        }
      }
    }
  }

  const correctnessSummary = useMemo(
    () =>
      computeCorrectnessSummary(
        questions,
        activeExpected,
        d1Result?.answers,
        terraResult?.answers
      ),
    [questions, activeExpected, d1Result?.answers, terraResult?.answers]
  );

  const economicsSummary = useMemo(
    () =>
      computeUseCaseEconomics(
        {
          id: activeSample.id,
          content: stateText,
          questions,
          estimatedDailyVolume: activeSample.estimatedDailyVolume,
        },
        d1Result?.usage,
        terraResult?.usage
      ),
    [
      activeSample.id,
      activeSample.estimatedDailyVolume,
      stateText,
      questions,
      d1Result?.usage,
      terraResult?.usage,
    ]
  );

  const systemOnePayload = buildClientSystemOnePayload(stateText, questions);

  const curlSnippet = `curl --request POST \\
  --url "${endpointUrl}/providers/microsoft/v1/systemone" \\
  --header "Authorization: Bearer $(az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv)" \\
  --header "Content-Type: application/json" \\
  --data '${JSON.stringify(systemOnePayload, null, 2).replace(/'/g, "'\\''")}'`;

  return (
    <main className="layout single">
      <div className="wb-shell">
        {/* LEFT SIDEBAR: Scenario Navigator */}
        <aside className="wb-sidebar" aria-label="Scenario Navigator">
          <div className="wb-sidebar-head">
            <div>
              <div
                style={{
                  font: "700 11px var(--mono)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Scenarios ({samples.length})
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                Select an enterprise use case
              </div>
            </div>
            {onOpenFramework && (
              <button
                type="button"
                className="ghost"
                style={{ padding: "4px 8px", fontSize: 11 }}
                onClick={onOpenFramework}
                title="Open Industry Catalog & Custom Scenario Builder"
              >
                Catalog / +New
              </button>
            )}
          </div>

          <div
            style={{
              padding: "8px 10px",
              borderBottom: "1px solid var(--border-soft)",
            }}
          >
            <input
              type="text"
              placeholder="Filter scenarios or industry…"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 9px",
                fontSize: 12,
              }}
            />
          </div>

          <div className="wb-sidebar-list">
            {groupedScenarios.map(([industry, list]) => (
              <div key={industry}>
                <div className="wb-industry-group-label">{industry}</div>
                {list.map((s) => {
                  const isActive = s.id === activeSample.id;
                  const shortTitle = s.label.includes("·")
                    ? s.label.split("·").slice(1).join("·").trim()
                    : s.label;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`wb-nav-item ${isActive ? "active" : ""}`}
                      onClick={() => selectSample(s.id)}
                    >
                      <span className="wb-nav-item-title">{shortTitle}</span>
                      <span className="wb-nav-item-meta">
                        <span>{s.category}</span>
                        <span>{s.questions.length}Q</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        {/* RIGHT MAIN STAGE: Clear 3-Tier Visual Hierarchy */}
        <div className="wb-main">
          {/* TIER 1: Scenario Brief (What Problem It Solves & What It Proves) + Test Case Input */}
          <section className="wb-brief-card">
            <div className="wb-brief-top">
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      font: "600 10.5px var(--mono)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--primary)",
                    }}
                  >
                    {activeSample.industry || "Enterprise"} ·{" "}
                    {activeSample.category}
                  </span>
                  {activeVerdict && (
                    <span
                      style={{
                        font: "600 10px var(--mono)",
                        padding: "2px 8px",
                        borderRadius: 4,
                        background:
                          activeTestCase?.scenarioType === "violation"
                            ? "var(--danger-soft)"
                            : "var(--primary-soft)",
                        color:
                          activeTestCase?.scenarioType === "violation"
                            ? "var(--danger)"
                            : "var(--primary)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Expected Verdict: {activeVerdict}
                    </span>
                  )}
                </div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: "clamp(18px, 1.8vw, 23px)",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {activeSample.label}
                </h1>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSchemaModalOpen(true)}
                >
                  Customize Input &amp; Questions ({questions.length})
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={runComparison}
                  disabled={racing || !wsConnected}
                >
                  {racing
                    ? "Evaluating Live…"
                    : `Run Live Evaluation`}
                </button>
              </div>
            </div>

            {/* 2-Column Editorial Explanation: Problem Solved vs What It Proves */}
            <div className="wb-purpose-grid">
              <div className="wb-purpose-cell">
                <div
                  className="wb-purpose-kicker"
                  style={{ color: "var(--terra)" }}
                >
                  <span>01 · Business Problem Solved (解决什么业务问题)</span>
                </div>
                <p className="wb-purpose-body">{narrative.problemSolved}</p>
              </div>
              <div className="wb-purpose-cell">
                <div
                  className="wb-purpose-kicker"
                  style={{ color: "var(--primary)" }}
                >
                  <span>
                    02 · What This Proves About Microsoft-Decision-1 (证明什么能力)
                  </span>
                </div>
                <p className="wb-purpose-body">{narrative.whatItProves}</p>
              </div>
            </div>

            {/* Test Case Selector + Clean Read-First Document View */}
            <div className="wb-input-section">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <div className="wb-case-tabs">
                  <span
                    style={{
                      font: "600 10.5px var(--mono)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--text-muted)",
                      marginRight: 4,
                    }}
                  >
                    Benchmark Test Case:
                  </span>
                  {activeSample.testCases &&
                  activeSample.testCases.length > 0 ? (
                    activeSample.testCases.map((tc, idx) => {
                      const active = activeCaseIndex === idx;
                      const isViolation = tc.scenarioType === "violation";
                      return (
                        <button
                          key={tc.id}
                          type="button"
                          className={`wb-case-tab ${active ? "active" : ""}`}
                          onClick={() => selectTestCase(idx)}
                        >
                          <span
                            className="dot"
                            style={{
                              background: isViolation
                                ? "var(--danger)"
                                : "var(--primary)",
                            }}
                          />
                          <span>{tc.title}</span>
                        </button>
                      );
                    })
                  ) : (
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      Default Input Document
                    </span>
                  )}
                </div>

                <span
                  style={{
                    font: "500 11px var(--mono)",
                    color: "var(--text-dim)",
                  }}
                >
                  {questions.filter((q) => q.type === "noul").length} noul ·{" "}
                  {questions.filter((q) => q.type === "choice").length} choice ·{" "}
                  {questions.filter((q) => q.type === "score").length} score
                </span>
              </div>

              <div
                style={{
                  background: "var(--bg-input)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "12px 14px",
                  font: "12.5px/1.6 var(--mono)",
                  color: "var(--text)",
                  whiteSpace: "pre-wrap",
                  maxHeight: 155,
                  overflowY: "auto",
                }}
              >
                {stateText}
              </div>
            </div>
          </section>

          {/* TIER 2: 3-Pillar Executive Proof Scoreboard (Speed, Correctness, Economics) */}
          <section
            className="wb-proof-strip"
            aria-label="Executive Proof Metrics"
          >
            {/* Pillar 1: Latency */}
            <div className="wb-proof-cell">
              <div className="wb-proof-label">
                <span>01 · Latency Speedup</span>
                <span>Single Forward Pass</span>
              </div>
              <div className="wb-proof-main">
                <span className="wb-proof-hero accent">
                  {speedup ? `${speedup}×` : racing ? "…" : "—"}
                </span>
                <div style={{ textAlign: "right", font: "500 11.5px var(--mono)" }}>
                  <div style={{ color: "var(--primary)", fontWeight: 700 }}>
                    Decision-1: {d1Ms ? `${d1Ms} ms` : racing ? "running…" : "—"}
                  </div>
                  <div style={{ color: "var(--terra)" }}>
                    {comparisonModelName}:{" "}
                    {terraMs ? `${terraMs} ms` : racing ? "running…" : "—"}
                  </div>
                </div>
              </div>
              <div className="wb-proof-sub">
                <span>Zero autoregressive generation</span>
                <span>
                  {d1Ms && terraMs
                    ? `Saved ${terraMs - d1Ms} ms / call`
                    : "Ready"}
                </span>
              </div>
            </div>

            {/* Pillar 2: Ground-Truth Correctness */}
            <div className="wb-proof-cell">
              <div className="wb-proof-label">
                <span>02 · Ground-Truth Accuracy</span>
                <span>Verified Policy Answers</span>
              </div>
              <div className="wb-proof-main">
                <span className="wb-proof-hero accent">
                  {d1Result && correctnessSummary.totalQuestions > 0
                    ? `${correctnessSummary.d1AccuracyPct}%`
                    : racing
                    ? "…"
                    : "—"}
                </span>
                <div style={{ textAlign: "right", font: "500 11.5px var(--mono)" }}>
                  <div style={{ color: "var(--primary)", fontWeight: 700 }}>
                    Decision-1:{" "}
                    {d1Result && correctnessSummary.totalQuestions > 0
                      ? `${correctnessSummary.d1Correct}/${correctnessSummary.totalQuestions} pass`
                      : "—"}
                  </div>
                  <div style={{ color: "var(--terra)" }}>
                    {comparisonModelName}:{" "}
                    {terraResult && correctnessSummary.totalQuestions > 0
                      ? `${correctnessSummary.terraCorrect}/${correctnessSummary.totalQuestions} (${correctnessSummary.terraAccuracyPct}%)`
                      : "—"}
                  </div>
                </div>
              </div>
              <div className="wb-proof-sub">
                <span>
                  Avg Confidence: {correctnessSummary.d1AvgConfidencePct}%
                </span>
                <span>
                  Model Agreement:{" "}
                  {comparedCount > 0
                    ? `${agreedCount}/${comparedCount} (${Math.round(
                        (agreedCount / comparedCount) * 100
                      )}%)`
                    : "—"}
                </span>
              </div>
            </div>

            {/* Pillar 3: Production Economics */}
            <div className="wb-proof-cell">
              <div className="wb-proof-label">
                <span>03 · Production Economics</span>
                <span>$0.042/1M In · $0 Out</span>
              </div>
              <div className="wb-proof-main">
                <span className="wb-proof-hero accent">
                  {economicsSummary.savingsPct}%{" "}
                  <small style={{ fontSize: 13, fontWeight: 600 }}>saved</small>
                </span>
                <div style={{ textAlign: "right", font: "500 11.5px var(--mono)" }}>
                  <div style={{ color: "var(--primary)", fontWeight: 700 }}>
                    Decision-1: ${economicsSummary.d1CostPer1kUsd.toFixed(4)} /
                    1k
                  </div>
                  <div style={{ color: "var(--terra)" }}>
                    {comparisonModelName}: $
                    {economicsSummary.terraCostPer1kUsd.toFixed(3)} / 1k
                  </div>
                </div>
              </div>
              <div className="wb-proof-sub">
                <span>{economicsSummary.costMultiplier}× lower cost</span>
                <span>
                  Saves $
                  {economicsSummary.monthlySavingsUsd.toLocaleString("en-US", {
                    maximumFractionDigits: 0,
                  })}
                  /mo @ {(economicsSummary.dailyVolume / 1000).toFixed(0)}k/day
                </span>
              </div>
            </div>
          </section>

          {/* TIER 3: Unified Criterion Verification Table & Secondary Views */}
          <section className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                background: "var(--bg-card)",
              }}
            >
              <div>
                <span className="eyebrow">
                  03 · CRITERION-BY-CRITERION VERIFICATION
                </span>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-muted)",
                    marginTop: 2,
                  }}
                >
                  Calibrated System-1 probabilities vs. generative LLM outputs
                  verified against ground truth
                </div>
              </div>

              <div className="nav-tabs">
                <button
                  type="button"
                  className={`nav-tab ${outTab === "table" ? "active" : ""}`}
                  onClick={() => setOutTab("table")}
                >
                  Verification Table
                </button>
                <button
                  type="button"
                  className={`nav-tab ${outTab === "visual" ? "active" : ""}`}
                  onClick={() => setOutTab("visual")}
                >
                  Side-by-Side Meters
                </button>
                <button
                  type="button"
                  className={`nav-tab ${outTab === "probs" ? "active" : ""}`}
                  onClick={() => setOutTab("probs")}
                >
                  Probability Distribution
                </button>
                <button
                  type="button"
                  className={`nav-tab ${outTab === "api" ? "active" : ""}`}
                  onClick={() => setOutTab("api")}
                >
                  API Payload &amp; cURL
                </button>
              </div>
            </div>

            {/* DEFAULT VIEW: Clean Scannable Verification Table */}
            {outTab === "table" && (
              <div className="wb-table-wrap">
                <table className="wb-table">
                  <thead>
                    <tr>
                      <th>Criterion / Question</th>
                      <th>Type</th>
                      <th>Expected Ground Truth</th>
                      <th>Microsoft-Decision-1 (Calibrated)</th>
                      <th>{comparisonModelName} (Baseline)</th>
                      <th>Verification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((q) => {
                      const d1Ans = d1Result?.answers?.[q.id];
                      const terraAns = terraResult?.answers?.[q.id];
                      const rowCorr = correctnessSummary.rows.find(
                        (r) => r.questionId === q.id
                      );
                      const pct = d1Ans ? Math.round(d1Ans.value * 100) : 0;

                      return (
                        <tr key={q.id}>
                          <td style={{ maxWidth: 290 }}>
                            <div style={{ fontWeight: 600, color: "var(--text)" }}>
                              {q.label}
                            </div>
                            <div
                              style={{
                                fontSize: 11.5,
                                color: "var(--text-muted)",
                                marginTop: 2,
                              }}
                            >
                              {q.instructions}
                            </div>
                          </td>
                          <td>
                            <span
                              style={{
                                font: "600 10px var(--mono)",
                                textTransform: "uppercase",
                                padding: "2px 7px",
                                borderRadius: 4,
                                background: "var(--bg-card-soft)",
                                border: "1px solid var(--border)",
                              }}
                            >
                              {q.type}
                            </span>
                          </td>
                          <td
                            style={{
                              font: "600 12px var(--mono)",
                              color: "var(--text)",
                            }}
                          >
                            {rowCorr?.expected || "—"}
                          </td>
                          <td style={{ minWidth: 210 }}>
                            {d1Ans ? (
                              <div>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "baseline",
                                    gap: 8,
                                  }}
                                >
                                  <b
                                    style={{
                                      color: "var(--primary)",
                                      fontSize: 13.5,
                                    }}
                                  >
                                    {d1Ans.label}
                                  </b>
                                  <span
                                    style={{
                                      font: "500 10.5px var(--mono)",
                                      color: "var(--text-muted)",
                                    }}
                                  >
                                    {d1Ans.detail}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    height: 5,
                                    borderRadius: 3,
                                    background: "var(--track)",
                                    marginTop: 5,
                                    overflow: "hidden",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${pct}%`,
                                      height: "100%",
                                      background: "var(--primary)",
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: "var(--text-dim)" }}>
                                {racing ? "Evaluating…" : "—"}
                              </span>
                            )}
                          </td>
                          <td>
                            {terraAns ? (
                              <div>
                                <b
                                  style={{
                                    color: "var(--terra)",
                                    fontSize: 13,
                                  }}
                                >
                                  {terraAns.label}
                                </b>
                                <div
                                  style={{
                                    font: "500 10.5px var(--mono)",
                                    color: "var(--text-muted)",
                                    marginTop: 2,
                                  }}
                                >
                                  {terraAns.detail}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: "var(--text-dim)" }}>
                                {racing ? "Generating…" : "—"}
                              </span>
                            )}
                          </td>
                          <td style={{ font: "600 11px var(--mono)" }}>
                            {rowCorr?.d1Match === true ? (
                              <span
                                style={{
                                  color: "var(--primary)",
                                  background: "var(--primary-soft)",
                                  padding: "3px 8px",
                                  borderRadius: 4,
                                  border: "1px solid var(--border-strong)",
                                }}
                              >
                                ✓ PASS
                              </span>
                            ) : rowCorr?.d1Match === false ? (
                              <span
                                style={{
                                  color: "var(--danger)",
                                  background: "var(--danger-soft)",
                                  padding: "3px 8px",
                                  borderRadius: 4,
                                }}
                              >
                                ✗ DIFF
                              </span>
                            ) : (
                              <span style={{ color: "var(--text-dim)" }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* SIDE-BY-SIDE VISUAL METERS */}
            {outTab === "visual" && (
              <div style={{ padding: 20 }} className="panels two">
                <div className="panel winner">
                  <div className="panel-head">
                    <div>
                      <span className="badge">MICROSOFT-DECISION-1</span>
                      <div
                        style={{
                          font: "500 11px var(--mono)",
                          color: "var(--text-muted)",
                          marginTop: 3,
                        }}
                      >
                        /providers/microsoft/v1/systemone
                      </div>
                    </div>
                    <span
                      style={{
                        font: "700 13px var(--mono)",
                        color: "var(--primary)",
                      }}
                    >
                      {d1Ms ? `${d1Ms} ms` : "—"}
                    </span>
                  </div>
                  <div
                    className="panel-body"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {questions.map((q) => {
                      const ans = d1Result?.answers?.[q.id];
                      const pct = ans ? Math.round(ans.value * 100) : 0;
                      const cls = ans?.cls || "";
                      return (
                        <div key={q.id} className="dq">
                          <div className="dq-head">
                            <span className="dq-label">{q.label}</span>
                            <span className={`dq-ans ${cls}`}>
                              {ans ? ans.label : "…"}
                            </span>
                          </div>
                          <div
                            className={`dq-meter ${
                              q.type === "score" ? "scale" : cls
                            }`}
                          >
                            <i
                              style={
                                q.type === "score"
                                  ? { left: `${pct}%` }
                                  : { width: `${pct}%` }
                              }
                            />
                          </div>
                          <div className="dq-foot">
                            <span>type: {q.type}</span>
                            <span>{ans ? ans.detail : "waiting"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <span className="badge terra">
                        {comparisonModelName.toUpperCase()}
                      </span>
                      <div
                        style={{
                          font: "500 11px var(--mono)",
                          color: "var(--text-muted)",
                          marginTop: 3,
                        }}
                      >
                        /openai/v1/responses
                      </div>
                    </div>
                    <span
                      style={{
                        font: "700 13px var(--mono)",
                        color: "var(--terra)",
                      }}
                    >
                      {terraMs ? `${terraMs} ms` : "—"}
                    </span>
                  </div>
                  <div
                    className="panel-body"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {questions.map((q) => {
                      const ans = terraResult?.answers?.[q.id];
                      const pct = ans ? Math.round(ans.value * 100) : 0;
                      const cls = ans?.cls || "";
                      return (
                        <div key={q.id} className="dq">
                          <div className="dq-head">
                            <span className="dq-label">{q.label}</span>
                            <span className={`dq-ans ${cls}`}>
                              {ans ? ans.label : "…"}
                            </span>
                          </div>
                          <div
                            className={`dq-meter ${
                              q.type === "score" ? "scale" : cls
                            }`}
                          >
                            <i
                              style={
                                q.type === "score"
                                  ? { left: `${pct}%` }
                                  : { width: `${pct}%` }
                              }
                            />
                          </div>
                          <div className="dq-foot">
                            <span>type: {q.type}</span>
                            <span>{ans ? ans.detail : "waiting"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* PROBABILITY DISTRIBUTION VIEW */}
            {outTab === "probs" && (
              <div
                style={{
                  padding: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {questions.map((q) => {
                  const d1Ans = d1Result?.answers?.[q.id];
                  const terraAns = terraResult?.answers?.[q.id];
                  const p1Map =
                    d1Ans?.probabilities ||
                    (q.type === "noul" && d1Ans
                      ? {
                          Yes: d1Ans.value,
                          No: Number((1 - d1Ans.value).toFixed(4)),
                        }
                      : {});
                  const p2Map =
                    terraAns?.probabilities ||
                    (q.type === "noul" && terraAns
                      ? {
                          Yes: terraAns.value,
                          No: Number((1 - terraAns.value).toFixed(4)),
                        }
                      : {});
                  const allLabels = Array.from(
                    new Set([...Object.keys(p1Map), ...Object.keys(p2Map)])
                  );
                  return (
                    <div key={q.id} className="panel" style={{ padding: 14 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 10,
                          flexWrap: "wrap",
                          gap: 8,
                        }}
                      >
                        <b style={{ fontFamily: "var(--mono)" }}>
                          {q.label} ({q.type})
                        </b>
                        <span
                          style={{ color: "var(--text-muted)", fontSize: 12 }}
                        >
                          {q.instructions}
                        </span>
                      </div>
                      {allLabels.map((lbl) => {
                        const p1 = Math.round((p1Map[lbl] || 0) * 100);
                        const p2 = Math.round((p2Map[lbl] || 0) * 100);
                        return (
                          <div
                            key={lbl}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "150px 1fr 56px 1fr 56px",
                              gap: 10,
                              alignItems: "center",
                              font: "500 11.5px var(--mono)",
                              marginBottom: 6,
                            }}
                          >
                            <span>{lbl}</span>
                            <div
                              style={{
                                height: 7,
                                background: "var(--track)",
                                borderRadius: 3,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${p1}%`,
                                  height: "100%",
                                  background: "var(--primary)",
                                }}
                              />
                            </div>
                            <span
                              style={{
                                color: "var(--primary)",
                                textAlign: "right",
                              }}
                            >
                              {p1}%
                            </span>
                            <div
                              style={{
                                height: 7,
                                background: "var(--track)",
                                borderRadius: 3,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${p2}%`,
                                  height: "100%",
                                  background: "var(--terra)",
                                }}
                              />
                            </div>
                            <span
                              style={{
                                color: "var(--terra)",
                                textAlign: "right",
                              }}
                            >
                              {p2}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {/* API PAYLOAD & CURL VIEW */}
            {outTab === "api" && (
              <div
                style={{
                  padding: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {activeSample.codeRule && (
                  <div className="panel">
                    <div className="panel-head">
                      <span className="badge">
                        DETERMINISTIC GATE RULE IN APPLICATION CODE
                      </span>
                    </div>
                    <div className="panel-body">
                      <pre className="code">{activeSample.codeRule}</pre>
                    </div>
                  </div>
                )}
                <div className="panel">
                  <div className="panel-head">
                    <span className="badge">
                      MICROSOFT ENTRA ID CURL — /providers/microsoft/v1/systemone
                    </span>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => navigator.clipboard?.writeText(curlSnippet)}
                    >
                      Copy cURL
                    </button>
                  </div>
                  <div className="panel-body">
                    <pre className="code">{curlSnippet}</pre>
                  </div>
                </div>
                <div className="panels two">
                  <div className="panel">
                    <div className="panel-head">
                      <span className="badge">DECISION-1 RAW RESPONSE</span>
                    </div>
                    <div className="panel-body">
                      <pre className="code">
                        {d1Result
                          ? JSON.stringify(d1Result, null, 2)
                          : "// Run evaluation to inspect raw JSON"}
                      </pre>
                    </div>
                  </div>
                  <div className="panel">
                    <div className="panel-head">
                      <span className="badge terra">
                        {comparisonModelName.toUpperCase()} RAW RESPONSE
                      </span>
                    </div>
                    <div className="panel-body">
                      <pre className="code">
                        {terraResult
                          ? JSON.stringify(terraResult, null, 2)
                          : "// Run evaluation to inspect raw JSON"}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* SECONDARY DIALOG: Customize Input Document & Typed Question Schema */}
      {schemaModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setSchemaModalOpen(false)}
        >
          <div
            className="modal-window"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  Customize Input Document &amp; Decision Questions
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Edit the input payload or add custom Noul / Choice / Score
                  questions for live evaluation
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setSchemaModalOpen(false);
                    runComparison();
                  }}
                >
                  Apply &amp; Run Evaluation
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSchemaModalOpen(false)}
                >
                  Close &times;
                </button>
              </div>
            </div>

            <div
              className="modal-body"
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    font: "600 11px var(--mono)",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                    marginBottom: 6,
                  }}
                >
                  Input State Document
                </label>
                <textarea
                  value={stateText}
                  onChange={(e) => setStateText(e.target.value)}
                  style={{ minHeight: 150, fontFamily: "var(--mono)", fontSize: 12.5 }}
                />
              </div>

              <div>
                <div
                  style={{
                    font: "600 11px var(--mono)",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                    marginBottom: 8,
                  }}
                >
                  Active Decision Questions ({questions.length})
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    maxHeight: 240,
                    overflowY: "auto",
                  }}
                >
                  {questions.map((q) => (
                    <div
                      key={q.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "90px 1fr auto",
                        gap: 10,
                        alignItems: "center",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--bg-input)",
                        border: "1px solid var(--border-soft)",
                        fontSize: 12.5,
                      }}
                    >
                      <span
                        style={{
                          font: "600 10.5px var(--mono)",
                          textTransform: "uppercase",
                          color: "var(--primary)",
                        }}
                      >
                        {q.type}
                      </span>
                      <div>
                        <b>{q.label}</b> —{" "}
                        <span style={{ color: "var(--text-muted)" }}>
                          {q.instructions}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: "2px 8px", fontSize: 11 }}
                        onClick={() => removeQuestion(q.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  padding: 14,
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  background: "var(--bg-input)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    font: "600 11px var(--mono)",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                >
                  Add Question to Schema
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 180px",
                    gap: 8,
                  }}
                >
                  <input
                    type="text"
                    placeholder="Question label (e.g. Escalation Required)"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                  />
                  <CustomSelect
                    value={newType}
                    onChange={(val) => setNewType(val as QuestionType)}
                    searchable={false}
                    options={[
                      {
                        value: "noul",
                        label: "noul (Yes / No / Unsure)",
                        badge: "NOUL",
                        badgeTone: "d1",
                      },
                      {
                        value: "choice",
                        label: "choice (Multi-option)",
                        badge: "CHOICE",
                        badgeTone: "info",
                      },
                      {
                        value: "score",
                        label: "score (0-3 Rubric)",
                        badge: "SCORE",
                        badgeTone: "custom",
                      },
                    ]}
                  />
                </div>
                <input
                  type="text"
                  placeholder="Question instructions (e.g. Does this request require immediate escalation?)"
                  value={newInst}
                  onChange={(e) => setNewInst(e.target.value)}
                />
                {newType !== "noul" && (
                  <input
                    type="text"
                    placeholder={
                      newType === "choice"
                        ? "Comma-separated options, e.g. approve: Fast track, hold: Manual review"
                        : "Comma-separated scale, e.g. Low, Medium, High, Critical"
                    }
                    value={newCriteriaText}
                    onChange={(e) => setNewCriteriaText(e.target.value)}
                  />
                )}
                <button
                  type="button"
                  className="ghost"
                  style={{ alignSelf: "flex-start" }}
                  onClick={addQuestion}
                >
                  + Add Question
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
