"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  RUNTIME_SCENARIOS,
  SHARED_ENTITY_FIELDS,
  RuntimeScenario,
  DecisionQuestion,
} from "@/lib/demo-data";
import type { ExtractedSpan, NormalizedDecision } from "@/lib/foundry";
import { CustomSelect } from "./CustomSelect";
import { refundGate, type NavigationProgress } from "@/lib/decision-story";
import { DecisionStoryView, type StoryCheckpoint } from "./DecisionStoryView";

interface RuntimeViewProps {
  sendWs: (action: string, payload?: Record<string, any>) => boolean;
  subscribeWs: (
    handler: (msg: { event: string; data: any; ts: number }) => void
  ) => () => void;
  wsConnected: boolean;
  externalScenarioId?: string | null;
  replayMode?: boolean;
  replayLoading?: boolean;
  comparisonModelName?: string;
  onPlayRecorded?: (scenarioId: string) => void;
  onOpenWorkbench?: (sampleId?: string) => void;
  onOpenTriage?: () => void;
}

interface MomentItem {
  words: number;
  label: string;
  from: string;
  to: string;
  cls: string;
  quote: string;
}

const HUES = [160, 195, 275, 38, 330, 125, 220, 15];

export default function RuntimeView({
  sendWs,
  subscribeWs,
  wsConnected,
  externalScenarioId,
  replayMode = false,
  replayLoading = false,
  comparisonModelName = "gpt-6.1-terra",
  onPlayRecorded,
  onOpenWorkbench,
  onOpenTriage,
}: RuntimeViewProps) {
  const [scenarioId, setScenarioId] = useState(RUNTIME_SCENARIOS[0].id);

  useEffect(() => {
    if (
      externalScenarioId &&
      RUNTIME_SCENARIOS.some((s) => s.id === externalScenarioId)
    ) {
      setScenarioId(externalScenarioId);
    }
  }, [externalScenarioId]);
  const scenario: RuntimeScenario =
    RUNTIME_SCENARIOS.find((s) => s.id === scenarioId) || RUNTIME_SCENARIOS[0];

  const [questions, setQuestions] = useState<DecisionQuestion[]>(() => [
    ...RUNTIME_SCENARIOS[0].questions,
  ]);
  const [newQText, setNewQText] = useState("");
  const [showAddQ, setShowAddQ] = useState(false);

  const [running, setRunning] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [spans, setSpans] = useState<ExtractedSpan[]>([]);
  const [d1Answers, setD1Answers] = useState<
    Record<string, NormalizedDecision>
  >({});
  const [terraAnswers, setTerraAnswers] = useState<
    Record<string, NormalizedDecision>
  >({});
  const [d1History, setD1History] = useState<Record<string, number[]>>({});
  const [terraHistory, setTerraHistory] = useState<Record<string, number[]>>(
    {}
  );
  const [flippedKey, setFlippedKey] = useState<string | null>(null);
  const [flipcast, setFlipcast] = useState<{
    label: string;
    from: string;
    to: string;
    words: number;
    quote: string;
  } | null>(null);
  const [moments, setMoments] = useState<MomentItem[]>([]);
  const [wordFlags, setWordFlags] = useState<
    Array<{ start: number; end: number; text: string }>
  >([]);
  const [pickInfo, setPickInfo] = useState<{
    pick: Record<string, string>;
    ending: { text: string; expect: Record<string, string> };
  } | null>(null);
  const [streamDone, setStreamDone] = useState(false);
  const [streamError, setStreamError] = useState("");
  const [storyStage, setStoryStage] = useState(-1);
  const [inferencePhase, setInferencePhase] = useState<"idle" | "receiving" | "evaluating" | "decided" | "stopped">("idle");
  const [modelInput, setModelInput] = useState("");
  const [checkpoints, setCheckpoints] = useState<StoryCheckpoint[]>([]);
  const [showBaseline, setShowBaseline] = useState(false);
  const [navigationProgress, setNavigationProgress] = useState<NavigationProgress | null>(null);
  const isStory = Boolean(scenario.stages || scenario.navigation);
  const gate = refundGate(d1Answers);
  const baselineGate = refundGate(terraAnswers);

  // Telemetry counters
  const [d1Calls, setD1Calls] = useState(0);
  const [d1MsTotal, setD1MsTotal] = useState(0);
  const [d1LastMs, setD1LastMs] = useState(0);
  const [terraCalls, setTerraCalls] = useState(0);
  const [terraMsTotal, setTerraMsTotal] = useState(0);
  const [terraLastMs, setTerraLastMs] = useState(0);
  const [exCalls, setExCalls] = useState(0);
  const [exMsTotal, setExMsTotal] = useState(0);

  const prevLabelsRef = useRef<Record<string, string>>({});
  const transcriptRef = useRef("");
  const questionsRef = useRef<DecisionQuestion[]>(questions);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);

  const resetRun = useCallback(() => {
    prevLabelsRef.current = {};
    transcriptRef.current = "";
    setTranscript("");
    setSpans([]);
    setD1Answers({});
    setTerraAnswers({});
    setD1History({});
    setTerraHistory({});
    setFlipcast(null);
    setMoments([]);
    setWordFlags([]);
    setPickInfo(null);
    setStreamDone(false);
    setStreamError("");
    setStoryStage(-1);
    setInferencePhase("idle");
    setModelInput("");
    setCheckpoints([]);
    setNavigationProgress(null);
    setD1Calls(0);
    setD1MsTotal(0);
    setD1LastMs(0);
    setTerraCalls(0);
    setTerraMsTotal(0);
    setTerraLastMs(0);
    setExCalls(0);
    setExMsTotal(0);
  }, []);

  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

  useEffect(() => {
    const sc =
      RUNTIME_SCENARIOS.find((s) => s.id === scenarioId) ||
      RUNTIME_SCENARIOS[0];
    setQuestions([...sc.questions]);
    resetRun();
  }, [scenarioId, resetRun]);

  const entityFields = Object.keys({
    ...SHARED_ENTITY_FIELDS,
    ...scenario.extra,
  });

  useEffect(() => {
    return subscribeWs(({ event, data }) => {
      if (event === "runtime_started") {
        resetRun();
        setRunning(true);
        setStreamDone(false);
        setPickInfo({ pick: data.pick, ending: data.ending });
        setStoryStage(-1);
      } else if (event === "runtime_story_stage") {
        setStoryStage(data.index);
        setInferencePhase("receiving");
        setD1Answers({});
        setTerraAnswers({});
        setD1LastMs(0);
        setTerraLastMs(0);
        setModelInput("");
      } else if (event === "runtime_evaluation_started") {
        setInferencePhase("evaluating");
        setModelInput(data.modelInput);
        if (Array.isArray(data.questions)) setQuestions(data.questions);
      } else if (event === "runtime_navigation_state") {
        setNavigationProgress(data as NavigationProgress);
      } else if (event === "runtime_token") {
        const nextText =
          typeof data.transcript === "string"
            ? data.transcript
            : transcriptRef.current + (data.delta || "");
        transcriptRef.current = nextText;
        setTranscript(nextText);
        if (Array.isArray(data.spans)) {
          setSpans(data.spans);
        }
        if (scrollBoxRef.current) {
          scrollBoxRef.current.scrollTop = scrollBoxRef.current.scrollHeight;
        }
      } else if (event === "runtime_decision") {
        const answers: Record<string, NormalizedDecision> = data.answers || {};
        const lat = data.latency_ms || 0;
        const curText = transcriptRef.current;
        const wc = curText.trim() ? curText.trim().split(/\s+/).length : 0;

        setD1Calls((c) => c + 1);
        setD1MsTotal((t) => t + lat);
        setD1LastMs(lat);
        setD1Answers(answers);
        setInferencePhase("decided");
        if (Number.isInteger(data.index)) setCheckpoints((previous) => [...previous.filter((item) => item.index !== data.index), { index: data.index, title: data.currentNode, latencyMs: lat, answers }]);

        setD1History((prev) => {
          const next = { ...prev };
          for (const [k, ans] of Object.entries(answers)) {
            const arr = [...(next[k] || []), ans.value].slice(-36);
            next[k] = arr;
          }
          return next;
        });

        for (const q of questionsRef.current) {
          const ans = answers[q.id];
          if (!ans) continue;
          const prevLbl = prevLabelsRef.current[q.id];
          if (prevLbl && prevLbl !== ans.label) {
            const snippet = curText
              .slice(-115)
              .replace(/^[^a-zA-Z0-9$£€]+/, "")
              .replace(/\n+/g, " · ")
              .trim();

            const m = /([A-Za-z0-9$£€][\w$£€.,'-]*)\W*$/.exec(curText);
            if (m && m.index !== undefined) {
              setWordFlags((wf) => [
                ...wf,
                {
                  start: m.index,
                  end: m.index + m[1].length,
                  text: `${q.label} → ${ans.label}`,
                },
              ]);
            }

            setFlippedKey(q.id);
            setTimeout(() => setFlippedKey(null), 900);

            setFlipcast({
              label: q.label,
              from: prevLbl,
              to: ans.label,
              words: wc,
              quote: snippet,
            });
            setMoments((mList) => [
              {
                words: wc,
                label: q.label,
                from: prevLbl,
                to: ans.label,
                cls: ans.cls,
                quote: snippet,
              },
              ...mList,
            ]);
          }
          prevLabelsRef.current[q.id] = ans.label;
        }
      } else if (event === "runtime_terra_decision") {
        const answers: Record<string, NormalizedDecision> = data.answers || {};
        const lat = data.latency_ms || 0;
        setTerraCalls((c) => c + 1);
        setTerraMsTotal((t) => t + lat);
        setTerraLastMs(lat);
        setTerraAnswers(answers);
        setTerraHistory((prev) => {
          const next = { ...prev };
          for (const [k, ans] of Object.entries(answers)) {
            const arr = [...(next[k] || []), ans.value].slice(-36);
            next[k] = arr;
          }
          return next;
        });
      } else if (event === "runtime_extract") {
        setExCalls((c) => c + 1);
        setExMsTotal((t) => t + (data.latency_ms || 0));
        if (Array.isArray(data.spans)) {
          setSpans(data.spans);
        }
      } else if (event === "runtime_done" || event === "runtime_stopped") {
        setRunning(false);
        if (event === "runtime_stopped" || data.ok === false) setInferencePhase("stopped");
        if (event === "runtime_done") {
          setStreamDone(data.ok !== false);
          if (data.ok === false) setStreamError(data.error || "The story could not complete its model checks.");
        }
      }
    });
  }, [subscribeWs, resetRun]);

  const startStream = () => {
    if (running) {
      sendWs("stop_runtime");
      setRunning(false);
      setInferencePhase("stopped");
      return;
    }
    resetRun();
    if (scenario.navigation) setQuestions([...scenario.questions]);

    sendWs("start_runtime", {
      scenarioId,
      questions: scenario.navigation ? scenario.questions : questions,
    });
  };

  const handleAddQuestion = () => {
    const trimmed = newQText.trim();
    if (!trimmed) return;
    const id = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 24);
    if (!id) return;
    setQuestions((prev) => [
      ...prev,
      {
        id,
        label: trimmed.slice(0, 32),
        type: "noul",
        instructions: trimmed,
      },
    ]);
    setNewQText("");
    setShowAddQ(false);
  };

  const renderTranscriptTurns = () => {
    if (!transcript) {
      return (
        isStory ? <div className="story-preview">
          <span className="eyebrow">THE SCENARIO · SCRIPT PREVIEW, NOT MODEL OUTPUT</span>
          <h3>A $75 refund.<br />One untrusted detour.</h3>
          <div className="preview-move"><span>Finance approves</span><strong>$75 → original verified card</strong><small>The agent prepares the authorized action.</small></div>
          <div className="preview-move unsafe"><span>A tool tries to override it</span><strong>$750 → external bank account</strong><small>The pending action no longer matches approval.</small></div>
          <div className="preview-move"><span>Finance gives fresh approval</span><strong>$75 → original verified card</strong><small>Reassess the corrected action, not the old attack.</small></div>
        </div> : <div className="turn note">
          Play a recorded story without signing in, or stream a live conversation with your Azure connection. Both models evaluate the evolving input.
        </div>
      );
    }

    const fieldHue: Record<string, number> = {};
    entityFields.forEach((f, idx) => {
      fieldHue[f.toLowerCase()] = HUES[idx % HUES.length];
    });

    type Marker =
      | { start: number; end: number; kind: "flag"; text: string }
      | { start: number; end: number; kind: "ent"; field: string };

    const markers: Marker[] = [];
    const sortedFlags = [...wordFlags].sort((a, b) => a.start - b.start);
    for (const fl of sortedFlags) {
      if (fl.start >= 0 && fl.end <= transcript.length && fl.end > fl.start) {
        markers.push({
          start: fl.start,
          end: fl.end,
          kind: "flag",
          text: fl.text,
        });
      }
    }
    const sortedSpans = [...spans].sort((a, b) => a.start - b.start);
    for (const sp of sortedSpans) {
      if (
        sp.start < 0 ||
        sp.end > transcript.length ||
        sp.end <= sp.start
      )
        continue;
      const overlaps = markers.some(
        (m) => !(sp.end <= m.start || sp.start >= m.end)
      );
      if (!overlaps) {
        markers.push({
          start: sp.start,
          end: sp.end,
          kind: "ent",
          field: sp.field,
        });
      }
    }
    markers.sort((a, b) => a.start - b.start);

    const turnRegex = /(?:^|\n+)([A-Z][a-zA-Z0-9_-]{1,18}):\s*/g;
    const turnStarts: Array<{
      who: string;
      idx: number;
      contentStart: number;
    }> = [];
    let match: RegExpExecArray | null;
    while ((match = turnRegex.exec(transcript)) !== null) {
      turnStarts.push({
        who: match[1],
        idx: match.index,
        contentStart: match.index + match[0].length,
      });
    }

    if (turnStarts.length === 0) {
      return (
        <div className="turn a">
          {transcript}
          {running && <span className="caret" />}
        </div>
      );
    }

    const firstSpeaker = turnStarts[0].who;

    return turnStarts.map((t, i) => {
      const contentEnd =
        i + 1 < turnStarts.length ? turnStarts[i + 1].idx : transcript.length;
      const isLast = i === turnStarts.length - 1;
      const isCustomer = t.who !== firstSpeaker;
      const segMarkers = markers.filter(
        (m) => m.start >= t.contentStart && m.end <= contentEnd
      );

      const nodes: React.ReactNode[] = [];
      let cursor = t.contentStart;
      segMarkers.forEach((m, mIdx) => {
        if (m.start < cursor) return;
        if (m.start > cursor) {
          nodes.push(transcript.slice(cursor, m.start));
        }
        const sliceText = transcript.slice(m.start, m.end);
        if (m.kind === "flag") {
          nodes.push(
            <mark key={`f-${mIdx}`} className="flagword">
              {sliceText}
              <span className="flagtag">{m.text}</span>
            </mark>
          );
        } else {
          const h = fieldHue[m.field.toLowerCase()] ?? 160;
          nodes.push(
            <mark
              key={`e-${mIdx}`}
              className="ent"
              style={{ ["--h" as any]: h }}
            >
              {sliceText}
              <span className="lab">{m.field}</span>
            </mark>
          );
        }
        cursor = m.end;
      });
      if (cursor < contentEnd) {
        nodes.push(transcript.slice(cursor, contentEnd));
      }

      return (
        <div key={i} className={`turn ${isCustomer ? "b" : "a"}`}>
          <span className="who">{t.who}</span>
          {nodes}
          {isLast && running && <span className="caret" />}
        </div>
      );
    });
  };

  const wordCount = transcript.trim()
    ? transcript.trim().split(/\s+/).length
    : 0;
  const d1Avg = d1Calls ? Math.round(d1MsTotal / d1Calls) : 0;
  const terraAvg = terraCalls ? Math.round(terraMsTotal / terraCalls) : 0;
  const exAvg = exCalls ? Math.round(exMsTotal / exCalls) : 0;
  const answerLabel = (question: DecisionQuestion, answer?: NormalizedDecision) => {
    if (!answer) return "…";
    if (isStory && question.id === "risk_score" && typeof answer.key === "number") {
      return ["Low", "Review", "High", "Critical"][answer.key] || answer.label;
    }
    if (isStory && question.id === "next_action") {
      return ({ allow_original_refund: "Allow original refund", pause_for_confirmation: "Ask Finance", block_redirect: "Block redirect" } as Record<string, string>)[String(answer.key)] || answer.label;
    }
    return answer.label;
  };

  if (isStory && scenario.story) {
    return <DecisionStoryView
      scenario={scenario} questions={questions} transcript={transcript} stageIndex={storyStage}
      phase={inferencePhase} modelInput={modelInput} answers={d1Answers} baselineAnswers={terraAnswers}
      latencyMs={d1LastMs} baselineLatencyMs={terraLastMs} calls={d1Calls} checkpoints={checkpoints}
      running={running} complete={streamDone} error={streamError} replayMode={replayMode}
      replayLoading={replayLoading} ready={wsConnected} comparisonModelName={comparisonModelName}
      onSelect={setScenarioId} onRun={startStream} onReplay={(id) => onPlayRecorded?.(id)}
      onVerify={(id) => onOpenWorkbench?.(id)} onTriage={() => onOpenTriage?.()}
      navigationProgress={navigationProgress}
    />;
  }

  return (
    <div className="runtime-workspace">
      <section className="story-hero">
        <div>
          <p className="section-label">Microsoft-Decision-1 · The live decision lab</p>
          <h1>Small decisions. <span>Big consequences.</span></h1>
          <p>{scenario.description || "Watch intent and risk change as a conversation unfolds. Compare structured decisions with a generative model on the same evolving input."}</p>
        </div>
        <div className="story-launch">
          <div className="story-sun" aria-hidden="true"><span /></div>
          <button className="primary story-play" disabled={running || replayLoading} onClick={() => onPlayRecorded?.(scenarioId)}>{replayLoading ? "Loading recordings…" : "▶ Play recorded story"}</button>
          <span>No sign-in · real recorded model results</span>
        </div>
      </section>

      <main className="layout split-6-6 runtime-stage">
        {/* Left Column */}
        <section className="card story-input-card">
          <div className="card-head">
            <span className="eyebrow">{isStory ? "01 · THE AGENT'S NEXT MOVE" : "01 · CONVERSATION"}</span>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div className="runtime-scenario-picker">
                <CustomSelect
                  value={scenarioId}
                  disabled={running}
                  onChange={(val) => setScenarioId(val)}
                  options={RUNTIME_SCENARIOS.map((s) => ({
                    value: s.id,
                    label: s.label,
                    category: s.industry || "Live Telemetry",
                    description: s.description,
                    badge:
                      s.origin === "industry"
                        ? "INDUSTRY"
                        : "STREAM",
                    badgeTone:
                      s.origin === "industry"
                        ? "d1"
                        : "neutral",
                  }))}
                />
              </div>
              <button
                className="ghost runtime-live-check"
                onClick={startStream}
                disabled={!wsConnected}
              >
                <span>
                  {running ? "■ Stop" : replayMode ? "▶ Replay this story" : isStory ? "▶ Run live checks" : "▶ Stream Conversation"}
                </span>
              </button>
            </div>
          </div>
            <p className="story-provenance">{isStory ? "Scripted sandbox input · both models evaluate every checkpoint · no real refunds executed" : "Model-generated conversation · structured checks as the input changes"}</p>
            {streamError && <p className="comparison-error" role="alert">{streamError}</p>}
            {scenario.stages && <ol className="story-stage-track" aria-label="Story checkpoints">
              {scenario.stages.map((stage, index) => <li key={stage.title} className={storyStage === index ? "current" : storyStage > index ? "complete" : ""} aria-current={storyStage === index ? "step" : undefined}><span>{index + 1}</span>{["Authorize", "Intercept", "Recover"][index]}</li>)}
            </ol>}
          <div className="rt-stats" style={{ marginBottom: 10 }}>
            <span>
              <b>{wordCount}</b> words
            </span>
            <span>·</span>
            <span className="live">
              Decision-1: <b>{d1Calls}</b> calls (
              {d1Avg ? `${d1Avg}ms avg` : "—"})
            </span>
            <span>·</span>
            {showBaseline && <span className="terra-stat">
              {comparisonModelName}: <b>{terraCalls}</b> calls (
              {terraAvg ? `${terraAvg}ms avg` : "—"})
            </span>}
            <span>·</span>
            <span>
              Mentions: <b>{exCalls}</b> ({exAvg ? `${exAvg}ms` : "—"})
            </span>
          </div>

          <div className="rt-transcript" ref={scrollBoxRef}>
            {renderTranscriptTurns()}
          </div>

          <details className="runtime-extra">
          <summary>Extracted entities · {spans.length} spans</summary>
          <div className="card-head sub">
            <span className="eyebrow">
              03 · LIVE ENTITY MENTIONS{" "}
              <span className="hint">{spans.length} extracted</span>
            </span>
          </div>
          <div className="ent-groups">
            {entityFields.map((f, idx) => {
              const h = HUES[idx % HUES.length];
              const matching = spans.filter(
                (s) => s.field.toLowerCase() === f.toLowerCase()
              );
              const counts: Record<string, number> = {};
              matching.forEach((m) => {
                const k = m.text.trim();
                if (k) counts[k] = (counts[k] || 0) + 1;
              });
              const entries = Object.entries(counts);
              return (
                <div key={f} className="ent-group">
                  <h3 className="eyebrow">
                    <span
                      className="swatch"
                      style={{ background: `hsl(${h}, 75%, 55%)` }}
                    />
                    {f}
                  </h3>
                  <div className="items">
                    {entries.length === 0 ? (
                      <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
                        —
                      </span>
                    ) : (
                      entries.map(([txt, cnt]) => (
                        <span
                          key={txt}
                          className="echip"
                          style={{ ["--h" as any]: h }}
                        >
                          {txt}
                          {cnt > 1 && <small>×{cnt}</small>}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </details>
        </section>

        {/* Right Column */}
        <section className="card runtime-signal-board">
          {isStory && <div className={`action-gate ${gate}`} aria-live="polite">
            <div className="gate-orbit" aria-hidden="true"><span>{gate === "allow" ? "✓" : gate === "block" ? "!" : "?"}</span></div>
            <div>
              <span className="gate-kicker">Decision-1 · suggested policy action</span>
              <h2>{gate === "allow" ? "Ready to proceed." : gate === "block" ? "Catch it before it happens." : gate === "review" ? "Pause. Check the approval." : "Waiting for the next move."}</h2>
              <p>{gate === "allow" ? "The current action matches Finance's approval." : gate === "block" ? "This action changes an approved amount or destination." : gate === "review" ? "The evidence does not meet the displayed approval rule." : "The script is input. The models make the judgement."}</p>
              <span className="gate-tag">{gate === "waiting" ? "Awaiting evidence" : gate === "allow" ? "ALLOW · original payment method" : gate === "block" ? "BLOCK · unauthorized change" : "HOLD · human confirmation"}</span>
              <span className="baseline-gate">{comparisonModelName}: {baselineGate === "waiting" ? "pending" : baselineGate === "review" ? "HOLD" : baselineGate.toUpperCase()}</span>
            </div>
          </div>}
          <div className="card-head">
            <span className="eyebrow">
              02 · MICROSOFT-DECISION-1 OUTPUT ·{" "}
              <span className="hint">
                {questions.length} structured answers · {d1Avg ? `${d1Avg} ms average` : "awaiting model response"}
              </span>
            </span>
            <button
              className="ghost"
              onClick={() => setShowAddQ((v) => !v)}
              disabled={running || replayMode}
              title={replayMode ? "Switch to live mode to edit recorded questions" : undefined}
            >
              + Question
            </button>
          </div>
          <label className="baseline-toggle"><input type="checkbox" checked={showBaseline} onChange={(event) => setShowBaseline(event.target.checked)} /> Show the generative baseline comparison</label>

          {showAddQ && (
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 12,
                alignItems: "center",
              }}
            >
              <input
                type="text"
                placeholder="Ask a new yes/no question (e.g., Did the customer ask for a discount?)"
                value={newQText}
                onChange={(e) => setNewQText(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="primary" onClick={handleAddQuestion}>
                Add
              </button>
            </div>
          )}

          <div className="dq-grid">
            {questions.map((q) => {
              const d1Ans = d1Answers[q.id];
              const terraAns = terraAnswers[q.id];
              const pct = d1Ans ? Math.round(d1Ans.value * 100) : 0;
              const cls = d1Ans?.cls || "";
              const histD1 = d1History[q.id] || [];
              const histTerra = terraHistory[q.id] || [];

              const d1Points = histD1
                .map((v, i) => {
                  const x =
                    histD1.length === 1
                      ? 100
                      : (i / (histD1.length - 1)) * 100;
                  const y = 22 - Math.max(0, Math.min(1, v)) * 18;
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(" ");

              const terraPoints = histTerra
                .map((v, i) => {
                  const x =
                    histTerra.length === 1
                      ? 100
                      : (i / (histTerra.length - 1)) * 100;
                  const y = 22 - Math.max(0, Math.min(1, v)) * 18;
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(" ");

              return (
                <div
                  key={q.id}
                  data-question={q.id}
                  className={`dq ${flippedKey === q.id ? "flip" : ""}`}
                >
                  <div className="dq-head">
                    <span className="dq-label">{q.label}</span>
                    <span className={`dq-ans ${cls}`}>
                      {answerLabel(q, d1Ans)}
                    </span>
                  </div>

                  <div
                    className={`dq-meter ${q.type === "score" ? "scale" : cls}`}
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
                    <span>{d1Ans ? q.type === "choice" ? `${Math.round(d1Ans.confidence * 100)}% confidence` : d1Ans.detail : "waiting"}</span>
                    <span>D1: {d1LastMs ? `${d1LastMs}ms` : "—"}</span>
                  </div>

                  {showBaseline && <div className="dq-terra-row">
                    <span>
                      {comparisonModelName}: <b>{answerLabel(q, terraAns)}</b>
                    </span>
                    <span>{terraLastMs ? `${terraLastMs}ms` : "—"}</span>
                  </div>}
                  <svg
                    className="spark"
                    viewBox="0 0 100 24"
                    preserveAspectRatio="none"
                  >
                    <line x1="0" y1="12" x2="100" y2="12" />
                    {showBaseline && terraPoints && (
                      <polyline className="terra-line" points={terraPoints} />
                    )}
                    {d1Points && (
                      <polyline className="d1-line" points={d1Points} />
                    )}
                  </svg>
                </div>
              );
            })}
          </div>
          {isStory && <details className="runtime-extra gate-rule">
            <summary>Why this gate? Inspect the rule</summary>
            <p>This is a suggested decision from application code, not an executed payment. Allow only when approval probability ≥ 70%, redirect probability ≤ 30%, and the model selects the original-method refund.</p>
            <p>Boolean checks capture authorization and redirection; Choice recommends a route; Score assesses current action risk. A historical attack can remain detected even after the pending action is corrected.</p>
          </details>}

          {/* Flipcast Banner */}
          <div className={`flipcast ${flipcast ? "show" : ""}`}>
            {!flipcast ? (
              <>
                <span className="eyebrow">
                  {isStory ? "WATCHING · CHECKPOINT EVALUATIONS" : "WATCHING · PROGRESSIVE EVALUATIONS"}
                </span>
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 13,
                    marginTop: 6,
                  }}
                >
                  {isStory ? "Signals reset at each new action. Previous approval must not authorize a changed payment." : "Changes in model answers are announced here and pinned in the transcript."}
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow">
                  DECISION-1 CHANGED ITS MIND · WORD {flipcast.words}
                </span>
                <div className="fc-line">
                  <span>{flipcast.label}</span>
                  <s>{flipcast.from}</s>
                  <span>→</span>
                  <b>{flipcast.to}</b>
                </div>
                <p className="fc-quote">“…{flipcast.quote}”</p>
              </>
            )}
          </div>

          <details className="runtime-extra">
          <summary>Decision changes · {moments.length} moments</summary>
          <div className="card-head sub">
            <span className="eyebrow">
              MOMENTS WHEN MICROSOFT-DECISION-1 CHANGED ITS MIND
            </span>
          </div>
          {moments.length === 0 ? (
            <div style={{ color: "var(--text-dim)", fontSize: 12.5 }}>
              Mind-change events will appear here as the conversation unfolds.
            </div>
          ) : (
            <ol className="moments">
              {moments.map((m, i) => (
                <li key={i}>
                  <span className="t">word {m.words}</span>
                  <span className="what">
                    {m.label}: {m.from} → <b>{m.to}</b>
                    <span className="q">“…{m.quote}”</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          </details>

          <details className="runtime-extra" open={streamDone}>
          <summary>{streamDone ? "Story complete · observed results" : "How this demo works"}</summary>
          {!streamDone && <p>{isStory ? "Three scripted checkpoints isolate authorization, a tool-output attack, and fresh approval. The model answers are not scripted. Use Compare to verify the safe and unsafe cases against ground truth." : "A generated conversation is evaluated as it develops. Signal curves show model answers, not a guarantee of overall accuracy."}</p>}
          {streamDone && pickInfo && (
            <div className="reveal">
              <div className="verdict-big">
                Stream Complete ·{" "}
                {d1Avg && terraAvg
                  ? `Decision-1 averaged ${d1Avg}ms vs ${terraAvg}ms on ${comparisonModelName} (${(
                      terraAvg / Math.max(1, d1Avg)
                    ).toFixed(1)}× time ratio)`
                  : `Decision-1 completed ${d1Calls} evaluations`}
              </div>
              <span className="eyebrow">
                {isStory ? "SCRIPTED INPUT · MEASURED MODEL RESULTS" : "THE SCRIPT · RANDOM TWIST & ENDING"}
              </span>
              <p style={{ margin: "6px 0 4px" }}>
                <b>{isStory ? "What changed:" : "Mid-call twist:"}</b> {isStory ? "A tool output tried to change $75 on the original card into $750 to an external bank." : pickInfo.pick?.twist}
              </p>
              <p style={{ margin: 0 }}>
                <b>{isStory ? "Recovery:" : "Hidden ending:"}</b> {pickInfo.ending?.text}
              </p>
            </div>
          )}
          </details>
        </section>
      </main>
      <section className="demo-paths" aria-label="Explore the next capability">
        <button className="demo-path lavender" onClick={() => onOpenWorkbench?.()}><span>01 / Prove the answer</span><strong>Safe input. Unsafe input.</strong><small>Same questions, paired ground truth &rarr;</small></button>
        <button className="demo-path pistachio" onClick={onOpenTriage}><span>02 / Increase the pressure</span><strong>40 messages. Two queues.</strong><small>See where slower decisions add delay &rarr;</small></button>
        <button className="demo-path apricot" disabled={running} onClick={() => onPlayRecorded?.("agent-supervisor")}><span>03 / Supervise an agent</span><strong>Done is not the same as verified.</strong><small>Watch for unsafe work and missing tests &rarr;</small></button>
      </section>
    </div>
  );
}
