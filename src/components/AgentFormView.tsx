"use client";

import React, { useEffect, useRef, useState } from "react";
import { CLAIM_CASES, CLAIM_POLICY, CLAIM_QUESTIONS, claimRequest, type ClaimField, type ClaimOutcome } from "@/lib/claims";
import { computeCorrectnessSummary, type StudioSample } from "@/lib/demo-data";
import { prioritizeQuestions } from "@/lib/comparison-evidence";
import type { DecisionRunResult } from "@/lib/foundry";
import { ComparisonProof } from "./ComparisonProof";

interface Props {
  sendWs: (action: string, payload?: Record<string, any>) => boolean;
  subscribeWs: (handler: (msg: { event: string; data: any; ts: number }) => void) => () => void;
  wsConnected: boolean;
  replayMode?: boolean;
  decisionModelName?: string;
  comparisonModelName?: string;
}

export default function AgentFormView({
  sendWs, subscribeWs, wsConnected, replayMode = false,
  decisionModelName = "Decision-1.1", comparisonModelName = "gpt-6.1-terra",
}: Props) {
  const [caseId, setCaseId] = useState(CLAIM_CASES[0].id);
  const example = CLAIM_CASES.find((item) => item.id === caseId)!;
  const [content, setContent] = useState(example.content);
  const [running, setRunning] = useState(false);
  const [decision, setDecision] = useState<DecisionRunResult | null>(null);
  const [baseline, setBaseline] = useState<DecisionRunResult | null>(null);
  const [fields, setFields] = useState<ClaimField[]>([]);
  const [extractionError, setExtractionError] = useState("");
  const [extractionMs, setExtractionMs] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<ClaimOutcome | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const activeRun = useRef<string | null>(null);
  const isFixture = content === example.content;
  const expected = isFixture ? example.expected : undefined;
  const summary = computeCorrectnessSummary(CLAIM_QUESTIONS, expected, decision?.ok ? decision.answers : undefined, baseline?.ok ? baseline.answers : undefined);
  const proofSample: StudioSample = {
    id: "claims-policy", label: "Claims policy gates", industry: "Insurance & Claims", origin: "industry",
    category: "Processing policy", description: "Same-input policy checks; extraction is a separate stage.",
    content, questions: CLAIM_QUESTIONS, codeRule: "applyVerifiedProcessingPolicy();",
  };

  const reset = () => {
    activeRun.current = null;
    setDecision(null); setBaseline(null); setFields([]); setOutcome(null);
    setExtractionError(""); setExtractionMs(null); setTotalMs(null); setNotice(""); setFocused(null);
  };
  useEffect(() => subscribeWs(({ event, data }) => {
    if (!activeRun.current) return;
    if (event === "error") {
      setNotice(data.message || "Request failed."); setRunning(false); activeRun.current = null;
      return;
    }
    if (data.runId !== activeRun.current) return;
    if (event === "claim_gate_result") {
      if (data.tier === "decision1") setDecision(data.result);
      else if (data.tier === "terra") setBaseline(data.result);
    } else if (event === "claim_extraction_result") {
      setFields(data.fields || []); setExtractionError(data.error || ""); setExtractionMs(data.latency_ms);
    } else if (event === "agent_done") {
      setRunning(false); activeRun.current = null;
      if (data.cancelled) {
        setOutcome(null); setNotice("Run cancelled. No final processing decision."); return;
      }
      setOutcome(data.outcome || null); setTotalMs(data.elapsed_ms);
      if (data.comparisonFailed) setNotice("The comparison request failed. Its absence is not evidence of a model win.");
      if (data.error) setNotice(data.error);
    }
  }), [subscribeWs]);
  useEffect(() => {
    if (!wsConnected && activeRun.current) {
      activeRun.current = null; setRunning(false); setOutcome(null); setNotice("Connection unavailable. No final processing decision.");
    }
  }, [wsConnected]);

  const run = () => {
    reset();
    const runId = crypto.randomUUID();
    activeRun.current = runId;
    setRunning(true);
    if (!sendWs("run_agent_form", claimRequest(content, isFixture ? caseId : "edited", runId))) {
      activeRun.current = null; setRunning(false); setNotice("No recording or connection matches this request.");
    }
  };
  const focusedField = fields.find((field) => field.name === focused && field.start >= 0);
  const verdict = (result: DecisionRunResult | null, id: string, matches: boolean) => {
    if (result && !result.ok) return <span className="claims-answer fail">Request failed</span>;
    if (!result) return <span className="claims-answer">{running ? "Waiting..." : "Not run"}</span>;
    const answer = result.answers[id];
    return <span className={`claims-answer ${expected ? matches ? "match" : "fail" : ""}`}>
      <b>{answer?.key ?? answer?.label ?? "No answer"}</b>
      <small>{expected ? matches ? "Matches reference" : "Reference mismatch" : "Not scored"}
        {answer ? ` · model confidence ${Math.round(answer.confidence * 100)}%` : ""}</small>
    </span>;
  };

  return <main className="claims-view">
    <header className="claims-heading">
      <div><span className="eyebrow">Evidence-first claims intake</span><h1>Which model makes the right processing decision?</h1>
        <p>Compare identical policy checks side by side. Then inspect source-backed fields and the application&apos;s safe next action.</p></div>
      <button className="claims-run" disabled={!wsConnected || running || !content.trim() || (replayMode && !isFixture)} onClick={run}>
        {running ? "Processing..." : replayMode ? "Replay this claim" : "Compare this claim"}
      </button>
    </header>
    <div className="claims-input-grid">
      <section className="claims-card">
        <label htmlFor="claim-case">Synthetic policy cases</label>
        <select id="claim-case" value={caseId} disabled={running} onChange={(event) => {
          reset(); setCaseId(event.target.value); setContent(CLAIM_CASES.find((item) => item.id === event.target.value)!.content);
        }}>{CLAIM_CASES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        <label htmlFor="claim-email">Customer email {isFixture ? "(reference available)" : "(edited; no reference score)"}</label>
        <textarea id="claim-email" value={content} disabled={running} onChange={(event) => { reset(); setContent(event.target.value); }} />
        {replayMode && !isFixture && <p role="status">Edited input requires live mode. Replay does not invent new model responses.</p>}
      </section>
      <section className="claims-card claims-policy">
        <span className="eyebrow">Reference policy, defined before model calls</span><h2>Candidate ≠ approval</h2>
        <p>Repair estimate <b>strictly below GBP 5,000</b>, explicit <b>no injury</b>, clear <b>third-party fault</b>, and a supplied police reference.</p>
        <p>Missing police reference → request documents. Injury, high estimate, unknown facts or unclear fault → adjuster. Exactly GBP 5,000 → adjuster.</p>
        <p>Service failure or inconsistent evidence never authorizes automated processing. Missing customer information is not itself a model error.</p>
        <details><summary>Complete demonstration policy</summary><p>{CLAIM_POLICY}</p></details>
      </section>
    </div>
    {notice && <p className="claims-notice" role="status">{notice}</p>}
    <section aria-label="Policy model comparison">
      <h2>1. Policy checks · both models, same email and rules</h2>
      <p className="claims-caption">Latency and cost below concern the gate requests only, not form extraction or the whole pipeline. Confidence is model-reported, not independently calibrated.</p>
      <ComparisonProof sample={proofSample} questions={CLAIM_QUESTIONS} state={content} expected={expected}
        decision={decision} baseline={baseline} decisionName={decisionModelName} baselineName={comparisonModelName}
        decisionError={decision && !decision.ok ? decision.error || "Policy request failed" : undefined}
        baselineError={baseline && !baseline.ok ? baseline.error || "Policy request failed" : undefined}
        running={running} replayMode={replayMode} />
      <div className="claims-table-scroll">
        <table className="claims-evidence"><caption>Reference mismatches and model disagreements appear first. Ties are shown honestly.</caption>
          <thead><tr><th>Policy check</th><th>Reference / source evidence</th><th>{decisionModelName}</th><th>{comparisonModelName}</th></tr></thead>
          <tbody>{prioritizeQuestions(CLAIM_QUESTIONS, expected, decision, baseline).map((question) => {
            const row = summary.rows.find((item) => item.questionId === question.id)!;
            const mismatch = expected && ((decision?.ok && !row.d1Match) || (baseline?.ok && !row.terraMatch));
            return <tr key={question.id} className={mismatch ? "claims-mismatch" : ""}>
              <th>{question.label}<small>{decision?.ok && baseline?.ok ? row.modelsAgree ? "Models agree" : "Models disagree" : "Awaiting paired evidence"}</small></th>
              <td>{expected ? <><b>{expected[question.id]}</b>{example.evidence[question.id].map((quote) => <q key={quote}>{quote}</q>)}</> : "No reference for edited input"}</td>
              <td>{verdict(decision, question.id, row.d1Match)}</td><td>{verdict(baseline, question.id, row.terraMatch)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
    <div className="claims-results-grid">
      <section className="claims-card">
        <h2>2. Source-backed form</h2><p className="claims-caption">Extracted by {comparisonModelName}, not by {decisionModelName}.
          {extractionMs !== null && ` Extraction request: ${extractionMs} ms.`} Select a field to inspect its quote.</p>
        {extractionError ? <p className="claims-notice" role="alert">Extraction failed: {extractionError}. This is a service/output failure, not evidence that the customer omitted every field.</p>
          : fields.length ? <div className="claims-fields">{[...fields].sort((a, b) => Number(a.status === "filled") - Number(b.status === "filled")).map((field) =>
            <button key={field.name} className={`claims-field ${field.status}`} onClick={() => setFocused(field.name)} aria-pressed={focused === field.name}>
              <span>{field.label}<small>{field.status === "missing" ? "Not supplied" : field.status === "review" ? "Verify source / value" : "Source-backed"}</small></span>
              <b>{field.value || "Not supplied"}</b>
            </button>)}</div> : <p>{running ? "Extracting fields..." : "Run a claim to inspect extracted values."}</p>}
        {focused && <div className="claims-source"><h3>Source evidence</h3>{focusedField
          ? <pre>{content.slice(0, focusedField.start)}<mark>{content.slice(focusedField.start, focusedField.end)}</mark>{content.slice(focusedField.end)}</pre>
          : <p>No verified source quote. Human review is required.</p>}</div>}
      </section>
      <section className={`claims-card claims-outcome ${outcome?.status || ""}`} aria-live="polite">
        <span className="eyebrow">Application rules, not a third model</span><h2>3. Safe next action</h2>
        {outcome ? <><h3>{outcome.title}</h3><p>{outcome.reason}</p><p className="claims-caption">Uses {decisionModelName} policy facts plus extraction validation.
          The comparison model&apos;s policy answer is evidence, not an authorization override.
          {totalMs !== null && ` Whole demonstration pipeline: ${totalMs} ms.`}</p>
          <h3>Customer reply draft</h3><blockquote>{outcome.reply}</blockquote>
          <p className="claims-caption">Draft only. Not sent. No coverage decision, payment authorization or fabricated customer details.</p></>
          : <p>{running ? "Waiting for policy facts and extraction checks. No processing authorized yet." : "No claim processed. No approval implied."}</p>}
      </section>
    </div>
  </main>;
}
