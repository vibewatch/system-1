"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  STUDIO_SAMPLES,
  StudioSample,
  DecisionQuestion,
  QuestionType,
  computeCorrectnessSummary,
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
  endpointUrl = "https://<your-foundry-resource>.cognitiveservices.azure.com",
  allUseCases,
  externalSample,
  externalTrigger,
  onOpenFramework,
}: StudioCompareViewProps) {
  const samples =
    allUseCases && allUseCases.length > 0 ? allUseCases : STUDIO_SAMPLES;
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const [stateText, setStateText] = useState(samples[0].content);
  const [questions, setQuestions] = useState<DecisionQuestion[]>(() => [
    ...samples[0].questions,
  ]);
  const activeSample = samples.find((s) => s.id === sampleId) || samples[0];
  const activeTestCase =
    activeSample.testCases && activeSample.testCases[activeCaseIndex]
      ? activeSample.testCases[activeCaseIndex]
      : undefined;
  const activeExpected = activeTestCase?.expected || activeSample.expected;

  const [outTab, setOutTab] = useState<
    "visual" | "correctness" | "probs" | "json" | "curl"
  >("visual");
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
      sendWs("run_compare", {
        state: STUDIO_SAMPLES[0].content,
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

  const systemOnePayload = buildClientSystemOnePayload(stateText, questions);

  const curlSnippet = `curl --request POST \\
  --url "https://icsuaaisea.cognitiveservices.azure.com/providers/microsoft/v1/systemone" \\
  --header "Authorization: Bearer $(az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv)" \\
  --header "Content-Type: application/json" \\
  --data '${JSON.stringify(systemOnePayload, null, 2).replace(/'/g, "'\\''")}'`;

  return (
    <>
      <section className="hero-banner">
        <div>
          <p className="eyebrow">
            02 · HEAD-TO-HEAD DECISION STUDIO · SYSTEMONE VS RESPONSES API
          </p>
          <h1>
            Same document, same typed questions — <strong>raced live.</strong>
          </h1>
        </div>
        <p className="hero-copy">
          Compare <b>Microsoft-Decision-1</b> (calibrated <code>noul</code>,{" "}
          <code>choice</code>, and <code>score</code> logprob distributions in
          one pass) against <b>{comparisonModelName}</b> structured output with{" "}
          <b>ground-truth correctness verification</b> across{" "}
          <b>{samples.length}</b> enterprise solutions.
        </p>
      </section>

      <main className="layout split-5-7">
        {/* Left: Input State & Typed Questions */}
        <section className="card">
          <div className="card-head" style={{ flexWrap: "wrap", gap: 10 }}>
            <span className="eyebrow">01 · SOLUTION &amp; TEST CASE SELECTOR</span>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flex: 1,
                justifyContent: "flex-end",
              }}
            >
              <div style={{ minWidth: 320, maxWidth: 440, flex: 1 }}>
                <CustomSelect
                  value={sampleId}
                  onChange={(val) => selectSample(val)}
                  options={samples.map((s) => ({
                    value: s.id,
                    label: s.label,
                    category: `${s.industry || "Cross-Industry"} · ${
                      s.category
                    }`,
                    description: s.description,
                    badge:
                      s.origin === "industry"
                        ? "INDUSTRY"
                        : s.origin === "custom"
                        ? "CUSTOM"
                        : "CORE",
                    badgeTone:
                      s.origin === "industry"
                        ? "d1"
                        : s.origin === "custom"
                        ? "custom"
                        : "neutral",
                  }))}
                />
              </div>
              {onOpenFramework && (
                <button
                  type="button"
                  className="ghost"
                  onClick={onOpenFramework}
                  title="Browse Industry Solutions, run multi-case correctness benchmarks, or create your own solution"
                >
                  + Solution Hub ({samples.length})
                </button>
              )}
            </div>
          </div>

          {/* Multi-Case Ground-Truth Selector Pills */}
          {activeSample.testCases && activeSample.testCases.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: 10,
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--bg-input)",
                border: "1px solid var(--border-soft)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "0.68rem",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                }}
              >
                Ground-Truth Test Cases:
              </span>
              {activeSample.testCases.map((tc, idx) => (
                <button
                  key={tc.id}
                  type="button"
                  className={`industry-pill ${
                    activeCaseIndex === idx ? "active" : ""
                  }`}
                  onClick={() => selectTestCase(idx)}
                >
                  {tc.title}
                </button>
              ))}
              {activeTestCase?.expectedGateVerdict && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "var(--mono)",
                    fontSize: "0.68rem",
                    color: "var(--accent-d1)",
                  }}
                >
                  Expected Verdict: <b>{activeTestCase.expectedGateVerdict}</b>
                </span>
              )}
            </div>
          )}

          {activeSample?.codeRule && (
            <div className="uc-code-rule" style={{ marginBottom: 10 }}>
              <span style={{ color: "var(--text-muted)" }}>
                // Deterministic Gate ({activeSample.industry || activeSample.category}):{" "}
              </span>
              {activeSample.codeRule}
            </div>
          )}

          <textarea
            value={stateText}
            onChange={(e) => setStateText(e.target.value)}
            placeholder="Paste any customer ticket, contract clause, call transcript, or incident report..."
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              font: "500 11px var(--mono)",
              color: "var(--text-muted)",
              marginTop: 6,
            }}
          >
            <span>
              {stateText.trim() ? stateText.trim().split(/\s+/).length : 0} words
              · {stateText.length} chars
            </span>
            <span>Sent as `state` to `/providers/microsoft/v1/systemone`</span>
          </div>

          <div className="card-head sub">
            <span className="eyebrow">
              02 · TYPED QUESTIONS ({questions.length})
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {questions.map((q) => (
              <div
                key={q.id}
                style={{
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <b style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                      {q.id}
                    </b>
                    <span className="badge">{q.type}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      ({q.label})
                    </span>
                  </div>
                  <div
                    style={{
                      color: "var(--text-muted)",
                      fontSize: 12.5,
                      marginTop: 2,
                    }}
                  >
                    {q.instructions}
                  </div>
                  {q.criteria && (
                    <div
                      style={{
                        font: "500 10.5px var(--mono)",
                        color: "var(--cyan)",
                        marginTop: 3,
                      }}
                    >
                      {Array.isArray(q.criteria)
                        ? `scale: [${q.criteria.join(" → ")}]`
                        : `choices: {${Object.keys(q.criteria).join(", ")}}`}
                    </div>
                  )}
                </div>
                <button
                  className="ghost"
                  onClick={() => removeQuestion(q.id)}
                  style={{ padding: "2px 8px", fontSize: 11 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Add custom typed question */}
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              border: "1px dashed var(--border)",
              background: "var(--bg-input)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span className="eyebrow">ADD TYPED QUESTION</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="question_id (e.g. sla_breach)"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                style={{ flex: 1 }}
              />
              <div style={{ minWidth: 225 }}>
                <CustomSelect
                  size="sm"
                  value={newType}
                  onChange={(val) => setNewType(val as QuestionType)}
                  options={[
                    {
                      value: "noul",
                      label: "noul (Yes/No prob)",
                      badge: "NOUL",
                      badgeTone: "d1",
                    },
                    {
                      value: "choice",
                      label: "choice (Categorize)",
                      badge: "CHOICE",
                      badgeTone: "info",
                    },
                    {
                      value: "score",
                      label: "score (0..N scale)",
                      badge: "SCORE",
                      badgeTone: "neutral",
                    },
                  ]}
                />
              </div>
            </div>
            <input
              type="text"
              placeholder="Instructions (e.g. Does this require immediate SLA escalation?)"
              value={newInst}
              onChange={(e) => setNewInst(e.target.value)}
            />
            {newType !== "noul" && (
              <input
                type="text"
                placeholder={
                  newType === "choice"
                    ? "Comma-separated options (e.g. billing, engineering, security)"
                    : "Comma-separated scale low to high (e.g. low, medium, high, critical)"
                }
                value={newCriteriaText}
                onChange={(e) => setNewCriteriaText(e.target.value)}
              />
            )}
            <button
              className="ghost"
              onClick={addQuestion}
              style={{ alignSelf: "flex-start" }}
            >
              + Add Question to Payload
            </button>
          </div>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              style={{
                font: "500 11px var(--mono)",
                color: "var(--text-muted)",
              }}
            >
              WebSocket realtime race
            </span>
            <button
              className="primary"
              onClick={runComparison}
              disabled={racing || !wsConnected}
            >
              {racing
                ? "Racing Models over WebSocket…"
                : "⚡ Race Decision-1 vs gpt-6.1-terra"}
            </button>
          </div>
        </section>

        {/* Right: Live Comparison Results */}
        <section className="card">
          <div className="card-head">
            <span className="eyebrow">03 · HEAD-TO-HEAD TELEMETRY & OUTPUT</span>
            <div className="nav-tabs">
              <button
                className={`nav-tab ${outTab === "visual" ? "active" : ""}`}
                onClick={() => setOutTab("visual")}
              >
                Visual Compare
              </button>
              <button
                className={`nav-tab ${
                  outTab === "correctness" ? "active" : ""
                }`}
                onClick={() => setOutTab("correctness")}
              >
                Correctness Matrix
              </button>
              <button
                className={`nav-tab ${outTab === "probs" ? "active" : ""}`}
                onClick={() => setOutTab("probs")}
              >
                Probabilities
              </button>
              <button
                className={`nav-tab ${outTab === "json" ? "active" : ""}`}
                onClick={() => setOutTab("json")}
              >
                Raw JSON
              </button>
              <button
                className={`nav-tab ${outTab === "curl" ? "active" : ""}`}
                onClick={() => setOutTab("curl")}
              >
                API & cURL
              </button>
            </div>
          </div>

          {/* Race summary box */}
          <div className="compare-summary">
            <div className="race">
              <span className="lbl d1">Microsoft-Decision-1</span>
              <span className="track">
                <i
                  className="bar d1"
                  style={{
                    width: d1Ms
                      ? `${Math.max(6, (d1Ms / maxMs) * 100)}%`
                      : "0%",
                  }}
                />
              </span>
              <span className="val">
                {d1Ms ? `${d1Ms} ms` : racing ? "running…" : "—"}
                <small>
                  {d1Result?.usage
                    ? `${
                        d1Result.usage.input_tokens +
                        d1Result.usage.output_tokens
                      } tok`
                    : "systemone"}
                </small>
              </span>

              <span className="lbl terra">gpt-6.1-terra</span>
              <span className="track">
                <i
                  className="bar terra"
                  style={{
                    width: terraMs
                      ? `${Math.max(6, (terraMs / maxMs) * 100)}%`
                      : "0%",
                  }}
                />
              </span>
              <span className="val">
                {terraMs ? `${terraMs} ms` : racing ? "running…" : "—"}
                <small>
                  {terraResult?.usage
                    ? `${
                        terraResult.usage.input_tokens +
                        terraResult.usage.output_tokens
                      } tok`
                    : "responses api"}
                </small>
              </span>
            </div>

            <div className="speedup">
              <span className="x">{speedup ? `${speedup}×` : "—"}</span>
              <span className="x-label">
                {speedup
                  ? "Decision-1 latency speedup"
                  : "Run race to measure"}
              </span>
            </div>

            <div className="compare-agree" style={{ flexWrap: "wrap", gap: 10 }}>
              <span>
                Decision-1 Ground-Truth Correctness:{" "}
                <b style={{ color: "var(--primary-bright)" }}>
                  {d1Result && correctnessSummary.totalQuestions > 0
                    ? `${correctnessSummary.d1Correct}/${correctnessSummary.totalQuestions} (${correctnessSummary.d1AccuracyPct}%)`
                    : "—"}
                </b>
              </span>
              <span>
                {comparisonModelName} Correctness:{" "}
                <b style={{ color: "var(--terra-bright)" }}>
                  {terraResult && correctnessSummary.totalQuestions > 0
                    ? `${correctnessSummary.terraCorrect}/${correctnessSummary.totalQuestions} (${correctnessSummary.terraAccuracyPct}%)`
                    : "—"}
                </b>
              </span>
              <span>
                Model Agreement:{" "}
                <b>
                  {comparedCount > 0
                    ? `${agreedCount}/${comparedCount} (${Math.round(
                        (agreedCount / comparedCount) * 100
                      )}%)`
                    : "waiting…"}
                </b>
              </span>
            </div>
          </div>

          {outTab === "correctness" && (
            <div className="panel" style={{ padding: 14 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div>
                  <b style={{ fontFamily: "var(--mono)", fontSize: "0.8rem" }}>
                    GROUND-TRUTH CORRECTNESS &amp; CALIBRATION MATRIX
                  </b>
                  <div
                    style={{
                      fontSize: "0.73rem",
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    Verifies both models against expected reference answers for{" "}
                    <b>{activeTestCase?.title || activeSample.label}</b>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    fontFamily: "var(--mono)",
                    fontSize: "0.74rem",
                  }}
                >
                  <span>
                    D1 Accuracy:{" "}
                    <b style={{ color: "var(--primary-bright)" }}>
                      {correctnessSummary.d1AccuracyPct}%
                    </b>{" "}
                    (Avg Conf: {correctnessSummary.d1AvgConfidencePct}%)
                  </span>
                  <span>
                    {comparisonModelName}:{" "}
                    <b style={{ color: "var(--terra-bright)" }}>
                      {correctnessSummary.terraAccuracyPct}%
                    </b>
                  </span>
                </div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontFamily: "var(--mono)",
                    fontSize: "0.74rem",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: "1px solid var(--border)",
                        textAlign: "left",
                        color: "var(--text-muted)",
                      }}
                    >
                      <th style={{ padding: "8px 6px" }}>Question</th>
                      <th style={{ padding: "8px 6px" }}>Type</th>
                      <th style={{ padding: "8px 6px" }}>
                        Expected Ground Truth
                      </th>
                      <th style={{ padding: "8px 6px" }}>
                        Microsoft-Decision-1
                      </th>
                      <th style={{ padding: "8px 6px" }}>
                        {comparisonModelName}
                      </th>
                      <th style={{ padding: "8px 6px" }}>Models Agree?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {correctnessSummary.rows.map((r) => (
                      <tr
                        key={r.questionId}
                        style={{
                          borderBottom: "1px solid var(--border-soft)",
                        }}
                      >
                        <td style={{ padding: "9px 6px" }}>
                          <b>{r.questionId}</b>
                          <div
                            style={{
                              fontSize: "0.66rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            {r.questionLabel}
                          </div>
                        </td>
                        <td style={{ padding: "9px 6px" }}>
                          <span className="badge">{r.type}</span>
                        </td>
                        <td
                          style={{
                            padding: "9px 6px",
                            color: "var(--accent-d1)",
                          }}
                        >
                          <b>{r.expected}</b>
                        </td>
                        <td style={{ padding: "9px 6px" }}>
                          <b>{r.d1Actual}</b>{" "}
                          {r.d1Confidence != null && (
                            <span style={{ color: "var(--text-muted)" }}>
                              ({r.d1Confidence}%)
                            </span>
                          )}{" "}
                          {r.d1Match === true && (
                            <span style={{ color: "var(--accent-d1)" }}>
                              ✓ PASS
                            </span>
                          )}
                          {r.d1Match === false && (
                            <span style={{ color: "var(--danger)" }}>
                              ✗ MISS
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "9px 6px" }}>
                          <b>{r.terraActual}</b>{" "}
                          {r.terraConfidence != null && (
                            <span style={{ color: "var(--text-muted)" }}>
                              ({r.terraConfidence}%)
                            </span>
                          )}{" "}
                          {r.terraMatch === true && (
                            <span style={{ color: "var(--accent-d1)" }}>
                              ✓ PASS
                            </span>
                          )}
                          {r.terraMatch === false && (
                            <span style={{ color: "var(--danger)" }}>
                              ✗ MISS
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "9px 6px" }}>
                          {r.modelsAgree === true ? (
                            <span style={{ color: "var(--accent-d1)" }}>
                              ✓ Agree
                            </span>
                          ) : r.modelsAgree === false ? (
                            <span style={{ color: "var(--warn)" }}>
                              ≠ Diverge
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {outTab === "visual" && (
            <div className="panels two">
              {/* Decision-1 Panel */}
              <div className="panel winner">
                <div className="panel-head">
                  <div>
                    <span className="badge">MICROSOFT-DECISION-1</span>
                    <div
                      style={{
                        font: "600 11px var(--mono)",
                        color: "var(--text-muted)",
                        marginTop: 4,
                      }}
                    >
                      /providers/microsoft/v1/systemone
                    </div>
                  </div>
                  <div
                    style={{ textAlign: "right", font: "600 12px var(--mono)" }}
                  >
                    <span style={{ color: "var(--primary-bright)" }}>
                      {d1Ms ? `${d1Ms} ms` : "…"}
                    </span>
                  </div>
                </div>
                <div className="panel-body">
                  <div
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
                      const rowCorr = correctnessSummary.rows.find(
                        (r) => r.questionId === q.id
                      );
                      return (
                        <div key={q.id} className="dq">
                          <div className="dq-head">
                            <span className="dq-label">{q.label}</span>
                            <span className={`dq-ans ${cls}`}>
                              {ans ? ans.label : "…"}
                              {ans && rowCorr?.d1Match === true && (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    color: "var(--accent-d1)",
                                    fontSize: 10.5,
                                  }}
                                >
                                  ✓
                                </span>
                              )}
                              {ans && rowCorr?.d1Match === false && (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    color: "var(--danger)",
                                    fontSize: 10.5,
                                  }}
                                >
                                  ✗
                                </span>
                              )}
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
                            <span>
                              type: {q.type}
                              {rowCorr?.expected && rowCorr.expected !== "—"
                                ? ` · expected: ${rowCorr.expected}`
                                : ""}
                            </span>
                            <span>{ans ? ans.detail : "waiting"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* gpt-6.1-terra Panel */}
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="badge terra">GPT-6.1-TERRA</span>
                    <div
                      style={{
                        font: "600 11px var(--mono)",
                        color: "var(--text-muted)",
                        marginTop: 4,
                      }}
                    >
                      /openai/v1/responses (icsuaaisea)
                    </div>
                  </div>
                  <div
                    style={{ textAlign: "right", font: "600 12px var(--mono)" }}
                  >
                    <span style={{ color: "var(--terra-bright)" }}>
                      {terraMs ? `${terraMs} ms` : "…"}
                    </span>
                  </div>
                </div>
                <div className="panel-body">
                  <div
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
            </div>
          )}

          {outTab === "probs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
                            gridTemplateColumns: "160px 1fr 75px",
                            gap: 10,
                            alignItems: "center",
                            marginBottom: 6,
                            fontSize: 12,
                          }}
                        >
                          <span style={{ fontFamily: "var(--mono)" }}>
                            {lbl}
                          </span>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                            }}
                          >
                            <div
                              style={{
                                height: 6,
                                background: "var(--track)",
                                borderRadius: 3,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${p1}%`,
                                  height: "100%",
                                  background: "var(--primary-bright)",
                                }}
                              />
                            </div>
                            <div
                              style={{
                                height: 6,
                                background: "var(--track)",
                                borderRadius: 3,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${p2}%`,
                                  height: "100%",
                                  background: "var(--terra-bright)",
                                }}
                              />
                            </div>
                          </div>
                          <span
                            style={{
                              fontFamily: "var(--mono)",
                              textAlign: "right",
                              fontSize: 11,
                            }}
                          >
                            <span style={{ color: "var(--primary-bright)" }}>
                              {p1}%
                            </span>{" "}
                            /{" "}
                            <span style={{ color: "var(--terra-bright)" }}>
                              {p2}%
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {outTab === "json" && (
            <div className="panels two">
              <div className="panel">
                <div className="panel-head">
                  <span className="badge">Microsoft-Decision-1 JSON</span>
                </div>
                <div className="panel-body">
                  <pre className="code">
                    {JSON.stringify(
                      d1Result?.rawPayload || d1Result || { status: "waiting" },
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>
              <div className="panel">
                <div className="panel-head">
                  <span className="badge terra">gpt-6.1-terra JSON</span>
                </div>
                <div className="panel-body">
                  <pre className="code">
                    {JSON.stringify(
                      terraResult?.rawPayload ||
                        terraResult || { status: "waiting" },
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {outTab === "curl" && (
            <div className="panel">
              <div className="panel-head">
                <span className="badge">
                  POST /providers/microsoft/v1/systemone (Entra ID Bearer Auth)
                </span>
                <button
                  className="ghost"
                  onClick={() => navigator.clipboard.writeText(curlSnippet)}
                >
                  Copy cURL
                </button>
              </div>
              <div className="panel-body">
                <pre className="code">{curlSnippet}</pre>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
