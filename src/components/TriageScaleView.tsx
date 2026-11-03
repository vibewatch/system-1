"use client";

import React, { useState, useEffect, useRef } from "react";
import { TRIAGE_FEED } from "@/lib/demo-data";
import type { ExtractedSpan, NormalizedDecision } from "@/lib/foundry";
import { CustomSelect } from "./CustomSelect";

interface TriageScaleViewProps {
  sendWs: (action: string, payload?: Record<string, any>) => boolean;
  subscribeWs: (
    handler: (msg: { event: string; data: any; ts: number }) => void
  ) => () => void;
  wsConnected: boolean;
  replayMode?: boolean;
}

interface FeedItemState {
  idx: number;
  text: string;
  arrivedAt: number;
  d1?: {
    answers: Record<string, NormalizedDecision>;
    spans: ExtractedSpan[];
    latency_ms: number;
    wait_ms: number;
  };
  terra?: {
    answers: Record<string, NormalizedDecision>;
    latency_ms: number;
    wait_ms: number;
  };
}

export default function TriageScaleView({
  sendWs,
  subscribeWs,
  wsConnected,
  replayMode = false,
}: TriageScaleViewProps) {
  const [rate, setRate] = useState(10);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<Record<number, FeedItemState>>({});
  const [arrivalOrder, setArrivalOrder] = useState<number[]>([]);

  const [arrivedCount, setArrivedCount] = useState(0);
  const [d1DoneCount, setD1DoneCount] = useState(0);
  const [d1WaitTotal, setD1WaitTotal] = useState(0);
  const [terraDoneCount, setTerraDoneCount] = useState(0);
  const [terraWaitTotal, setTerraWaitTotal] = useState(0);
  const [startTime, setStartTime] = useState<number>(0);
  const [recordedElapsedMs, setRecordedElapsedMs] = useState(0);
  const recordedStartRef = useRef(0);

  const [d1FinishInfo, setD1FinishInfo] = useState<{
    terraRemaining: number;
    d1AvgWait: number;
  } | null>(null);

  const terraDoneRef = useRef(0);
  const d1WaitSumRef = useRef(0);

  useEffect(() => {
    return subscribeWs(({ event, data, ts }) => {
      if (replayMode && event.startsWith("triage_")) {
        if (event === "triage_started") recordedStartRef.current = ts;
        setRecordedElapsedMs(Math.max(0, ts - recordedStartRef.current));
      }
      if (event === "triage_started") {
        setRunning(true);
        setItems({});
        setArrivalOrder([]);
        setArrivedCount(0);
        setD1DoneCount(0);
        setD1WaitTotal(0);
        setTerraDoneCount(0);
        setTerraWaitTotal(0);
        setStartTime(Date.now());
        setD1FinishInfo(null);
        terraDoneRef.current = 0;
        d1WaitSumRef.current = 0;
      } else if (event === "triage_arrival") {
        const idx = data.index;
        setArrivedCount(data.arrivedCount || idx + 1);
        setArrivalOrder((prev) =>
          prev.includes(idx) ? prev : [idx, ...prev]
        );
        setItems((prev) => ({
          ...prev,
          [idx]: {
            ...(prev[idx] || {}),
            idx,
            text: data.text,
            arrivedAt: Date.now(),
          },
        }));
      } else if (event === "triage_item_done") {
        const idx = data.index;
        if (data.lane === "decision1") {
          d1WaitSumRef.current += data.wait_ms || 0;
          setD1WaitTotal(d1WaitSumRef.current);
          setD1DoneCount((c) => {
            const next = c + 1;
            if (next === TRIAGE_FEED.messages.length) {
              const rem = TRIAGE_FEED.messages.length - terraDoneRef.current;
              if (rem > 0) {
                setD1FinishInfo({
                  terraRemaining: rem,
                  d1AvgWait: Math.round(d1WaitSumRef.current / next),
                });
              }
            }
            return next;
          });
          setItems((prev) => ({
            ...prev,
            [idx]: {
              ...(prev[idx] || {
                idx,
                text: TRIAGE_FEED.messages[idx],
                arrivedAt: Date.now(),
              }),
              d1: {
                answers: data.answers || {},
                spans: data.spans || [],
                latency_ms: data.latency_ms || 0,
                wait_ms: data.wait_ms || 0,
              },
            },
          }));
        } else if (data.lane === "terra") {
          terraDoneRef.current += 1;
          setTerraDoneCount((c) => c + 1);
          setTerraWaitTotal((w) => w + (data.wait_ms || 0));
          setItems((prev) => ({
            ...prev,
            [idx]: {
              ...(prev[idx] || {
                idx,
                text: TRIAGE_FEED.messages[idx],
                arrivedAt: Date.now(),
              }),
              terra: {
                answers: data.answers || {},
                latency_ms: data.latency_ms || 0,
                wait_ms: data.wait_ms || 0,
              },
            },
          }));
        }
      } else if (event === "triage_done" || event === "triage_stopped") {
        setRunning(false);
      }
    });
  }, [subscribeWs, replayMode]);

  const toggleRun = () => {
    if (running) {
      sendWs("stop_triage");
      setRunning(false);
    } else {
      sendWs("start_triage", { rate, raceTerra: true });
    }
  };

  const N = TRIAGE_FEED.messages.length;
  const elapsedSec = replayMode ? Math.max(0.5, recordedElapsedMs / 1000) : startTime
    ? Math.max(0.5, (Date.now() - startTime) / 1000)
    : 1;
  const d1InQueue = Math.max(0, arrivedCount - d1DoneCount);
  const terraInQueue = Math.max(0, arrivedCount - terraDoneCount);
  const d1AvgWait = d1DoneCount ? Math.round(d1WaitTotal / d1DoneCount) : 0;
  const terraAvgWait = terraDoneCount
    ? Math.round(terraWaitTotal / terraDoneCount)
    : 0;
  const d1Throughput = d1DoneCount
    ? (d1DoneCount / elapsedSec).toFixed(1)
    : "0.0";
  const terraThroughput = terraDoneCount
    ? (terraDoneCount / elapsedSec).toFixed(1)
    : "0.0";

  // Aggregated dashboard metrics from Decision-1 results
  const deptCounts: Record<string, number> = {
    hardware_defect: 0,
    shipping_damage: 0,
    product_inquiry: 0,
    praise_feedback: 0,
  };
  const urgencyCounts = [0, 0, 0, 0];
  let churnCount = 0;
  const entityCounts: Record<string, number> = {};

  Object.values(items).forEach((it) => {
    const ans = it.d1?.answers;
    if (!ans) return;
    const dept = String(ans.department?.key || "");
    if (dept && deptCounts[dept] !== undefined) deptCounts[dept]++;
    const urgIdx = Math.max(
      0,
      Math.min(3, Math.round(ans.severity?.rawScore ?? 0))
    );
    urgencyCounts[urgIdx]++;
    if ((ans.churn_risk?.value ?? 0) >= 0.5) churnCount++;

    (it.d1?.spans || []).forEach((sp) => {
      const k = sp.text.trim();
      if (k) entityCounts[k] = (entityCounts[k] || 0) + 1;
    });
  });

  const topEntities = Object.entries(entityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14);

  return (
    <>
      <section className="hero-banner">
        <div>
          <p className="eyebrow">
            03 · HIGH-THROUGHPUT TRIAGE AT SCALE · QUEUE PHYSICS OVER WEBSOCKET
          </p>
          <h1>
            {N} messages at {rate}/sec.{" "}
            <strong>Watch one queue drain and the other back up.</strong>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ minWidth: 185 }}>
            <CustomSelect
              value={String(rate)}
              disabled={running}
              onChange={(val) => setRate(Number(val))}
              options={[
                {
                  value: "5",
                  label: "5 msgs / sec",
                  badge: "STEADY",
                  badgeTone: "neutral",
                },
                {
                  value: "10",
                  label: "10 msgs / sec",
                  badge: "BURST",
                  badgeTone: "d1",
                },
                {
                  value: "20",
                  label: "20 msgs / sec",
                  badge: "STRESS",
                  badgeTone: "info",
                },
              ]}
            />
          </div>
          <button
            className="primary"
            onClick={toggleRun}
            disabled={!wsConnected}
          >
            {running ? "■ Stop Triage" : `▶ Run ${N} Messages`}
          </button>
        </div>
      </section>

      <main className="layout single">
        {/* Dual Racing Lanes */}
        <section className="fh-lanes">
          <div className="fh-lane d1">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span className="badge">MICROSOFT-DECISION-1</span>
                <span
                  style={{
                    font: "500 11px var(--mono)",
                    color: "var(--text-muted)",
                    marginLeft: 10,
                  }}
                >
                  3 decisions/msg · /providers/microsoft/v1/systemone
                </span>
              </div>
              <b
                style={{
                  color: "var(--primary-bright)",
                  fontFamily: "var(--mono)",
                }}
              >
                8 concurrent workers
              </b>
            </div>

            <div className="fh-progress">
              <i
                className="done-d1"
                style={{ width: `${(d1DoneCount / N) * 100}%` }}
              />
              <i className="q" style={{ width: `${(d1InQueue / N) * 100}%` }} />
            </div>

            <div className="fh-nums">
              <div className="fh-num">
                <span className="v" style={{ color: "var(--primary-bright)" }}>
                  {d1DoneCount}
                  <small style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    /{N}
                  </small>
                </span>
                <span className="k">Processed</span>
              </div>
              <div className="fh-num">
                <span className="v">{d1InQueue}</span>
                <span className="k">In Queue</span>
              </div>
              <div className="fh-num">
                <span className="v">
                  {d1AvgWait ? `${(d1AvgWait / 1000).toFixed(1)}s` : "—"}
                </span>
                <span className="k">Avg Wait</span>
              </div>
              <div className="fh-num">
                <span className="v">{d1Throughput}/s</span>
                <span className="k">Throughput</span>
              </div>
            </div>
          </div>

          <div className="fh-lane terra">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span className="badge terra">GPT-6.1-TERRA</span>
                <span
                  style={{
                    font: "500 11px var(--mono)",
                    color: "var(--text-muted)",
                    marginLeft: 10,
                  }}
                >
                  Same 3 decisions/msg · /openai/v1/responses
                </span>
              </div>
              <b
                style={{
                  color: "var(--terra-bright)",
                  fontFamily: "var(--mono)",
                }}
              >
                4 concurrent workers
              </b>
            </div>

            <div className="fh-progress">
              <i
                className="done-terra"
                style={{ width: `${(terraDoneCount / N) * 100}%` }}
              />
              <i
                className="q"
                style={{ width: `${(terraInQueue / N) * 100}%` }}
              />
            </div>

            <div className="fh-nums">
              <div className="fh-num">
                <span className="v" style={{ color: "var(--terra-bright)" }}>
                  {terraDoneCount}
                  <small style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    /{N}
                  </small>
                </span>
                <span className="k">Processed</span>
              </div>
              <div className="fh-num">
                <span className="v">{terraInQueue}</span>
                <span className="k">In Queue</span>
              </div>
              <div className="fh-num">
                <span className="v">
                  {terraAvgWait ? `${(terraAvgWait / 1000).toFixed(1)}s` : "—"}
                </span>
                <span className="k">Avg Wait</span>
              </div>
              <div className="fh-num">
                <span className="v">{terraThroughput}/s</span>
                <span className="k">Throughput</span>
              </div>
            </div>
          </div>
        </section>

        {d1FinishInfo && (
          <div className="reveal" style={{ marginBottom: 16, marginTop: 0 }}>
            <div className="verdict-big">
              Microsoft-Decision-1 finished all {N} messages ·{" "}
              <span style={{ color: "var(--terra-bright)" }}>
                gpt-6.1-terra still has {d1FinishInfo.terraRemaining} waiting in
                queue
              </span>
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Decision-1 average end-to-end queue + inference wait:{" "}
              <b>{(d1FinishInfo.d1AvgWait / 1000).toFixed(1)}s</b>. Because
              Decision-1 evaluates all criteria in a single forward pass with
              zero token generation loop, queues drain instead of compounding.
            </div>
          </div>
        )}

        <div className="panels two">
          {/* Left: Live Incoming Feed */}
          <section className="card">
            <div className="card-head">
              <span className="eyebrow">
                01 · INCOMING NORTHBREW CUSTOMER FEED ({arrivalOrder.length}/{N}
                )
              </span>
            </div>
            <div className="feed">
              {arrivalOrder.length === 0 ? (
                <div
                  style={{
                    padding: 24,
                    color: "var(--text-muted)",
                    textAlign: "center",
                  }}
                >
                  Click <b>Run {N} Messages</b> above to stream the customer
                  backlog over WebSocket.
                </div>
              ) : (
                arrivalOrder.map((idx) => {
                  const it = items[idx];
                  if (!it) return null;
                  const d1Ans = it.d1?.answers;
                  const trAns = it.terra?.answers;
                  const dept = d1Ans?.department?.label || "…";
                  const urg = d1Ans?.severity?.label || "…";
                  const churn = (d1Ans?.churn_risk?.value ?? 0) >= 0.5;

                  return (
                    <div key={idx} className="fcard">
                      <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                        <span
                          style={{
                            font: "600 10px var(--mono)",
                            color: "var(--text-dim)",
                            marginRight: 8,
                          }}
                        >
                          #{idx + 1}
                        </span>
                        {it.text}
                      </div>
                      <div className="meta">
                        <span style={{ color: "var(--primary-bright)" }}>
                          D1: <b>{dept}</b> · urg <b>{urg}</b>
                          {churn ? " · ⚠️ CHURN RISK" : ""}
                          {it.d1
                            ? ` (${it.d1.latency_ms}ms model / ${(
                                it.d1.wait_ms / 1000
                              ).toFixed(1)}s total)`
                            : " (in queue…)"}
                        </span>
                        <span>|</span>
                        <span style={{ color: "var(--terra-bright)" }}>
                          Terra:{" "}
                          {trAns ? (
                            <>
                              <b>{trAns.department?.label || "—"}</b> · urg{" "}
                              <b>{trAns.severity?.label || "—"}</b> (
                              {it.terra?.latency_ms}ms /{" "}
                              {((it.terra?.wait_ms || 0) / 1000).toFixed(1)}s)
                            </>
                          ) : (
                            "queued…"
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Right: Live Aggregated Dashboard */}
          <section className="card">
            <div className="card-head">
              <span className="eyebrow">02 · LIVE TRIAGE DASHBOARD</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  VOLUME BY NORTHBREW DEPARTMENT (CHOICE)
                </div>
                {Object.entries(deptCounts).map(([k, v]) => {
                  const pct =
                    d1DoneCount > 0 ? Math.round((v / d1DoneCount) * 100) : 0;
                  return (
                    <div
                      key={k}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "135px 1fr 42px",
                        gap: 10,
                        alignItems: "center",
                        marginBottom: 6,
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ fontFamily: "var(--mono)" }}>{k}</span>
                      <div
                        style={{
                          height: 10,
                          background: "var(--track)",
                          borderRadius: 4,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background:
                              "linear-gradient(90deg, var(--primary), var(--cyan))",
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          textAlign: "right",
                        }}
                      >
                        {v}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="panels two">
                <div className="panel" style={{ padding: 12 }}>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    URGENCY DISTRIBUTION (0–3)
                  </div>
                  {[
                    "0 · Positive / Info",
                    "1 · Low",
                    "2 · Medium",
                    "3 · Critical Defect",
                  ].map((lbl, idx) => (
                    <div
                      key={lbl}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        font: "500 12px var(--mono)",
                        padding: "3px 0",
                      }}
                    >
                      <span>{lbl}</span>
                      <b>{urgencyCounts[idx]}</b>
                    </div>
                  ))}
                </div>

                <div className="panel" style={{ padding: 12 }}>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    RETENTION RISK (NOUL &ge; 0.5)
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      font: "600 13px var(--mono)",
                      padding: "6px 0",
                      color: "var(--danger)",
                    }}
                  >
                    <span>⚠️ Churn / Return Risk</span>
                    <b>{churnCount}</b>
                  </div>
                  <div
                    style={{
                      font: "500 11.5px var(--mono)",
                      color: "var(--text-muted)",
                      marginTop: 4,
                    }}
                  >
                    Processed {d1DoneCount}/{N} messages
                  </div>
                </div>
              </div>

              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  EXTRACTED ENTITIES ACROSS STREAM (PRODUCTS / PARTS /
                  COMPETITORS)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {topEntities.length === 0 ? (
                    <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
                      Entities will populate as messages arrive…
                    </span>
                  ) : (
                    topEntities.map(([txt, cnt]) => (
                      <span key={txt} className="echip">
                        {txt}
                        {cnt > 1 && <small>×{cnt}</small>}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
