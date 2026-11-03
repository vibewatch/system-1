"use client";

import React, { useEffect, useState } from "react";
import { Boxes, LayoutDashboard, Network, Landmark, FileText, HeartPulse, Shirt, Radio, Play, Square, ArrowUpRight, ChevronRight } from "lucide-react";
import { CustomSelect } from "./CustomSelect";
import { RUNTIME_SCENARIOS, type DecisionQuestion, type RuntimeScenario } from "@/lib/demo-data";
import { storyAction, type NavigationProgress } from "@/lib/decision-story";
import type { NormalizedDecision } from "@/lib/foundry";
import { DecisionScene } from "./DecisionScene";

export type ShowcaseMode = "solution" | "comparison";
export interface StoryCheckpoint {
  index: number;
  latencyMs: number;
  answers: Record<string, NormalizedDecision>;
  title?: string;
  modelInput?: string;
  questions?: DecisionQuestion[];
  navigation?: NavigationProgress;
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
  baselineCheckpoints: StoryCheckpoint[];
  running: boolean;
  complete: boolean;
  error: string;
  replayMode: boolean;
  replayLoading: boolean;
  ready: boolean;
  comparisonModelName: string;
  navigationProgress: NavigationProgress | null;
  mode: ShowcaseMode;
  animationPaused: boolean;
  onModeChange: (mode: ShowcaseMode) => void;
  onSelect: (id: string) => void;
  onRun: () => void;
  onReplay: (id: string) => void;
  onVerify: (sampleId: string) => void;
  onTriage: () => void;
}

const icons = { warehouse: Boxes, adaptive: LayoutDashboard, navigation: Network, banking: Landmark, documents: FileText, healthcare: HeartPulse, wardrobe: Shirt, brands: Radio };
const featured = RUNTIME_SCENARIOS.filter(item => item.origin === "industry" && item.story);

function label(question: DecisionQuestion, answer?: NormalizedDecision) {
  if (!answer) return "Awaiting response";
  return question.type === "score" && Array.isArray(question.criteria) && typeof answer.key === "number"
    ? question.criteria[answer.key] || answer.label : answer.label;
}

function ReturnedAnswers({ scenario, questions, answers }: { scenario: RuntimeScenario; questions: DecisionQuestion[]; answers: Record<string, NormalizedDecision> }) {
  return <div className="decision-output">
    {questions.map(question => {
      const answer = answers[question.id];
      return <div key={question.id} data-question={question.id} className={`decision-output-row ${answer ? "returned" : "pending"}`}>
        <div><span>{question.label}</span><small>{question.type === "noul" ? "Boolean" : question.type === "choice" ? "Choice" : "Score"}</small></div>
        <strong>{question.id === "next_action" && answer ? scenario.story!.actions[String(answer.key)]?.label || answer.label : label(question, answer)}</strong>
        {answer && <span className="answer-measure">{question.type === "score" ? answer.detail : `${Math.round(answer.value * 100)}% ${question.type === "noul" ? "yes" : "choice probability"}`}</span>}
      </div>;
    })}
  </div>;
}

export function DecisionStoryView({
  scenario, questions, transcript, stageIndex, phase, modelInput, answers, baselineAnswers,
  latencyMs, baselineLatencyMs, calls, checkpoints, baselineCheckpoints, running, complete,
  error, replayMode, replayLoading, ready, comparisonModelName, navigationProgress, mode,
  animationPaused, onModeChange, onSelect, onRun, onReplay, onVerify, onTriage,
}: Props) {
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null);
  useEffect(() => { setInspectedIndex(null); }, [scenario.id, stageIndex, running]);
  const story = scenario.story!;
  const nodeLabel = (id?: string) => scenario.navigation?.nodes.find(item => item.id === id)?.label || id || "Graph state";
  const stages = scenario.stages || Array.from({ length: Math.max(1, stageIndex + 1, checkpoints.length) }, (_, step) => ({
    title: nodeLabel(checkpoints.find(item => item.index === step)?.title || navigationProgress?.lastEvaluated || scenario.navigation!.start),
    text: "", change: "Choose one supported legal edge toward the target.",
  }));
  const index = Math.min(stages.length - 1, Math.max(0, inspectedIndex ?? stageIndex));
  const checkpoint = inspectedIndex !== null ? checkpoints.find(item => item.index === index) : undefined;
  const baselineCheckpoint = inspectedIndex !== null ? baselineCheckpoints.find(item => item.index === index) : undefined;
  const currentAnswers = checkpoint?.answers || answers;
  const currentBaseline = baselineCheckpoint?.answers || baselineAnswers;
  const currentQuestions = checkpoint?.questions || questions;
  const currentInput = checkpoint?.modelInput || modelInput;
  const progress = checkpoint?.navigation || navigationProgress;
  const primaryMs = checkpoint?.latencyMs ?? latencyMs;
  const baselineMs = baselineCheckpoint?.latencyMs ?? baselineLatencyMs;
  const activePhase = checkpoint ? "decided" : phase;
  const stage = stages[index];
  const prefixLength = stages.slice(0, index).reduce((sum, item) => sum + item.text.length + 2, 0);
  const currentText = scenario.navigation ? currentInput || `Start at ${nodeLabel(scenario.navigation.start)}; target ${nodeLabel(scenario.navigation.target)}.`
    : checkpoint || phase === "idle" ? stage.text : transcript.slice(prefixLength);
  const action = progress?.status === "review" ? { label: "Stop for guidance", detail: progress.reason, tone: "review" as const }
    : progress?.status === "reached" ? { label: `Reached ${nodeLabel(progress.target)}`, detail: "Reached through observed model-selected legal edges.", tone: "allow" as const }
    : storyAction(scenario, currentAnswers);
  const hasResponse = Object.keys(currentAnswers).length > 0;
  const baselineReturned = Object.keys(currentBaseline).length > 0;
  const paused = animationPaused || phase === "stopped";
  const primaryStatus = hasResponse ? "Decision returned" : activePhase === "evaluating" ? "Evaluating input" : activePhase === "receiving" ? "Receiving input" : "Ready for a decision";
  const maxMs = Math.max(primaryMs, baselineMs, 1);
  const evidence = <section className="showcase-context">
    <div className="current-input"><span className="section-label">{checkpoint ? "INSPECTING AN OBSERVED CHECKPOINT" : phase === "idle" ? "INPUT PREVIEW · NOT MODEL OUTPUT" : "CURRENT INPUT"}</span><p>{currentText || "The next input is arriving…"}</p></div>
    <details className="showcase-evidence"><summary>Purpose &amp; evidence <ChevronRight size={14} /></summary><div className="evidence-body">
      <p><strong>What this proves</strong> {story.modelJob}</p><p>{story.actionNote}</p>
      <details className="runtime-extra"><summary>Inspect the exact model input</summary><pre className="story-raw">{currentInput || "No model request has been made."}</pre></details>
      <details className="runtime-extra"><summary>Inspect actual Decision-1 response values</summary><pre className="story-raw">{hasResponse ? JSON.stringify(Object.fromEntries(Object.entries(currentAnswers).map(([key, answer]) => [key, answer.raw])), null, 2) : "No response has arrived."}</pre></details>
      {scenario.inputScope === "checkpoint" && <p>Only the current checkpoint is sent as evidence. Task rules stay in the question schema.</p>}
      <p>Supported suggestions require at least 65% choice probability; the provider's separate confidence field is not that probability. These synthetic cases are not production safety guarantees or evidence of general model superiority.</p>
      {story.visual === "brands" && <p>The application holds flagged brand recommendations for editorial review at 70% embedded-instruction probability. It never rewrites the returned model answers.</p>}
      {story.visual === "refund" && <p>Refund approval also requires valid-approval probability ≥ 70% and redirect probability ≤ 30%.</p>}
      <button className="text-button verify-story" onClick={() => onVerify(story.sampleId)}>Verify paired expected answers and costs <ArrowUpRight size={13} /></button>
    </div></details>
  </section>;

  return <div className="showcase-workspace" data-view={mode}>
    <aside className="showcase-sidebar" aria-label="Use cases">
      <div className="catalog-heading"><span className="section-label">THE SHOWCASE</span><span>08</span></div>
      <nav className="scene-catalog" aria-label="Eight business demonstrations">
        {featured.map((item, position) => {
          const Icon = icons[item.story!.visual as keyof typeof icons] || Boxes;
          return <button key={item.id} disabled={running} aria-pressed={scenario.id === item.id} className={scenario.id === item.id ? "selected" : ""} onClick={() => onSelect(item.id)}>
            <span className={`catalog-icon color-${position % 4}`}><Icon size={19} strokeWidth={1.6} /></span>
            <span><strong>{item.story!.title}</strong><small>{["Operations", "Adaptive interface", "Knowledge graph", "Banking", "Finance", "Healthcare", "Retail", "Brand relevance"][position]}</small></span>
            <ChevronRight size={13} className="catalog-chevron" />
          </button>;
        })}
      </nav>
      <div className="story-catalog-bar"><span className="section-label">QUICK SWITCH</span><CustomSelect value={scenario.id} disabled={running} onChange={onSelect} searchable options={RUNTIME_SCENARIOS.map(item => ({ value: item.id, label: item.label, category: item.story ? "Business demonstrations" : "Original workflows" }))} /></div>
      <div className="catalog-note"><strong>A decision, not a chatbot.</strong><p>Each scene turns typed model answers into a visible application response.</p><button className="text-button verify-story" onClick={() => onVerify(story.sampleId)}>Open the test lab <ArrowUpRight size={13} /></button></div>
    </aside>

    <main className="showcase-main" id="main-content">
      <header className="showcase-heading">
        <div><div className="showcase-breadcrumb">Showcase <span>/</span> {scenario.industry}</div><h1>{story.title}</h1><p>{scenario.description}</p></div>
        <div className="showcase-play">
          <button className="primary story-play" aria-label="Play recorded story" disabled={running || replayLoading} onClick={() => onReplay(scenario.id)}><Play size={15} fill="currentColor" />{replayLoading ? "Loading…" : "Play demo"}</button>
          <span>Recorded Azure decisions · no sign-in</span>
        </div>
      </header>

      <div className="showcase-toolbar">
        <div className="showcase-modes" role="group" aria-label="Presentation view">
          <button aria-pressed={mode === "solution"} onClick={() => onModeChange("solution")}><LayoutDashboard size={15} />Solution</button>
          <button aria-pressed={mode === "comparison"} onClick={() => onModeChange("comparison")}><Network size={15} />LLM comparison</button>
        </div>
        <button className="text-button runtime-live-check" onClick={onRun} disabled={!ready} title={!ready ? "Configure Azure through Options → Connection settings" : undefined}>{running ? <Square size={12} /> : <Play size={12} />}{running ? "Stop" : replayMode ? "Replay again" : "Run live"}</button>
      </div>

      <ol className="scene-timeline checkpoint-progress" aria-label="Input checkpoints">
        {stages.map((item, step) => {
          const observed = checkpoints.some(result => result.index === step);
          return <li key={`${step}-${item.title}`} className={index === step ? "current" : observed ? "complete" : ""} aria-current={index === step ? "step" : undefined}><button disabled={running || !observed} onClick={() => setInspectedIndex(step)}><span>{step + 1}</span><strong>{item.title}</strong>{observed && <small>{checkpoints.find(result => result.index === step)?.latencyMs} ms</small>}</button></li>;
        })}
      </ol>

      {mode === "solution" ? <div className="solution-stage-layout">
        <section className="scene-stage-card" aria-label="Animated business solution">
          <div className="stage-card-heading"><span><b className="scene-live-dot" />2D BUSINESS SIMULATION</span><span>{stage.title}</span></div>
          <DecisionScene scenario={scenario} index={index} answers={currentAnswers} navigationProgress={progress} paused={paused} />
          <div className={`solution-action action-gate ${action?.tone || "waiting"}`}><div><span>APPLICATION RESPONSE</span><h2>{action?.label || "Waiting for Decision-1"}</h2></div><span className="gate-tag">{action?.tone === "review" ? "Human review" : action ? "Sandbox action" : "Not applied"}</span></div>
        </section>
        <div className="solution-inspector-stack"><aside className={`decision-inspector pipeline-model ${activePhase}`} aria-label="Microsoft-Decision-1 model work">
          <div className="inspector-heading"><span className="model-monogram">D1</span><div><h2>Microsoft-Decision-1</h2><span>{replayMode ? "Recorded inference" : "Live inference"}</span></div><span className={`inference-dot ${activePhase}`} /></div>
          <div className="inference-status" role="status"><strong>{error ? "Model check interrupted" : activePhase === "stopped" ? "Stopped" : primaryStatus}</strong><span>{hasResponse ? `${Object.keys(currentAnswers).length}/${currentQuestions.length} structured answers · ${primaryMs} ms for this call` : activePhase === "evaluating" ? `${currentInput.length.toLocaleString()} characters · ${currentQuestions.length} questions` : `${currentQuestions.length} configured questions · no decision yet`}</span></div>
          <ReturnedAnswers scenario={scenario} questions={currentQuestions} answers={currentAnswers} />
          <p className="inspector-footnote">The model chooses. The app animates a fixed scene and applies the demo policy.</p>
        </aside>{evidence}</div>
      </div> : <section className="animated-comparison" aria-label="Animated model comparison">
        <div className="comparison-context"><span className="source-badge">SAME INPUT</span><strong>{stage.title}</strong><span>{replayMode ? "Original measured response times" : "Independent parallel model calls"}</span></div>
        <div className="comparison-stages">
          {([
            { tier: "decision1", name: "Microsoft-Decision-1", result: currentAnswers, ms: primaryMs, returned: hasResponse },
            { tier: "terra", name: comparisonModelName, result: currentBaseline, ms: baselineMs, returned: baselineReturned },
          ] as const).map(model => <section key={model.tier} className={`comparison-stage-card ${model.tier}`} data-tier={model.tier}>
            <div className="comparison-model-heading"><div><span className="model-monogram">{model.tier === "decision1" ? "D1" : "LLM"}</span><h2>{model.name}</h2></div><span className="comparison-model-time" data-measured-ms={model.returned ? model.ms : 0}>{model.returned ? `${model.ms} ms` : activePhase === "evaluating" || activePhase === "decided" ? "Evaluating…" : "Waiting"}</span></div>
            <div className="measured-time-track"><span style={{ width: model.returned ? `${model.ms / maxMs * 100}%` : "0%" }} /></div>
            <DecisionScene scenario={scenario} index={index} answers={model.result} navigationProgress={progress} modelName={model.name} comparison paused={paused} />
            <details className="comparison-answers"><summary>{model.returned ? `${Object.keys(model.result).length} returned answers` : "Awaiting structured answers"}<ChevronRight size={13} /></summary><ReturnedAnswers scenario={scenario} questions={currentQuestions} answers={model.result} /></details>
          </section>)}
        </div>
        <p className="comparison-reading-note">{scenario.navigation ? "Both models propose an edge from the same graph state. Only Decision-1 advances this shared run; these are not two independent graph journeys." : "Both scenes use the same input and application policy. A scene moves only when that model's actual response arrives."} Animation duration is illustrative, not provider latency.</p>
      </section>}

      {mode === "comparison" && evidence}
      <footer className="showcase-footer"><span className="story-call-count">{calls} Decision-1 checks {replayMode ? "replayed" : "completed"}{complete ? " · story complete" : ""}</span><span>{paused ? "Animation paused" : "Original artwork · simulated actions"}</span><button className="text-button" onClick={onTriage}>Queue benchmark <ArrowUpRight size={12} /></button></footer>
      {error && <p role="alert" className="comparison-error">{error}</p>}
    </main>
  </div>;
}
