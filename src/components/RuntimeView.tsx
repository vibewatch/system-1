"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  RUNTIME_SCENARIOS,
  SHARED_ENTITY_FIELDS,
  RuntimeScenario,
  DecisionQuestion,
} from "@/lib/demo-data";
import type { ExtractedSpan, NormalizedDecision } from "@/lib/foundry";
import { CustomSelect } from "./CustomSelect";
import { Disclosure } from "./Disclosure";

interface RuntimeViewProps {
  sendWs: (action: string, payload?: Record<string, any>) => boolean;
  subscribeWs: (
    handler: (msg: { event: string; data: any; ts: number }) => void
  ) => () => void;
  wsConnected: boolean;
  externalScenarioId?: string | null;
  replayMode?: boolean;
  comparisonModelName?: string;
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
  comparisonModelName = "gpt-6.1-terra",
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
  useEffect(() => { setQuestions([...scenario.questions]); }, [scenario]);
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
  const [d1TextLen, setD1TextLen] = useState(0);
  const [terraTextLen, setTerraTextLen] = useState(0);
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

  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

  useEffect(() => {
    const sc =
      RUNTIME_SCENARIOS.find((s) => s.id === scenarioId) ||
      RUNTIME_SCENARIOS[0];
    setQuestions([...sc.questions]);
  }, [scenarioId]);

  const entityFields = Object.keys({
    ...SHARED_ENTITY_FIELDS,
    ...scenario.extra,
  });

  useEffect(() => {
    return subscribeWs(({ event, data }) => {
      if (event === "runtime_started") {
        setRunning(true);
        setStreamDone(false);
        setPickInfo({ pick: data.pick, ending: data.ending });
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
        setD1TextLen(data.textLen || 0);
        setD1Answers(answers);

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
        setTerraTextLen(data.textLen || 0);
        setTerraAnswers(answers);
      } else if (event === "runtime_extract") {
        setExCalls((c) => c + 1);
        setExMsTotal((t) => t + (data.latency_ms || 0));
        if (Array.isArray(data.spans)) {
          setSpans(data.spans);
        }
      } else if (event === "runtime_done" || event === "runtime_stopped") {
        setRunning(false);
        if (event === "runtime_done") {
          setStreamDone(true);
        }
      }
    });
  }, [subscribeWs]);

  const startStream = () => {
    if (running) {
      sendWs("stop_runtime");
      setRunning(false);
      return;
    }
    prevLabelsRef.current = {};
    transcriptRef.current = "";
    setTranscript("");
    setSpans([]);
    setD1Answers({});
    setTerraAnswers({});
    setD1TextLen(0);
    setTerraTextLen(0);
    setD1LastMs(0);
    setTerraLastMs(0);
    setFlipcast(null);
    setMoments([]);
    setWordFlags([]);
    setStreamDone(false);
    setD1Calls(0);
    setD1MsTotal(0);
    setTerraCalls(0);
    setTerraMsTotal(0);
    setExCalls(0);
    setExMsTotal(0);

    sendWs("start_runtime", {
      scenarioId,
      questions,
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
        <div className="turn note">
          Click <b>{replayMode ? "Replay conversation" : "Stream Conversation"}</b> to {replayMode ? "replay a recorded" : "generate a live"} customer
          conversation via <code>{comparisonModelName}</code> and watch{" "}
          <b>Microsoft-Decision-1.1</b> evaluate successive transcript snapshots{" "}
          {replayMode ? "from the original Azure event timeline." : "over WebSocket."}
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
        // Entity and decision highlights can overlap; never repeat source text.
        if (m.end <= cursor) return;
        const start = Math.max(cursor, m.start);
        if (start > cursor) {
          nodes.push(transcript.slice(cursor, start));
        }
        const sliceText = transcript.slice(start, m.end);
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

  return (
    <>
      <section className="hero-banner">
        <div>
          <p className="eyebrow">
            01 · {replayMode ? "RECORDED EVENT TIMELINE" : "REAL-TIME WEBSOCKET STREAMING"} + SYSTEMONE DECISIONS
          </p>
          <h1>
            Streaming transcripts, <strong>structured decisions.</strong>
          </h1>
        </div>
        <p className="hero-copy">
          Follow the conversation. See each model&apos;s latest decision and how much of the transcript it has evaluated.
        </p>
      </section>

      <p className="comparison-method layout single">
        Update-cadence demo, not a same-snapshot accuracy benchmark. Different checkpoints can produce different answers.
      </p>

      <main className="layout split-6-6">
        {/* Left Column */}
        <section className="card">
          <div className="card-head">
            <span className="eyebrow">01 · {replayMode ? "RECORDED" : "LIVE"} CONVERSATION STREAM</span>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                maxWidth: "100%",
                minWidth: 0,
              }}
            >
              <div style={{ minWidth: 0, width: "min(310px, 100%)" }}>
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
                className="primary"
                onClick={startStream}
                disabled={!wsConnected}
              >
                <span>
                  {running ? "■ Stop Stream" : replayMode ? "▶ Replay conversation" : "▶ Stream Conversation"}
                </span>
              </button>
            </div>
          </div>

          <div className="rt-stats" style={{ marginBottom: 10 }}>
            <span>
              <b>{wordCount}</b> words
            </span>
            <span>·</span>
            <span className="live">
              Decision-1.1: <b>{d1Calls}</b> calls (
              {d1Avg ? `${d1Avg}ms avg` : "—"})
            </span>
            <span>·</span>
            <span className="terra-stat">
              {comparisonModelName}: <b>{terraCalls}</b> calls (
              {terraAvg ? `${terraAvg}ms avg` : "—"})
            </span>
            <span>·</span>
            <span>
              Mentions: <b>{exCalls}</b> ({exAvg ? `${exAvg}ms` : "—"})
            </span>
          </div>

          <div className="rt-transcript" ref={scrollBoxRef}>
            {renderTranscriptTurns()}
          </div>

          {/* 03 Mentions */}
          <div className="card-head sub">
            <span className="eyebrow">
              03 · {replayMode ? "RECORDED" : "LIVE"} ENTITY MENTIONS{" "}
              <span className="hint">{spans.length} · {comparisonModelName} + pattern matches</span>
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
                      <span style={{ color: "var(--text-dim)", fontSize: "var(--font-sm)" }}>
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
        </section>

        {/* Right Column */}
        <section className="card">
          <div className="card-head">
            <span className="eyebrow">
              02 · LATEST DECISIONS
            </span>
            <button
              className="ghost"
              onClick={() => setShowAddQ((v) => !v)}
              disabled={running || replayMode}
            >
              + Question
            </button>
          </div>

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

          <div className="stream-checkpoints">
            {[
              { name: "Decision-1.1", tone: "d1", length: d1TextLen, calls: d1Calls, avg: d1Avg },
              { name: comparisonModelName, tone: "terra", length: terraTextLen, calls: terraCalls, avg: terraAvg },
            ].map((model) => <div key={model.tone} className={model.tone}>
              <b>{model.name}</b>
              <span>{model.calls} updates · {model.avg ? `${model.avg} ms avg` : "Not run"}</span>
              <div className="snapshot-track"><i style={{ width: `${transcript.length ? Math.min(100, model.length / transcript.length * 100) : 0}%` }} /></div>
              <small>Evaluated {model.length.toLocaleString()} / {transcript.length.toLocaleString()} characters</small>
            </div>)}
          </div>
          <p className="stream-snapshot-status">{d1TextLen && terraTextLen
            ? d1TextLen === terraTextLen ? "Both latest results use the same transcript checkpoint." : "Different checkpoints · answer differences are not scored as errors."
            : "Waiting for evaluated checkpoints."}</p>
          <div className="dq-grid stream-decisions">
            {questions.map((q) => {
              const d1Ans = d1Answers[q.id];
              const terraAns = terraAnswers[q.id];

              return (
                <div
                  key={q.id}
                  className={`dq ${flippedKey === q.id ? "flip" : ""}`}
                >
                  <div className="dq-head">
                    <span className="dq-label">{q.label}</span>
                  </div>
                  {[
                    { name: "Decision-1.1", answer: d1Ans, tone: "d1", ms: d1LastMs },
                    { name: comparisonModelName, answer: terraAns, tone: "terra", ms: terraLastMs },
                  ].map((model) => <div className={`stream-answer ${model.tone}`} key={model.tone}>
                    <span>{model.name}</span><b>{model.answer?.label || "…"}</b>
                    <small>{model.answer?.detail || "Awaiting result"}</small><small>{model.ms ? `${model.ms} ms` : "—"}</small>
                  </div>)}
                </div>
              );
            })}
          </div>
          <Disclosure label="How streaming comparisons work">
            <p>Each model has one request in flight and evaluates its latest available snapshot, skipping intermediate updates.
              Request averages cover different checkpoints. More updates or higher confidence do not establish higher accuracy.
              Entity extraction uses {comparisonModelName} plus pattern matches. Answer-change markers below track Decision-1.1 only.</p>
          </Disclosure>
          {/* Flipcast Banner */}
          <div className={`flipcast ${flipcast ? "show" : ""}`}>
            {!flipcast ? (
              <>
                <span className="eyebrow">
                  WATCHING · STRUCTURED DECISION EVENTS
                </span>
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: "var(--font-md)",
                    marginTop: 6,
                  }}
                >
                  Each question starts uncertain. When a decision event changes
                  a <b>Microsoft-Decision-1.1</b> answer, the update appears here and
                  is pinned inside the transcript.
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow">
                  DECISION-1.1 CHANGED ITS MIND · WORD {flipcast.words}
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

          {/* Moments Timeline */}
          <div className="card-head sub">
            <span className="eyebrow">
              MOMENTS WHEN MICROSOFT-DECISION-1.1 CHANGED ITS MIND
            </span>
          </div>
          {moments.length === 0 ? (
            <div style={{ color: "var(--text-dim)", fontSize: "var(--font-sm)" }}>
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

          {/* Script Reveal & Verdict */}
          {streamDone && pickInfo && (
            <div className="reveal">
              <div className="verdict-big">
                Stream Complete ·{" "}
                {d1Avg && terraAvg
                  ? `Decision-1.1 ${d1Calls} updates · ${comparisonModelName} ${terraCalls} updates`
                  : `Decision-1.1 completed ${d1Calls} evaluations`}
              </div>
              <span className="eyebrow">
                THE SCRIPT · RANDOM TWIST & ENDING GIVEN TO {comparisonModelName}
              </span>
              <p style={{ margin: "6px 0 4px" }}>
                <b>Mid-call twist:</b> {pickInfo.pick?.twist}
              </p>
              <p style={{ margin: 0 }}>
                <b>Hidden ending:</b> {pickInfo.ending?.text}
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
