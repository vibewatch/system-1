"use client";

import React from "react";
import { CustomSelect } from "./CustomSelect";
import { RUNTIME_SCENARIOS, type DecisionQuestion, type RuntimeScenario } from "@/lib/demo-data";
import { storyAction, type NavigationProgress } from "@/lib/decision-story";
import type { NormalizedDecision } from "@/lib/foundry";
import { DecisionScene } from "./DecisionScene";

export interface StoryCheckpoint {
  index: number;
  latencyMs: number;
  answers: Record<string, NormalizedDecision>;
  title?: string;
}

interface Props {
  scenario: RuntimeScenario;
  questions: DecisionQuestion[];
  transcript: string;
  stageIndex: number;
  phase: "idle" | "receiving" | "evaluating" | "decided" | "stopped";
  modelInput: string;
  answers: Record<string, NormalizedDecision>;
  baselineAnswers: Record<string, NormalizedDecision>;
  latencyMs: number;
  baselineLatencyMs: number;
  calls: number;
  checkpoints: StoryCheckpoint[];
  running: boolean;
  complete: boolean;
  error: string;
  replayMode: boolean;
  replayLoading: boolean;
  ready: boolean;
  comparisonModelName: string;
  navigationProgress: NavigationProgress | null;
  onSelect: (id: string) => void;
  onRun: () => void;
  onReplay: (id: string) => void;
  onVerify: (sampleId: string) => void;
  onTriage: () => void;
}

function label(question: DecisionQuestion, answer?: NormalizedDecision) {
  if (!answer) return "Awaiting response";
  if (question.type === "score" && Array.isArray(question.criteria) && typeof answer.key === "number") {
    return question.criteria[answer.key] || answer.label;
  }
  return answer.label;
}

export function DecisionStoryView({
  scenario, questions, transcript, stageIndex, phase, modelInput, answers,
  baselineAnswers, latencyMs, baselineLatencyMs, calls, checkpoints, running,
  complete, error, replayMode, replayLoading, ready, comparisonModelName,
  onSelect, onRun, onReplay, onVerify, onTriage,
  navigationProgress,
}: Props) {
  const story = scenario.story!;
  const nodeLabel = (id?: string) => scenario.navigation?.nodes.find((item) => item.id === id)?.label || id || "Graph state";
  const stages = scenario.stages || Array.from({ length: Math.min(scenario.navigation!.maxSteps, Math.max(1, stageIndex + 1, checkpoints.length)) }, (_, step) => ({
    title: nodeLabel(checkpoints.find((item) => item.index === step)?.title || navigationProgress?.lastEvaluated || scenario.navigation!.start),
    text: modelInput || `Start at ${nodeLabel(scenario.navigation!.start)}; target ${nodeLabel(scenario.navigation!.target)}.`,
    change: "Only a supported, sufficiently probable legal model choice advances the graph. Detours are retained; loops stop for review.",
  }));
  const index = Math.min(stages.length - 1, Math.max(0, stageIndex));
  const stage = stages[index];
  const prefixLength = stages.slice(0, index).reduce((sum, item) => sum + item.text.length + 2, 0);
  const currentText = scenario.navigation ? stage.text : phase === "idle" ? stage.text : transcript.slice(prefixLength);
  const action = navigationProgress?.status === "review"
    ? { label: "Stop for guidance", detail: navigationProgress.reason || "The graph run needs review.", tone: "review" as const }
    : navigationProgress?.status === "reached"
    ? { label: `Reached ${nodeLabel(navigationProgress.target)}`, detail: "The app followed actual Decision-1 selections along legal graph edges. No hidden path search selected the route.", tone: "allow" as const }
    : storyAction(scenario, answers);
  const hasResponse = Object.keys(answers).length > 0;
  const status = error ? "Model check interrupted" : phase === "stopped" ? "Stopped · no further checks" : phase === "evaluating"
    ? replayMode ? "Replaying the inference request" : "Evaluating the current input"
    : phase === "receiving" ? "Receiving the next input"
    : phase === "decided" ? replayMode ? "Recorded response returned" : "Response returned"
    : "Ready for a decision";

  return (
    <div className="runtime-workspace decision-story-workspace">
      <section className="story-hero">
        <div>
          <p className="section-label">A Microsoft-Decision-1 demonstration · {story.title}</p>
          <h1>See Decision-1 <span>make the next decision.</span></h1>
          <p>{scenario.description}</p>
        </div>
        <div className="story-launch">
          <div className="story-sun" aria-hidden="true"><span /></div>
          <button className="primary story-play" disabled={running || replayLoading} onClick={() => onReplay(scenario.id)}>
            {replayLoading ? "Loading recordings…" : "▶ Play recorded story"}
          </button>
          <span>Actual model responses · no sign-in for replay</span>
        </div>
      </section>

      <div className="story-catalog-bar">
        <span className="eyebrow">Explore all eight demos</span>
        <CustomSelect value={scenario.id} disabled={running} onChange={onSelect} searchable options={RUNTIME_SCENARIOS.map((item) => ({ value: item.id, label: item.label, description: item.description, category: item.origin === "industry" && item.story ? "Industry demonstrations" : "Original decision stories" }))} />
      </div>
      <nav className="featured-stories" aria-label="Representative Decision-1 demonstrations">
        {RUNTIME_SCENARIOS.filter((item) => ["warehouse-command", "adaptive-workspace", "semantic-navigation"].includes(item.id)).map((item, position) => (
          <button key={item.id} disabled={running} aria-pressed={scenario.id === item.id} onClick={() => onSelect(item.id)}>
            <span>0{position + 1} / {item.story!.visual === "warehouse" ? "Fleet incidents" : item.story!.visual === "adaptive" ? "Scored interface" : "Legal link selection"}</span>
            <strong>{item.story!.title}</strong>
          </button>
        ))}
      </nav>

      <div className="story-workflow-bar">
        <span><b>1</b> {scenario.navigation ? "Current graph state" : "Scripted input"}</span><i aria-hidden="true">→</i>
        <span><b>2</b> Microsoft-Decision-1 inference</span><i aria-hidden="true">→</i>
        <span><b>3</b> Suggested application action</span>
      </div>

      <main className="decision-pipeline">
        <section className="card pipeline-input">
          <div className="pipeline-card-heading"><span className="eyebrow">1 / THE INPUT CHANGES</span><span className="source-badge">{scenario.navigation ? "Graph sandbox" : "Scripted sandbox"}</span></div>
          <h2>{stage.title}</h2>
          <p className="checkpoint-change">{stage.change}</p>
          <ol className="checkpoint-progress" aria-label="Script checkpoints">
            {stages.map((item, itemIndex) => <li key={item.title} aria-current={stageIndex === itemIndex ? "step" : undefined} className={itemIndex === stageIndex ? "current" : itemIndex < stageIndex ? "complete" : ""}><span>{itemIndex + 1}</span>{item.title}</li>)}
          </ol>
          <DecisionScene scenario={scenario} index={index} answers={answers} navigationProgress={navigationProgress} />
          <div className="current-input">
            <span className="eyebrow">{phase === "idle" ? "PREVIEW · NOT MODEL OUTPUT" : scenario.navigation ? "CURRENT GRAPH STATE" : "CURRENT CHECKPOINT TEXT"}</span>
            <p>{currentText || "The next input is arriving…"}</p>
          </div>
          <details className="runtime-extra"><summary>Inspect the exact model input</summary><pre className="story-raw">{modelInput || "No model request has been made for this checkpoint."}</pre></details>
          {scenario.inputScope === "checkpoint" && <details className="runtime-extra"><summary>Narration history · not sent to the model</summary><pre className="story-raw">{transcript || "No narration has played yet."}</pre></details>}
          <div className="pipeline-run-controls">
            <button className="ghost runtime-live-check" onClick={onRun} disabled={!ready} title={!ready ? "Configure Azure through Options → Connection settings" : undefined}>
              {running ? "■ Stop" : replayMode ? "▶ Replay this story" : "▶ Run live checks"}
            </button>
          </div>
          {error && <p role="alert" className="comparison-error">{error}</p>}
        </section>

        <section className={`card pipeline-model ${phase}`} aria-label="Microsoft-Decision-1 model work">
          <div className="pipeline-card-heading"><span className="source-badge">{replayMode ? "Recorded model work" : "Live model work"}</span><span className={`inference-dot ${phase}`} aria-hidden="true" /></div>
          <h2>Microsoft-Decision-1</h2>
          <p>{story.modelJob}</p>
          {scenario.inputScope === "checkpoint" && <p className="input-scope-note">Live checks send only the current checkpoint. Task rules stay in the question schema; recordings expose their captured input.</p>}
          <div className="inference-status" role="status">
            <strong>{status}</strong>
            <span>{phase === "evaluating" ? `${modelInput.length.toLocaleString()} input characters · ${questions.length} questions in one request`
              : hasResponse ? `${Object.keys(answers).length}/${questions.length} structured answers · ${latencyMs} ms for this call`
              : `${questions.length} configured questions · no response shown before inference`}</span>
          </div>
          <div className="decision-output" aria-label="Structured answers returned by Decision-1">
            {questions.map((question) => {
              const answer = answers[question.id];
              return <div key={question.id} data-question={question.id} className={`decision-output-row ${answer ? "returned" : "pending"}`}>
                <div><span>{question.label}</span><small>{question.type === "noul" ? "Boolean" : question.type === "choice" ? "Choice" : "Score"}</small></div>
                <strong>{question.id === "next_action" && answer ? story.actions[String(answer.key)]?.label || answer.label : label(question, answer)}</strong>
                {answer && <div className="returned-measure">
                  <span>{question.type === "score" ? answer.detail : question.type === "noul" ? `${Math.round(answer.value * 100)}% yes` : `${Math.round(answer.value * 100)}% choice probability`}</span>
                  <meter min={0} max={1} value={answer.value} aria-label={`${question.label} normalized value`} />
                </div>}
              </div>;
            })}
          </div>
          <p className="model-role-note">Decision-1 returns typed decisions. It does not write this script, generate a rationale, or execute the action.</p>
          <details className="runtime-extra"><summary>Inspect actual Decision-1 response values</summary><pre className="story-raw">{hasResponse ? JSON.stringify(Object.fromEntries(Object.entries(answers).map(([key, answer]) => [key, answer.raw])), null, 2) : "No model response has arrived."}</pre></details>
        </section>

        <section className="card pipeline-action">
          <div className="pipeline-card-heading"><span className="eyebrow">3 / THE APPLICATION USES THE DECISION</span></div>
          <div className={`action-gate ${action?.tone || "waiting"}`} aria-live="polite">
            <span className="gate-kicker">Application policy suggestion · derived from Decision-1</span>
            <h2>{action?.label || "Waiting for Decision-1"}</h2>
            <p>{action?.detail || "A scripted input is not an approval. No action is suggested until the model returns."}</p>
            <span className="gate-tag">{action ? action.tone === "review" ? "HUMAN REVIEW" : action.tone.toUpperCase() : "NO DECISION YET"}</span>
          </div>
          <p className="action-sandbox-note">{story.actionNote}</p>
          <h3 className="checkpoint-results-heading">Observed Decision-1 calls</h3>
          <ol className="checkpoint-results">
            {stages.map((item, itemIndex) => {
              const result = checkpoints.find((checkpoint) => checkpoint.index === itemIndex);
              const resultAction = result && storyAction(scenario, result.answers);
              return <li key={item.title}><span>{itemIndex + 1}</span><div><strong>{item.title}</strong><p>{resultAction?.label || "Not evaluated yet"}</p>{result && <small>{result.latencyMs} ms · actual {replayMode ? "recorded" : "live"} response</small>}</div></li>;
            })}
          </ol>
          <p className="story-call-count">{calls} structured Decision-1 checks {replayMode ? "replayed" : "completed"}{complete ? " · story complete" : ""}</p>
          <button className="text-button verify-story" onClick={() => onVerify(story.sampleId)}>Verify against paired expected answers →</button>
          <details className="runtime-extra"><summary>How the action policy works</summary><p>{story.visual === "refund" ? "Allow requires approval probability ≥ 70%, redirect probability ≤ 30%, and the original-refund choice. Supported actions require at least 65% choice probability; otherwise request human review." : "Map a supported model choice to the displayed suggestion at ≥ 65% choice probability. Otherwise hold for human review."} {story.visual === "brands" && "An embedded-instruction probability ≥ 70% overrides the brand recommendation with editorial review. This guard can also produce false positives."} These are demonstration thresholds, not calibrated production safety guarantees. Choice probability is distinct from the provider's separate confidence field.</p></details>
        </section>
      </main>

      <details className="story-baseline">
        <summary>Optional model comparison · same input, separate responses</summary>
        <div className="baseline-comparison-header"><h2>{comparisonModelName} baseline</h2><p>{baselineLatencyMs ? `${baselineLatencyMs} ms for this checkpoint` : "No baseline response for the current checkpoint yet."} Both models are evaluated in parallel; opening this panel does not make another call. {scenario.navigation && "Graph steps wait for both responses; the total duration is not Decision-1-only throughput."}</p></div>
        <table><thead><tr><th>Question</th><th>Decision-1</th><th>{comparisonModelName}</th></tr></thead><tbody>{questions.map((question) => <tr key={question.id}><th>{question.label}</th><td>{label(question, answers[question.id])}</td><td>{label(question, baselineAnswers[question.id])}</td></tr>)}</tbody></table>
        <p>Compare answers and measured response time, not the models' confidence numbers as if they were interchangeable.</p>
      </details>

      <section className="demo-paths" aria-label="More ways to inspect the capability">
        <button className="demo-path lavender" onClick={() => onVerify(story.sampleId)}><span>Evidence / Ground truth</span><strong>Verify the answers.</strong><small>Paired cases, costs and model comparison →</small></button>
        <button className="demo-path pistachio" onClick={onTriage}><span>Scale / Throughput</span><strong>40 messages. Two queues.</strong><small>See decisions accumulate under pressure →</small></button>
        <button className="demo-path apricot" disabled={running} onClick={() => onReplay("agent-supervisor")}><span>More / Agent supervision</span><strong>Was the work really verified?</strong><small>Progressive decisions on a coding trace →</small></button>
      </section>
    </div>
  );
}
