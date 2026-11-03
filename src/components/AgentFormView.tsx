"use client";

import React, { useState, useEffect } from "react";
import { CLAIM_DEMO } from "@/lib/demo-data";
import type { DecisionRunResult } from "@/lib/foundry";

interface AgentFormViewProps {
  sendWs: (action: string, payload?: Record<string, any>) => boolean;
  subscribeWs: (
    handler: (msg: { event: string; data: any; ts: number }) => void
  ) => () => void;
  wsConnected: boolean;
}

interface FilledField {
  name: string;
  label: string;
  value: string;
  confidence: number;
  status: "ok" | "review" | "miss";
  alternatives: string[];
  spans: Array<{ start: number; end: number; text: string }>;
}

interface StepLog {
  icon: string;
  text: string;
  status: string;
  elapsed_ms: number;
}

export default function AgentFormView({
  sendWs,
  subscribeWs,
  wsConnected,
}: AgentFormViewProps) {
  const [emailText, setEmailText] = useState(CLAIM_DEMO.text);
  const [running, setRunning] = useState(false);
  const [d1Gate, setD1Gate] = useState<DecisionRunResult | null>(null);
  const [terraGate, setTerraGate] = useState<DecisionRunResult | null>(null);
  const [filledFields, setFilledFields] = useState<Record<string, FilledField>>(
    {}
  );
  const [steps, setSteps] = useState<StepLog[]>([]);
  const [focusedName, setFocusedName] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    return subscribeWs(({ event, data }) => {
      if (event === "agent_step") {
        setSteps((prev) => [...prev, data]);
      } else if (event === "agent_gates_done") {
        setD1Gate(data.decision1);
        setTerraGate(data.terra);
      } else if (event === "agent_field_filled") {
        setFilledFields((prev) => ({
          ...prev,
          [data.name]: {
            name: data.name,
            label: data.label,
            value: data.value,
            confidence: data.confidence,
            status: data.status,
            alternatives: data.alternatives || [],
            spans: data.spans || [],
          },
        }));
      } else if (event === "agent_done") {
        setRunning(false);
        setDone(!data.cancelled);
      }
    });
  }, [subscribeWs]);

  const runAgent = () => {
    if (!wsConnected) return;
    setRunning(true);
    setD1Gate(null);
    setTerraGate(null);
    setFilledFields({});
    setSteps([]);
    setDone(false);
    if (!sendWs("run_agent_form", { content: emailText })) setRunning(false);
  };

  const renderHighlightedEmail = () => {
    const allSpans: Array<{
      start: number;
      end: number;
      name: string;
      label: string;
      confidence: number;
      status: string;
    }> = [];

    Object.values(filledFields).forEach((f) => {
      (f.spans || []).forEach((sp) => {
        if (
          sp.start >= 0 &&
          sp.end <= emailText.length &&
          sp.end > sp.start
        ) {
          allSpans.push({
            start: sp.start,
            end: sp.end,
            name: f.name,
            label: f.label,
            confidence: f.confidence,
            status: f.status,
          });
        }
      });
    });

    allSpans.sort((a, b) => a.start - b.start);

    if (allSpans.length === 0) {
      return (
        <textarea
          value={emailText}
          onChange={(e) => setEmailText(e.target.value)}
          style={{ minHeight: 380 }}
        />
      );
    }

    const nodes: React.ReactNode[] = [];
    let cur = 0;
    allSpans.forEach((sp, idx) => {
      if (sp.start < cur) return;
      if (sp.start > cur) {
        nodes.push(emailText.slice(cur, sp.start));
      }
      nodes.push(
        <mark
          key={`sp-${idx}`}
          className={`src ${sp.status === "review" ? "review" : ""} ${
            focusedName === sp.name ? "focus" : ""
          }`}
          onClick={() => setFocusedName(sp.name)}
          title={`${sp.label} (${Math.round(sp.confidence * 100)}%)`}
        >
          {emailText.slice(sp.start, sp.end)}
        </mark>
      );
      cur = sp.end;
    });
    if (cur < emailText.length) {
      nodes.push(emailText.slice(cur));
    }

    return (
      <div>
        <div
          style={{
            whiteSpace: "pre-wrap",
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: 14,
            lineHeight: 1.68,
            maxHeight: 420,
            overflow: "auto",
          }}
        >
          {nodes}
        </div>
        <button
          className="ghost"
          onClick={() => setFilledFields({})}
          style={{ marginTop: 8 }}
        >
          Edit Raw Email Text
        </button>
      </div>
    );
  };

  const filledList = Object.values(filledFields);
  const autoFilledCount = filledList.filter((f) => f.status === "ok").length;
  const reviewCount = filledList.filter((f) => f.status === "review").length;
  const missingCount = filledList.filter((f) => f.status === "miss").length;

  return (
    <>
      <section className="hero-banner">
        <div>
          <p className="eyebrow">
            04 · AGENT POLICY GATE & AUTOMATED CLAIM FORM
          </p>
          <h1>
            One unstructured email in.{" "}
            <strong>Policy gates + 13-field form out.</strong>
          </h1>
        </div>
        <button
          className="primary"
          onClick={runAgent}
          disabled={running || !wsConnected}
        >
          {running
            ? "Agent Running over WebSocket…"
            : "▶ Run Claim Agent (Decision-1 + gpt-6.1-terra)"}
        </button>
      </section>

      <main className="layout split-5-7">
        {/* Left: Incoming Customer Email + Agent Trace */}
        <section className="card">
          <div className="card-head">
            <span className="eyebrow">
              01 · INCOMING CLAIM EMAIL{" "}
              <span className="hint">
                Click any field to locate source span
              </span>
            </span>
          </div>
          {renderHighlightedEmail()}

          <div className="card-head sub">
            <span className="eyebrow">AGENT EXECUTION LOG (WEBSOCKET)</span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12.5,
            }}
          >
            {steps.length === 0 ? (
              <span style={{ color: "var(--text-dim)" }}>
                Click <b>Run Claim Agent</b> to watch real-time policy gate &
                extraction steps.
              </span>
            ) : (
              steps.map((s, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "5px 8px",
                    background: "var(--bg-input)",
                    borderRadius: 6,
                  }}
                >
                  <span
                    dangerouslySetInnerHTML={{
                      __html: `${s.icon} ${s.text}`,
                    }}
                  />
                  <span
                    style={{
                      font: "500 10.5px var(--mono)",
                      color: "var(--text-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    +{s.elapsed_ms}ms
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Right: Policy Gates + Motor Claim Form + Reply Draft */}
        <section className="card">
          <div className="card-head">
            <span className="eyebrow">
              02 · STEP 1: POLICY GATES (MICROSOFT-DECISION-1 VS GPT-6.1-TERRA)
            </span>
            <div style={{ font: "600 11px var(--mono)" }}>
              {d1Gate && (
                <span
                  style={{ color: "var(--primary-bright)", marginRight: 12 }}
                >
                  Decision-1: {d1Gate.latency_ms}ms
                </span>
              )}
              {terraGate && (
                <span style={{ color: "var(--terra-bright)" }}>
                  gpt-6.1-terra: {terraGate.latency_ms}ms
                </span>
              )}
            </div>
          </div>

          <div className="dq-grid" style={{ marginBottom: 16 }}>
            {CLAIM_DEMO.gates.map((g) => {
              const d1Ans = d1Gate?.answers?.[g.id];
              const trAns = terraGate?.answers?.[g.id];
              const pct = d1Ans ? Math.round(d1Ans.value * 100) : 0;
              const cls = d1Ans?.cls || "";
              return (
                <div key={g.id} className="dq">
                  <div className="dq-head">
                    <span className="dq-label">{g.label}</span>
                    <span className={`dq-ans ${cls}`}>
                      {d1Ans ? d1Ans.label : "—"}
                    </span>
                  </div>
                  <div
                    className={`dq-meter ${g.type === "score" ? "scale" : cls}`}
                  >
                    <i
                      style={
                        g.type === "score"
                          ? { left: `${pct}%` }
                          : { width: `${pct}%` }
                      }
                    />
                  </div>
                  <div className="dq-foot">
                    <span>D1: {d1Ans ? d1Ans.detail : "—"}</span>
                    <span style={{ color: "var(--terra-bright)" }}>
                      Terra: {trAns ? trAns.label : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card-head sub">
            <span className="eyebrow">
              03 · STEP 2: MOTOR CLAIM FORM · AU-77120-K
            </span>
            {filledList.length > 0 && (
              <span
                style={{
                  font: "600 11px var(--mono)",
                  color: "var(--text-muted)",
                }}
              >
                <b style={{ color: "var(--primary-bright)" }}>
                  {autoFilledCount}
                </b>{" "}
                auto-filled ·{" "}
                <b style={{ color: "var(--amber)" }}>{reviewCount}</b> review ·{" "}
                <b style={{ color: "var(--danger)" }}>{missingCount}</b> missing
              </span>
            )}
          </div>

          <div>
            {CLAIM_DEMO.form.map((s) => {
              const f = filledFields[s.name];
              const stClass = !f
                ? ""
                : f.status === "miss"
                ? "miss"
                : f.status === "review"
                ? "review"
                : "ok";
              const stText = !f
                ? "waiting"
                : f.status === "miss"
                ? "missing"
                : f.status === "review"
                ? `${Math.round(f.confidence * 100)}% · review`
                : `${Math.round(f.confidence * 100)}%`;

              return (
                <div
                  key={s.name}
                  className="frow"
                  onClick={() => f?.spans?.length && setFocusedName(s.name)}
                >
                  <label>{s.label}</label>
                  <input
                    type="text"
                    readOnly
                    value={f ? f.value : ""}
                    placeholder={
                      f?.status === "miss" ? "— not stated in email —" : "…"
                    }
                    style={{
                      borderColor:
                        focusedName === s.name
                          ? "var(--primary-bright)"
                          : undefined,
                    }}
                  />
                  <span className={`st ${stClass}`}>{stText}</span>
                </div>
              );
            })}
          </div>

          {done && (
            <div className="reveal" style={{ marginTop: 16 }}>
              <span className="eyebrow">
                04 · STEP 3: AUTOMATED REPLY DRAFT TO POLICYHOLDER
              </span>
              <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                Dear{" "}
                <b>
                  {filledFields["policyholder name"]?.value || "Daniel Okoro"}
                </b>
                , thank you for reporting the incident on{" "}
                <b>
                  {filledFields["date of incident"]?.value ||
                    "Friday 16 October"}
                </b>{" "}
                involving your{" "}
                <b>{filledFields["vehicle"]?.value || "VW Golf"}</b> (
                <b>{filledFields["registration"]?.value || "LK21 XRT"}</b>).{" "}
                <b>Microsoft-Decision-1</b> confirmed your claim (repair
                estimate{" "}
                <b>{filledFields["repair estimate"]?.value || "£2,340"}</b>, no
                injuries, third-party fault) is{" "}
                <b>Fast-Track Eligible</b>. Please reply with your{" "}
                <b>Police Report Number</b> once it arrives by post so we can
                finalize settlement with{" "}
                <b>
                  {filledFields["other driver insurer"]?.value || "Admiral"}
                </b>
                .
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
