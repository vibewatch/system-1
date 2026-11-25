"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Download, Pencil, X } from "lucide-react";
import { CLAIM_CASES, CLAIM_FIELDS, CLAIM_POLICY, CLAIM_QUESTIONS, claimRequest, type ClaimField, type ClaimOutcome } from "@/lib/claims";
import { claimAnswerLabel, claimSourceLinks, claimSourceSegments } from "@/lib/claim-evidence";
import { computeCorrectnessSummary, computeUseCaseEconomics } from "@/lib/demo-data";
import { compareLatency, prioritizeQuestions } from "@/lib/comparison-evidence";
import { redactTraceValue } from "@/lib/replay";
import type { DecisionRunResult } from "@/lib/foundry";
import { CustomSelect } from "./CustomSelect";
import { IconButton } from "./IconButton";
import { Tooltip } from "./Tooltip";

interface Props {
  sendWs: (action: string, payload?: Record<string, any>) => boolean;
  subscribeWs: (handler: (msg: { event: string; data: any; ts: number }) => void) => () => void;
  wsConnected: boolean;
  replayMode?: boolean;
  decisionModelName?: string;
  comparisonModelName?: string;
}

const gateLabels: Record<string, string> = {
  claim_route: "Processing route", repair_band: "Repair estimate", injury_status: "Injury",
  liability: "Fault", police_reference: "Police reference",
};

function ClaimDisclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className={`claim-disclosure ${open ? "open" : ""}`}>
    <button className="claim-disclosure-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <ChevronRight size={13} aria-hidden="true" />{label}
    </button>
    <div id={id} className="claim-disclosure-panel" hidden={!open}>{open && children}</div>
  </div>;
}

export default function AgentFormView({
  sendWs, subscribeWs, wsConnected, replayMode = false,
  decisionModelName = "Decision-1.1", comparisonModelName = "gpt-6.1-terra",
}: Props) {
  const [caseId, setCaseId] = useState(CLAIM_CASES[0].id);
  const example = CLAIM_CASES.find((item) => item.id === caseId)!;
  const [content, setContent] = useState(example.content);
  const [editing, setEditing] = useState(false);
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
  const root = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const isFixture = content === example.content;
  const expected = isFixture ? example.expected : undefined;
  const summary = computeCorrectnessSummary(CLAIM_QUESTIONS, expected, decision?.ok ? decision.answers : undefined, baseline?.ok ? baseline.answers : undefined);
  const latency = compareLatency(decision, baseline);
  const links = useMemo(() => claimSourceLinks(content, fields, isFixture ? example : undefined, Boolean(decision?.ok || baseline?.ok))
    .map((link) => ({ ...link, label: link.kind === "gate" ? gateLabels[link.id.slice(5)] : link.label })), [content, fields, isFixture, example, decision, baseline]);
  const segments = useMemo(() => claimSourceSegments(content, links), [content, links]);
  const selectedField = fields.find((field) => focused === `field:${field.name}`);
  const selectedGate = CLAIM_QUESTIONS.find((question) => focused === `gate:${question.id}`);
  const selectedLink = links.find((link) => link.id === focused);
  const related = selectedLink ? links.filter((link) => link.id !== focused && link.ranges.some((range) =>
    selectedLink.ranges.some((selected) => range.start < selected.end && range.end > selected.start))) : [];
  const paired = Boolean(decision?.ok && baseline?.ok);
  const economics = computeUseCaseEconomics({
    id: "claims-policy", content, questions: CLAIM_QUESTIONS,
  }, decision?.ok ? decision.usage : undefined, baseline?.ok ? baseline.usage : undefined);

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
      if (data.comparisonFailed) setNotice("Comparison request failed. No paired winner.");
      if (data.error) setNotice(data.error);
    }
  }), [subscribeWs]);
  useEffect(() => {
    if (!wsConnected && activeRun.current) {
      activeRun.current = null; setRunning(false); setOutcome(null); setNotice("Connection unavailable. No final processing decision.");
    }
  }, [wsConnected]);

  const run = () => {
    reset(); setEditing(false);
    const runId = crypto.randomUUID();
    activeRun.current = runId;
    setRunning(true);
    if (!sendWs("run_agent_form", claimRequest(content, isFixture ? caseId : "edited", runId))) {
      activeRun.current = null; setRunning(false); setNotice("No recording or connection matches this request.");
    }
  };
  const focusLink = (id: string, from: "source" | "result" = "result") => {
    setFocused(id);
    requestAnimationFrame(() => {
      const target = from === "source"
        ? Array.from(root.current?.querySelectorAll<HTMLElement>("[data-target-link]") || []).find((node) => node.dataset.targetLink === id)
        : Array.from(source.current?.querySelectorAll<HTMLElement>("[data-source-links]") || []).find((node) => node.dataset.sourceLinks?.split(" ").includes(id));
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };
  const runData = () => redactTraceValue({ caseId: isFixture ? caseId : "edited", content, policy: CLAIM_POLICY,
    decision, baseline, fields, extractionError, extractionMs, outcome, totalMs, mode: replayMode ? "replay" : "live" });
  const exportRun = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(runData(), null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `claim-${caseId}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const verdict = (result: DecisionRunResult | null, id: string, matches: boolean) => {
    const answer = result?.ok ? result.answers[id] : undefined;
    const failed = result && !result.ok;
    const status = failed ? "Failed" : !result ? running ? "Waiting" : "Not run" : claimAnswerLabel(answer?.key ?? answer?.label);
    const mismatch = Boolean(expected && result?.ok && !matches);
    return <Tooltip content={<>{failed ? result.error || "Request failed" : `${expected ? `Reference: ${claimAnswerLabel(expected[id])}. ${matches ? "Match" : result ? "Mismatch" : "Not evaluated"}. ` : "No reference for edited input. "}${answer ? `Model confidence: ${Math.round(answer.confidence * 100)}% (not calibrated).` : ""}`}</>}>
      <button className={`claim-answer ${failed || mismatch ? "fail" : expected && result?.ok ? "match" : ""}`}
        aria-label={`${result?.model || "Model"}: ${gateLabels[id]}, ${status}${mismatch ? ", reference mismatch" : ""}`}
        aria-pressed={focused === `gate:${id}`} onClick={() => focusLink(`gate:${id}`)}>
        {failed || mismatch ? <X size={12} aria-hidden="true" /> : expected && result?.ok ? <Check size={12} aria-hidden="true" /> : null}
        <span>{status}</span>
      </button>
    </Tooltip>;
  };

  return <div className="claim-workspace" ref={root}>
    <header className="hero-banner claim-toolbar">
      <div><span className="eyebrow">04 · CLAIMS INTAKE</span><h1>One email. <strong>Decisions, fields, next action.</strong></h1></div>
      <div className="claim-controls">
        <CustomSelect value={caseId} minWidth={0} disabled={running}
          options={CLAIM_CASES.map((item) => ({ value: item.id, label: item.label }))}
          onChange={(id) => { reset(); setEditing(false); setCaseId(id); setContent(CLAIM_CASES.find((item) => item.id === id)!.content); }} />
        <button className="primary claim-run" disabled={!wsConnected || running || !content.trim() || (replayMode && !isFixture)} onClick={run}>
          {running ? "Processing..." : replayMode ? "Replay claim" : "Run claim"}
        </button>
      </div>
    </header>
    <main className="layout split-5-7 claim-workbench">
      {notice && <p className="claim-notice" role="status">{notice}</p>}
      <section className="card claim-source-card">
        <div className="card-head"><span className="eyebrow">01 · SOURCE EMAIL <span className="hint">{isFixture ? "Synthetic case" : "Edited input"}</span></span>
          <IconButton label={editing ? "Show highlighted email" : "Edit raw email"} icon={<Pencil size={14} />} tag={editing ? "View" : "Edit"}
            disabled={running} onClick={() => setEditing(!editing)} />
        </div>
        {editing ? <textarea id="claim-email" className="claim-editor" aria-label="Customer email" value={content} disabled={running}
          onChange={(event) => { reset(); setContent(event.target.value); }} />
          : <div className={`claim-email ${focused ? "has-focus" : ""}`} ref={source} aria-label="Source email with linked evidence">
            {segments.map((segment) => {
              const candidates = links.filter((link) => segment.linkIds.includes(link.id));
              const primary = candidates.find((link) => link.id === focused)
                || candidates.find((link) => link.kind === "gate" && link.id !== "gate:claim_route" && link.review)
                || candidates.find((link) => link.kind === "field")
                || candidates.find((link) => link.id !== "gate:claim_route") || candidates[0];
              if (!primary) return <React.Fragment key={segment.start}>{segment.text}</React.Fragment>;
              return <Tooltip key={segment.start} content={`${primary.label} · ${primary.kind === "field" ? `extracted by ${comparisonModelName}` : "reference policy evidence"}${primary.review ? " · needs attention" : ""}`}>
                <mark className={`claim-mark ${primary.kind} ${primary.review ? "review" : ""} ${segment.linkIds.includes(focused || "") ? "is-linked" : ""}`}
                  data-source-links={segment.linkIds.join(" ")} role="button" tabIndex={0}
                  aria-label={`Locate ${primary.label}: ${segment.text}`} aria-pressed={segment.linkIds.includes(focused || "")}
                  onClick={() => focusLink(primary.id, "source")} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusLink(primary.id, "source"); }
                    if (event.key === "Escape") setFocused(null);
                  }}>{segment.text}</mark>
              </Tooltip>;
            })}
          </div>}
        {!isFixture && <p className="claim-notice">{replayMode ? "Edited email requires live mode." : "Edited email: no reference score or preset policy highlights."}</p>}
        <div className="claim-source-caption"><span><i className="claim-legend field" /> Extracted fields</span><span><i className="claim-legend review" /> Policy / review</span>
          <span>Click to link evidence</span></div>
        <div className="claim-inspector" aria-live="polite">
          {focused ? <>
            <div><b>{selectedField?.label || selectedGate?.label}</b>
              <IconButton label="Clear evidence focus" icon={<X size={12} />} onClick={() => setFocused(null)} /></div>
            {selectedField ? <p>{selectedField.status === "missing" ? "Not supplied. No source span exists."
              : selectedLink ? `${comparisonModelName} extraction · ${Math.round(selectedField.confidence * 100)}% model confidence${selectedField.status === "review" ? " · verify value" : ""}`
                : "No verified source quote. Check this value manually."}</p>
              : <p>{expected && selectedGate ? `Reference: ${claimAnswerLabel(expected[selectedGate.id])}. Highlighted quotes are fixture evidence, not a model-generated explanation.`
                : "No verified policy source span for edited input."}</p>}
            {related.length > 0 && <div className="claim-related">{related.map((link) =>
              <button className="ghost" key={link.id} onClick={() => focusLink(link.id)}>{link.label}<ChevronRight size={11} /></button>)}</div>}
          </> : <p>Select a highlighted phrase, policy check or form field. The same evidence stays in this email.</p>}
        </div>
        <div className="claim-details"><ClaimDisclosure label="Policy & run details">
          <p>{CLAIM_POLICY}</p>
          <p>Identical email and questions; deployments and network conditions may differ. Gate latency excludes extraction. Confidence is not validated accuracy.</p>
          {paired && <p>Estimated cost / 1,000 gate calls: {decisionModelName} ${economics.d1CostPer1kUsd.toFixed(4)} · {comparisonModelName} ${economics.terraCostPer1kUsd.toFixed(4)}.
            Recorded usage × assumed rates, not an Azure bill. Verify deployment prices.</p>}
          <IconButton label="Export claim run JSON" icon={<Download size={14} />} tag="Run JSON" disabled={!decision && !baseline && !fields.length} onClick={exportRun} />
          <p>Export includes the email. Review before sharing. Raw extraction HTTP traces remain in the backend/browser trace store.</p>
          <ClaimDisclosure label="Responses and field evidence"><pre>{JSON.stringify(runData(), null, 2)}</pre></ClaimDisclosure>
        </ClaimDisclosure></div>
      </section>

      <section className="card claim-result-card">
        <div className="card-head"><span className="eyebrow">02 · POLICY CHECKS</span><span className="hint">Same email · same rules</span></div>
        <div className="claim-models" aria-live="polite">{[
          { name: decisionModelName, result: decision, tone: "d1", correct: summary.d1Correct },
          { name: comparisonModelName, result: baseline, tone: "terra", correct: summary.terraCorrect },
        ].map((model) => <div className={`claim-model ${model.tone}`} key={model.tone}>
          <b>{model.name}</b><strong>{model.result ? model.result.ok ? `${model.result.latency_ms} ms` : "Failed" : running ? "Evaluating..." : "Not run"}</strong>
          <small>{model.result?.ok ? `Gate ready${expected ? ` · ${model.correct}/${summary.totalQuestions} reference matches` : " · unscored"}` : model.result ? "Request unavailable" : "Policy request"}</small>
        </div>)}</div>
        <div className="claim-pair-summary" aria-live="polite">
          <span>{latency ? latency.winner === "tie" ? "Same gate latency" : `${latency.winner === "baseline" ? comparisonModelName : decisionModelName} ${latency.multiplier.toFixed(1)}× faster · gates only`
            : decision && !decision.ok || baseline && !baseline.ok ? "Request failure · no paired winner" : running ? "Waiting for both gate results" : "Run to compare"}</span>
          <b>{paired && expected ? summary.d1Correct === summary.terraCorrect ? "Reference match tied"
            : `${summary.d1Correct > summary.terraCorrect ? decisionModelName : comparisonModelName} matches more references` : !expected ? "No reference" : ""}</b>
        </div>
        <table className="claim-gates" aria-label="Paired policy decisions">
          <thead><tr><th>Check / source</th><th>{decisionModelName}</th><th>{comparisonModelName}</th></tr></thead>
          <tbody>{prioritizeQuestions(CLAIM_QUESTIONS, expected, decision, baseline).map((question) => {
            const row = summary.rows.find((item) => item.questionId === question.id)!;
            const mismatch = expected && ((decision?.ok && !row.d1Match) || (baseline?.ok && !row.terraMatch));
            const disagreement = paired && !row.modelsAgree;
            return <tr key={question.id} className={`${focused === `gate:${question.id}` ? "is-linked" : ""} ${mismatch ? "mismatch" : ""}`}>
              <th><button className="claim-gate-link" data-target-link={`gate:${question.id}`} aria-pressed={focused === `gate:${question.id}`}
                onClick={() => focusLink(`gate:${question.id}`)}>{gateLabels[question.id]}{mismatch || disagreement ? <small>{mismatch ? "Reference mismatch" : "Models disagree"}</small> : null}</button></th>
              <td>{verdict(decision, question.id, row.d1Match)}</td><td>{verdict(baseline, question.id, row.terraMatch)}</td>
            </tr>;
          })}</tbody>
        </table>
        <div className="card-head sub"><span className="eyebrow">03 · AUTO-FILLED FORM</span>
          <span className="hint">{comparisonModelName} extraction{extractionMs !== null ? ` · ${extractionMs} ms` : ""}</span></div>
        <div className="claim-field-status" aria-live="polite">{extractionError ? "Extraction failed · not missing customer data"
          : fields.length ? `${fields.filter((field) => field.status === "filled").length}/${CLAIM_FIELDS.length} source-backed · ${fields.filter((field) => field.status === "review").length} review · ${fields.filter((field) => field.status === "missing").length} missing`
            : running ? "Extracting fields..." : "Awaiting extraction"}</div>
        {extractionError ? <p className="claim-notice" role="alert">{extractionError}. No fields were inferred from this failure.</p>
          : <div className="claim-fields">{[...CLAIM_FIELDS].sort((a, b) => {
            const rank = (name: string) => { const field = fields.find((item) => item.name === name); return field && field.status !== "filled" ? 0 : 1; };
            return rank(a.name) - rank(b.name);
          }).map((spec) => {
            const field = fields.find((item) => item.name === spec.name);
            return <Tooltip key={spec.name} content={field ? `${field.label}: ${field.value || "Not supplied"}. ${field.status === "filled" ? "Source-backed" : field.status === "missing" ? "Not supplied" : "Verify source/value"}. Click to locate the email evidence.` : "Awaiting extraction; not classified as missing."}>
              <button className={`claim-field ${field?.status || "pending"} ${focused === `field:${spec.name}` ? "is-linked" : ""}`}
                data-target-link={`field:${spec.name}`} disabled={!field} aria-pressed={focused === `field:${spec.name}`}
                onClick={() => focusLink(`field:${spec.name}`)}>
                <span>{spec.label}</span><b>{field ? field.value || "Not supplied" : "—"}</b>
              </button>
            </Tooltip>;
          })}</div>}
      </section>
      <section className={`claim-action-bar ${outcome?.status || ""}`} aria-label="Safe next action" aria-live="polite">
        <div><span className="eyebrow">NEXT ACTION</span><h2>{outcome?.title || (running ? "Checking evidence..." : "No claim processed")}</h2></div>
        <div className="claim-action-note">Candidate ≠ approval{totalMs !== null && ` · Pipeline ${totalMs} ms`}
          {!outcome && running && <span>No processing authorized yet</span>}</div>
        {outcome && <ClaimDisclosure label="Reason & reply draft"><p>{outcome.reason}</p><blockquote>{outcome.reply}</blockquote>
          <small>Uses Decision policy facts plus extraction validation. Draft only; not sent. No coverage or payment authorized.</small></ClaimDisclosure>}
      </section>
    </main>
  </div>;
}
