"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  STUDIO_SAMPLES,
  type StudioSample,
  type DecisionQuestion,
  type QuestionType,
  computeCorrectnessSummary,
  computeUseCaseEconomics,
  getScenarioNarrative,
} from "@/lib/demo-data";
import type { DecisionRunResult } from "@/lib/foundry";
import { CustomSelect } from "./CustomSelect";
import { Dialog } from "./Dialog";

interface StudioCompareViewProps {
  sendWs: (action: string, payload?: Record<string, any>) => boolean;
  subscribeWs: (handler: (msg: { event: string; data: any; ts: number }) => void) => () => void;
  wsConnected: boolean;
  comparisonModelName?: string;
  endpointUrl?: string;
  allUseCases?: StudioSample[];
  externalSample?: StudioSample | null;
  externalTrigger?: number;
  onOpenFramework?: () => void;
  onOpenSettings?: () => void;
}

export default function StudioCompareView({
  sendWs, subscribeWs, wsConnected,
  comparisonModelName = "gpt-6.1-terra",
  endpointUrl = "https://icsuaaisea.cognitiveservices.azure.com",
  allUseCases, externalSample, externalTrigger, onOpenFramework, onOpenSettings,
}: StudioCompareViewProps) {
  const samples = allUseCases?.length ? allUseCases : STUDIO_SAMPLES;
  const [sampleId, setSampleId] = useState(samples[0].id);
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const [stateText, setStateText] = useState(samples[0].testCases?.[0]?.content || samples[0].content);
  const [questions, setQuestions] = useState<DecisionQuestion[]>([...samples[0].questions]);
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [outTab, setOutTab] = useState<"metrics" | "visual" | "probs" | "api">("metrics");
  const [racing, setRacing] = useState(false);
  const [d1Result, setD1Result] = useState<DecisionRunResult | null>(null);
  const [terraResult, setTerraResult] = useState<DecisionRunResult | null>(null);
  const [error, setError] = useState("");
  const [edited, setEdited] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<QuestionType>("noul");
  const [newInst, setNewInst] = useState("");
  const [newCriteriaText, setNewCriteriaText] = useState("");
  const lastExternalTrigger = useRef(0);

  const activeSample = samples.find((s) => s.id === sampleId) || samples[0];
  const activeTestCase = activeSample.testCases?.[activeCaseIndex];
  const activeExpected = edited ? undefined : activeTestCase?.expected || activeSample.expected;
  const expectedCount = questions.filter((question) => activeExpected?.[question.id]).length;
  const narrative = getScenarioNarrative(activeSample);
  const shortTitle = (sample: StudioSample) => sample.label.split("·").pop()!.trim();

  useEffect(() => subscribeWs(({ event, data }) => {
    if (event === "compare_started") {
      setRacing(true);
      setD1Result(null);
      setTerraResult(null);
      setError("");
    } else if (event === "compare_model_done") {
      if (data.error || data.result?.error) {
        setError((previous) => [previous, `${data.tier === "decision1" ? "Decision-1" : comparisonModelName}: ${data.error || data.result.error}`].filter(Boolean).join(" "));
      }
      if (data.tier === "decision1") setD1Result(data.result || null);
      if (data.tier === "terra") setTerraResult(data.result || null);
    } else if (event === "compare_finished") {
      setRacing(false);
    } else if (event === "error") {
      setError(data.message || data.error || "Evaluation failed. Check your connection settings.");
      setRacing(false);
    }
  }), [subscribeWs, comparisonModelName]);

  useEffect(() => {
    if (!wsConnected) setRacing(false);
  }, [wsConnected]);

  const clearResults = () => {
    setD1Result(null);
    setTerraResult(null);
    setError("");
  };
  const loadSample = (sample: StudioSample) => {
    setSampleId(sample.id);
    setActiveCaseIndex(0);
    setStateText(sample.testCases?.[0]?.content || sample.content);
    setQuestions([...sample.questions]);
    setEdited(false);
    clearResults();
  };
  useEffect(() => {
    if (!racing && externalSample && externalTrigger && externalTrigger !== lastExternalTrigger.current) {
      lastExternalTrigger.current = externalTrigger;
      loadSample(externalSample);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSample, externalTrigger, racing]);

  const selectTestCase = (index: number) => {
    const testCase = activeSample.testCases?.[index];
    if (!testCase) return;
    setActiveCaseIndex(index);
    setStateText(testCase.content);
    setQuestions([...activeSample.questions]);
    setEdited(false);
    clearResults();
  };
  const runComparison = () => {
    if (!wsConnected || racing || !questions.length || !stateText.trim()) return;
    clearResults();
    setRacing(true);
    if (!sendWs("run_compare", { state: stateText, questions, mode: "compare" })) {
      setRacing(false);
      setError("Not connected. Open connection settings to continue.");
    }
  };
  const markEdited = () => {
    setEdited(true);
    clearResults();
  };
  const addQuestion = () => {
    const id = (newKey || newInst).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 28);
    if (!id || !newInst.trim() || questions.some((q) => q.id === id)) return;
    const question: DecisionQuestion = { id, label: newKey.trim() || newInst.trim().slice(0, 32), type: newType, instructions: newInst.trim() };
    const parts = newCriteriaText.split(",").map((part) => part.trim()).filter(Boolean);
    if (newType === "choice") {
      question.criteria = Object.fromEntries((parts.length ? parts : ["option_a", "option_b"]).map((part) => {
        const [key, description] = part.split(":").map((value) => value.trim());
        return [key, description || `Select when ${key} applies.`];
      }));
    } else if (newType === "score") {
      question.criteria = parts.length ? parts : ["Low", "Medium", "High", "Critical"];
    }
    setQuestions((previous) => [...previous, question]);
    setNewKey("");
    setNewInst("");
    setNewCriteriaText("");
    markEdited();
  };

  const correctness = useMemo(() => computeCorrectnessSummary(
    questions, activeExpected, d1Result?.answers, terraResult?.answers,
  ), [questions, activeExpected, d1Result, terraResult]);
  const economics = computeUseCaseEconomics(
    { ...activeSample, content: stateText, questions }, d1Result?.usage, terraResult?.usage,
  );
  const d1Ms = d1Result?.latency_ms || 0;
  const terraMs = terraResult?.latency_ms || 0;
  const speedup = d1Ms && terraMs ? (terraMs / d1Ms).toFixed(1) : null;
  const hasResults = Boolean(d1Result || terraResult);
  const payload = {
    model: "Decision-1", state: stateText,
    questions: Object.fromEntries(questions.map((q) => [q.id, { type: q.type, instructions: q.instructions, ...(q.criteria ? { criteria: q.criteria } : {}) }])),
  };
  const curl = `curl --request POST \\
  --url "${endpointUrl}/providers/microsoft/v1/systemone" \\
  --header "Authorization: Bearer $(az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv)" \\
  --header "Content-Type: application/json" \\
  --data '${JSON.stringify(payload, null, 2).replace(/'/g, "'\\''")}'`;

  return (
    <main id="main-content" className="decision-page">
      <div className="scenario-picker-row">
        <div className="scenario-picker">
          <span className="step-label">01 / Choose a scenario</span>
          <CustomSelect
            value={activeSample.id}
            onChange={(id) => { const sample = samples.find((s) => s.id === id); if (sample) loadSample(sample); }}
            disabled={racing}
            minWidth={0}
            searchable
            options={samples.map((sample) => ({ value: sample.id, label: shortTitle(sample), category: sample.industry, description: sample.category }))}
          />
        </div>
        <button className="text-button" onClick={onOpenFramework}>Browse all solutions &rarr;</button>
      </div>

      <header className="scenario-heading">
        <span className="section-label">{activeSample.industry || "Your solution"}</span>
        <h1>{shortTitle(activeSample)}</h1>
        <p>{narrative.problemSolved}</p>
        <details className="purpose-disclosure" key={activeSample.id}>
          <summary>What does this scenario demonstrate?</summary>
          <div className="purpose-content">
            <p><strong>Capability being tested</strong>{narrative.whatItProves}</p>
            <p><strong>How to read the result</strong>Both models answer the same {questions.length} questions. Compare their answers with the expected labels, then inspect response time and estimated cost. Accuracy here applies to this test case, not the whole model.</p>
          </div>
        </details>
      </header>

      <div className="comparison-stage">
        <section className="input-pane" aria-label="Test input">
          <div className="pane-heading">
            <h2><span className="step-label">02 /</span> Test input</h2>
            <button className="text-button" disabled={racing} onClick={() => setSchemaModalOpen(true)}>Edit input &amp; questions</button>
          </div>
          <div className="input-case-tabs" aria-label="Test cases">
            {activeSample.testCases?.map((testCase, index) => (
              <button
                key={testCase.id}
                className={`input-case-tab ${index === activeCaseIndex ? "active" : ""}`}
                aria-pressed={index === activeCaseIndex}
                disabled={racing}
                onClick={() => selectTestCase(index)}
                title={testCase.title}
              >
                {activeSample.testCases!.length === 1 ? "Primary case" : testCase.scenarioType === "violation" ? "High-risk case" : "Safe case"}
              </button>
            ))}
          </div>
          <p className="case-caption">{edited ? "Custom input · expected labels are not verified" : activeTestCase?.title || "Default input"}</p>
          <div className="input-document" tabIndex={0}>{stateText}</div>
          <div className="run-actions">
            <button className="primary compare-button" disabled={racing || !wsConnected || !questions.length || !stateText.trim()} onClick={runComparison}>
              {racing ? "Comparing models…" : "Compare models"} {!racing && <span aria-hidden="true">&rarr;</span>}
            </button>
            <span>{questions.length} questions · runs only when requested</span>
          </div>
          {!wsConnected && <button className="connection-prompt" onClick={onOpenSettings}>Set up a connection to run this test &rarr;</button>}
        </section>

        <section className="results-pane" aria-label="Comparison results" aria-busy={racing}>
          <div className="pane-heading">
            <h2><span className="step-label">03 /</span> Compare the decisions</h2>
            {hasResults && <button className="text-button" onClick={() => setDetailsOpen(true)}>Inspect details &rarr;</button>}
          </div>
          {error && <p role="alert" className="comparison-error">{error}</p>}
          {!hasResults && !racing ? (
            <div className="result-empty">
              <span className="empty-rule" />
              <h3>Same input. Two approaches.</h3>
              <p>Run a comparison to see Microsoft-Decision-1 and {comparisonModelName} answer the same questions.</p>
              <div className="empty-legend"><span>Decision-1</span><span>{comparisonModelName}</span></div>
              <p className="empty-note">Check the decisions first. Speed and cost follow.</p>
            </div>
          ) : (
            <>
              <div className="result-summary" role="status">
                <div><span>Response time</span><strong>{speedup ? `${speedup}×` : racing ? "Comparing…" : "—"}</strong><small>{speedup ? "baseline time / Decision-1 time" : "Waiting for both models"}</small></div>
                <div><span>Expected labels matched</span><strong>{d1Result && expectedCount ? `${correctness.d1Correct}/${expectedCount}` : "—"}</strong><small>{expectedCount ? "Decision-1 · this test case" : "No ground truth set"}</small></div>
                <div><span>Cost / 1,000 calls</span><strong>${economics.d1CostPer1kUsd.toFixed(4)}</strong><small>Decision-1 · {d1Result?.usage?.input_tokens ? "usage-based" : "estimated"}</small></div>
              </div>
              <div className="answer-grid">
                <div className="answer-grid-head"><span>Question / expected</span><span>Decision-1<small>{d1Ms ? `${d1Ms} ms` : "Evaluating…"}</small></span><span>{comparisonModelName}<small>{terraMs ? `${terraMs} ms` : "Evaluating…"}</small></span></div>
                {questions.map((question) => {
                  const row = correctness.rows.find((item) => item.questionId === question.id);
                  return (
                    <div className="answer-grid-row" key={question.id}>
                      <div><strong>{question.label}</strong><small>Expected: {row?.expected || "Not set"}</small></div>
                      {[d1Result, terraResult].map((result, index) => {
                        const answer = result?.answers?.[question.id];
                        const match = activeExpected?.[question.id] ? index === 0 ? row?.d1Match : row?.terraMatch : undefined;
                        return <div key={index} className={index === 0 ? "decision-answer" : "baseline-answer"}>
                          <strong>{answer?.label || (racing ? "…" : "Unavailable")}</strong>
                          {answer && <small className={match === false ? "answer-mismatch" : ""}>{match === true ? "Matches expected" : match === false ? "Differs from expected" : "No expected label"}</small>}
                        </div>;
                      })}
                    </div>
                  );
                })}
              </div>
              <button className="text-button result-details-link" onClick={() => setDetailsOpen(true)}>View probabilities, cost breakdown &amp; API &rarr;</button>
            </>
          )}
        </section>
      </div>

      <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Evaluation details" maxWidth={980}>
        <div className="modal-head"><h2>Evaluation details</h2><button className="ghost" onClick={() => setDetailsOpen(false)}>Close &times;</button></div>
        <div className="modal-body">
          <div className="detail-tabs" aria-label="Result detail views">
            {([["metrics", "Speed & cost"], ["visual", "Answer meters"], ["probs", "Probabilities"], ["api", "API & JSON"]] as const).map(([id, label]) =>
              <button key={id} className={`input-case-tab ${outTab === id ? "active" : ""}`} aria-pressed={outTab === id} onClick={() => setOutTab(id)}>{label}</button>
            )}
          </div>
          {outTab === "metrics" && <>
            <div className="wb-table-wrap"><table className="wb-table">
              <thead><tr><th>Measurement</th><th>Decision-1</th><th>{comparisonModelName}</th></tr></thead>
              <tbody>
                <tr><td>Response time</td><td>{d1Ms || "—"} ms</td><td>{terraMs || "—"} ms</td></tr>
                <tr><td>Matched expected labels</td><td>{d1Result && expectedCount ? `${correctness.d1Correct}/${expectedCount}` : "—"}</td><td>{terraResult && expectedCount ? `${correctness.terraCorrect}/${expectedCount}` : "—"}</td></tr>
                <tr><td>Cost per 1,000 calls</td><td>${economics.d1CostPer1kUsd.toFixed(4)}</td><td>${economics.terraCostPer1kUsd.toFixed(4)}</td></tr>
                <tr><td>Input tokens</td><td>{economics.d1InputTokens}</td><td>{economics.terraInputTokens}</td></tr>
                <tr><td>Output tokens</td><td>{economics.d1OutputTokens}</td><td>{economics.terraOutputTokens}</td></tr>
              </tbody>
            </table></div>
            <p className="detail-note">{economics.isLiveMeasured ? "Token counts use reported usage where available; missing usage is estimated." : "Costs are estimates based on input and question length."} Configured rates: Decision-1 $0.042 / 1M input, $0 output; baseline $2.50 / 1M input, $10 / 1M output. Check your deployment's pricing before forecasting.</p>
            <p className="detail-note">At {economics.dailyVolume.toLocaleString()} calls / day: estimated monthly savings ${economics.monthlySavingsUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}. Confidence and agreement are not substitutes for representative ground-truth testing.</p>
          </>}
          {(outTab === "probs" || outTab === "visual") && questions.map((question) => <section className="answer-detail" key={question.id}>
            <h3>{question.label} <small>{question.type}</small></h3><p>{question.instructions}</p>
            <div className="answer-detail-models">
              {[d1Result, terraResult].map((result, index) => {
                const answer = result?.answers?.[question.id];
                const probabilities = answer?.probabilities || (answer && question.type === "noul" ? { Yes: answer.value, No: 1 - answer.value } : {});
                return <div key={index}>
                  <strong>{index === 0 ? "Decision-1" : comparisonModelName}</strong>
                  <p>{answer?.label || "No answer"} · {answer?.detail}</p>
                  {outTab === "probs" ? Object.entries(probabilities).map(([label, value]) => <div className="probability-row" key={label}><span>{label}</span><meter min={0} max={1} value={value} /><span>{(value * 100).toFixed(1)}%</span></div>) :
                    answer && <meter className="answer-meter" min={0} max={1} value={Math.max(0, Math.min(1, answer.value))} />}
                </div>;
              })}
            </div>
          </section>)}
          {outTab === "api" && <>
            {activeSample.codeRule && <><h3>Application gate rule</h3><pre className="code">{activeSample.codeRule}</pre></>}
            <div className="pane-heading"><h3>Entra ID request</h3><button className="ghost" onClick={() => navigator.clipboard?.writeText(curl)}>Copy cURL</button></div>
            <pre className="code">{curl}</pre>
            <h3>Decision-1 response</h3><pre className="code">{JSON.stringify(d1Result, null, 2)}</pre>
            <h3>{comparisonModelName} response</h3><pre className="code">{JSON.stringify(terraResult, null, 2)}</pre>
          </>}
        </div>
      </Dialog>

      <Dialog open={schemaModalOpen} onClose={() => setSchemaModalOpen(false)} title="Edit input and questions">
        <div className="modal-head"><h2>Edit input &amp; questions</h2><button className="ghost" onClick={() => setSchemaModalOpen(false)}>Done &times;</button></div>
        <div className="modal-body editor-body">
          <p className="detail-note">Changes are staged for your next comparison. Editing removes built-in expected labels; create a custom solution to define your own ground truth.</p>
          <label htmlFor="comparison-input">Input document</label>
          <textarea id="comparison-input" value={stateText} onChange={(event) => { setStateText(event.target.value); markEdited(); }} />
          <h3>Questions ({questions.length})</h3>
          {questions.map((question) => <div className="editor-question" key={question.id}><div><strong>{question.label}</strong><small>{question.type} · {question.instructions}</small></div><button className="text-button" onClick={() => { setQuestions((previous) => previous.filter((q) => q.id !== question.id)); markEdited(); }}>Remove</button></div>)}
          <h3>Add a question</h3>
          <label htmlFor="question-label">Label</label><input id="question-label" type="text" value={newKey} onChange={(event) => setNewKey(event.target.value)} />
          <CustomSelect label="Question type" value={newType} onChange={(value) => setNewType(value as QuestionType)} searchable={false} minWidth={0} options={[{ value: "noul", label: "Yes / no (Noul)" }, { value: "choice", label: "Routing (Choice)" }, { value: "score", label: "Rubric (Score)" }]} />
          <label htmlFor="question-instructions">Instructions</label><input id="question-instructions" type="text" value={newInst} onChange={(event) => setNewInst(event.target.value)} />
          {newType !== "noul" && <><label htmlFor="question-criteria">{newType === "choice" ? "Options (key: description, …)" : "Ordered levels (Low, Medium, High, …)"}</label><input id="question-criteria" type="text" value={newCriteriaText} onChange={(event) => setNewCriteriaText(event.target.value)} /></>}
          <button className="ghost" onClick={addQuestion} disabled={!newInst.trim()}>Add question</button>
          <button className="primary" onClick={() => setSchemaModalOpen(false)}>Use this input</button>
        </div>
      </Dialog>
    </main>
  );
}
