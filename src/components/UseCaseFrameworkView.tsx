"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  INDUSTRY_VERTICALS,
  DECISION1_INPUT_PRICE_PER_1M_USD,
  TERRA_INPUT_PRICE_PER_1M_USD,
  TERRA_OUTPUT_PRICE_PER_1M_USD,
  computeUseCaseEconomics,
  getScenarioNarrative,
  type StudioSample,
  type DecisionQuestion,
  type QuestionType,
} from "@/lib/demo-data";
import type { DecisionRunResult } from "@/lib/foundry";
import { CustomSelect, type SelectOption } from "./CustomSelect";
import { IconButton } from "./IconButton";
import { Trash2, X } from "lucide-react";
import { Dialog } from "./Dialog";
import { Disclosure } from "./Disclosure";
import { evaluateCatalogSample, summarizeCatalogReports, type CatalogReport } from "@/lib/catalog-evidence";

interface Props {
  allUseCases: StudioSample[];
  comparisonModelName?: string;
  replayMode?: boolean;
  readOnlyCaseIds?: string[];
  onLaunchInStudio: (useCase: StudioSample, autoRun?: boolean) => void;
  onLaunchRuntimeScenario: (scenarioId: string) => void;
  onSaveCustomUseCase: (useCase: StudioSample) => Promise<void>;
  onDeleteCustomUseCase: (id: string) => Promise<void>;
  onRunComparePair?: (
    state: unknown,
    questions: DecisionQuestion[]
  ) => Promise<{
    decision1?: DecisionRunResult;
    terra?: DecisionRunResult;
  }>;
}

const QUESTION_TYPE_OPTIONS: SelectOption[] = [
  {
    value: "noul",
    label: "NOUL — Boolean (Yes / No Probability)",
    badge: "NOUL",
    badgeTone: "d1",
    description: "Returns P(true) and P(false); calibration is not evaluated here",
  },
  {
    value: "choice",
    label: "CHOICE — Multi-Class Categorical Routing",
    badge: "CHOICE",
    badgeTone: "info",
    description: "Selects from named keys with probability distribution",
  },
  {
    value: "score",
    label: "SCORE — Ordinal Rubric Scale (0..N-1)",
    badge: "SCORE",
    badgeTone: "neutral",
    description: "Returns expected value score across ordered rubric levels",
  },
];

export function UseCaseFrameworkView({
  allUseCases,
  comparisonModelName = "gpt-6.1-terra",
  replayMode = false,
  readOnlyCaseIds = [],
  onLaunchInStudio,
  onSaveCustomUseCase,
  onDeleteCustomUseCase,
  onRunComparePair,
}: Props) {
  const [selectedIndustry, setSelectedIndustry] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showBuilderModal, setShowBuilderModal] = useState<boolean>(false);

  const [reports, setReports] = useState<
    Record<string, CatalogReport>
  >({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  useEffect(() => { setReports({}); setExpandedReportId(null); }, [replayMode, allUseCases]);

  // Custom Solution Builder State
  const [title, setTitle] = useState("Enterprise Vendor Security Gate");
  const [industry, setIndustry] = useState<string>(
    "Financial Services & FinTech"
  );
  const [category, setCategory] = useState("Risk & Compliance Gate");
  const [description, setDescription] = useState(
    "Evaluates vendor security questionnaire responses against supplied security criteria."
  );
  const [codeRule, setCodeRule] = useState(
    "if (d.soc2_certified.noul > 0.7 && d.risk_tier.score <= 1.2) approveVendor();"
  );
  const [expectedGateVerdict, setExpectedGateVerdict] = useState(
    "HOLD FOR SECURITY REVIEW"
  );
  const [content, setContent] = useState(
    `VENDOR SECURITY QUESTIONNAIRE — VENDOR: CloudMetrics IO\nData Access: Production Customer Billing Records (PII + PCI)\nSOC2 Type II Status: In progress (expected Q4 next year); no current audit report.\nEncryption: TLS 1.3 in transit, AES-256 at rest.\nSubprocessors: Shares telemetry logs with 3 analytics vendors.\nIncident History: 1 minor credential stuffing incident 8 months ago.`
  );
  const [questions, setQuestions] = useState<DecisionQuestion[]>([
    {
      id: "soc2_certified",
      label: "Active SOC2 Type II?",
      type: "noul",
      instructions:
        "Does the vendor currently hold a completed, active SOC2 Type II certification?",
    },
    {
      id: "handles_regulated_data",
      label: "Processes PII / PCI Data?",
      type: "noul",
      instructions:
        "Will the vendor process sensitive PII or PCI customer billing records?",
    },
    {
      id: "risk_tier",
      label: "Vendor Risk Rubric",
      type: "score",
      instructions: "What is the overall security risk level of onboarding this vendor?",
      criteria: ["Low risk", "Moderate risk", "High risk", "Critical blocker"],
    },
    {
      id: "onboarding_action",
      label: "Onboarding Disposition",
      type: "choice",
      instructions: "How should procurement proceed with this vendor?",
      criteria: {
        fast_track_approve: "Meets all security controls",
        require_ciso_exception:
          "Missing SOC2 while handling PII/PCI; require CISO sign-off",
        reject_vendor: "Unacceptable security posture",
      },
    },
  ]);
  const [expectedMap, setExpectedMap] = useState<Record<string, string>>({
    soc2_certified: "No",
    handles_regulated_data: "Yes",
    risk_tier: "High risk",
    onboarding_action: "require_ciso_exception",
  });
  const [saving, setSaving] = useState(false);

  const filteredUseCases = useMemo(() => {
    return allUseCases.filter((uc) => {
      if (selectedIndustry !== "all" && uc.industry !== selectedIndustry) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${uc.label} ${uc.category} ${uc.industry || ""} ${
          uc.description
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allUseCases, selectedIndustry, searchQuery]);

  const industryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allUseCases.length };
    for (const v of INDUSTRY_VERTICALS) {
      counts[v] = allUseCases.filter((u) => u.industry === v).length;
    }
    return counts;
  }, [allUseCases]);

  const runSolutionBenchmark = async (uc: StudioSample) => {
    setReports((prev) => ({
      ...prev,
      [uc.id]: { solutionId: uc.id, running: true, cases: [] },
    }));
    const report = await evaluateCatalogSample(uc, onRunComparePair || (async (state, questions) => {
      const response = await fetch("/api/compare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, questions, mode: "compare" }),
      });
      if (!response.ok) throw new Error("Comparison request failed");
      return response.json();
    }));
    setReports((prev) => ({ ...prev, [uc.id]: report }));
  };

  const runBatchSuite = async () => {
    setBatchRunning(true);
    try {
      const queue = filteredUseCases.filter((sample) => !replayMode || readOnlyCaseIds.includes(sample.id));
      for (const uc of queue) {
        await runSolutionBenchmark(uc);
      }
    } finally {
      setBatchRunning(false);
    }
  };

  const aggregateStats = summarizeCatalogReports(filteredUseCases.flatMap((sample) => reports[sample.id] ? [reports[sample.id]] : []));
  const runnableCount = filteredUseCases.filter((sample) => !replayMode || readOnlyCaseIds.includes(sample.id)).length;

  const handleAddQuestion = () => {
    const idx = questions.length + 1;
    const qId = `signal_${idx}`;
    setQuestions((prev) => [
      ...prev,
      {
        id: qId,
        label: `Custom Signal ${idx}`,
        type: "noul",
        instructions: "Is this policy condition satisfied in the document?",
      },
    ]);
    setExpectedMap((prev) => ({ ...prev, [qId]: "Yes" }));
  };

  const handleUpdateQuestion = (
    idx: number,
    patch: Partial<DecisionQuestion>
  ) => {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== idx) return q;
        const next = { ...q, ...patch };
        if (patch.type === "noul") {
          delete next.criteria;
        } else if (patch.type === "score" && !Array.isArray(next.criteria)) {
          next.criteria = ["Low", "Moderate", "High", "Critical"];
        } else if (
          patch.type === "choice" &&
          (!next.criteria || Array.isArray(next.criteria))
        ) {
          next.criteria = {
            approve: "Meets all policy criteria",
            review: "Requires human review",
            reject: "Violates policy criteria",
          };
        }
        return next;
      })
    );
  };

  const handleSaveAndRun = async (autoLaunch: boolean) => {
    if (!title.trim() || !content.trim() || questions.length === 0) return;
    setSaving(true);
    try {
      const id = `custom-${title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}-${Date.now().toString().slice(-4)}`;
      const newSample: StudioSample = {
        id,
        label: title.trim(),
        category: category.trim() || "Custom Decision Gate",
        industry,
        origin: "custom",
        description: description.trim(),
        codeRule: codeRule.trim(),
        content,
        expected: expectedMap,
        expectedGateVerdict: expectedGateVerdict.trim(),
        testCases: [
          {
            id: `${id}-case-1`,
            title: "Case 1: Primary Custom Scenario",
            scenarioType: "violation",
            content,
            expected: expectedMap,
            expectedGateVerdict: expectedGateVerdict.trim(),
          },
        ],
        questions,
      };
      await onSaveCustomUseCase(newSample);
      setShowBuilderModal(false);
      if (autoLaunch) {
        onLaunchInStudio(newSample, true);
      } else if (!replayMode) {
        await runSolutionBenchmark(newSample);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="layout single" style={{ gap: 18 }}>
      {/* TOP BAR: Title, Industry Filters & Actions */}
      <section className="card" style={{ padding: "18px 22px", gap: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 14,
          }}
        >
          <div>
            <span className="eyebrow">
              02 · ENTERPRISE SOLUTIONS CATALOG &amp; BATCH VERIFICATION
            </span>
            <h1
              style={{
                margin: "3px 0 4px",
                fontSize: "var(--font-2xl)",
                fontWeight: 700,
                letterSpacing: "-0.025em",
              }}
            >
              {allUseCases.length} Decision Gates Across {new Set(allUseCases.map((sample) => sample.industry).filter(Boolean)).size} Industries
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "var(--font-md)",
                color: "var(--text-muted)",
                maxWidth: 740,
              }}
            >
              Choose a business task. Compare both models on the same inputs and supplied reference answers.
            </p>
          </div>

          <div className="catalog-actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", maxWidth: "100%" }}>
            <input
              type="text"
              placeholder="Search industry or use case…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 210, fontSize: "var(--font-sm)" }}
            />
            <button
              type="button"
              className="ghost"
              disabled={batchRunning || runnableCount === 0 || Object.values(reports).some((report) => report.running)}
              onClick={runBatchSuite}
            >
              {batchRunning
                ? "Verifying Suite…"
                : `${replayMode ? "Replay" : "Verify"} filtered (${runnableCount})`}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setShowBuilderModal(true)}
            >
              + Create Custom Solution
            </button>
          </div>
        </div>
        {replayMode && <p className="detail-note">Recorded suite · original Azure answers, latency and usage. Custom solutions are saved locally; switch to live mode to evaluate new inputs.</p>}

        {/* Industry Filter Bar */}
        <div className="industry-pills">
          <button
            type="button"
            className={`industry-pill ${
              selectedIndustry === "all" ? "active" : ""
            }`}
            onClick={() => setSelectedIndustry("all")}
          >
            All Industries ({industryCounts.all})
          </button>
          {INDUSTRY_VERTICALS.filter((ind) => industryCounts[ind] > 0).map((ind) => (
            <button
              key={ind}
              type="button"
              className={`industry-pill ${
                selectedIndustry === ind ? "active" : ""
              }`}
              onClick={() => setSelectedIndustry(ind)}
            >
              {ind} ({industryCounts[ind] || 0})
            </button>
          ))}
        </div>
      </section>

      <section className="catalog-results" aria-label="Filtered verification results" aria-live="polite">
        <div><span className="eyebrow">{replayMode ? "RECORDED" : "LIVE"} · CURRENT FILTER</span>
          <strong>{aggregateStats.pairs} successful pairs · {aggregateStats.failed} failed / incomplete</strong>
          <small>{filteredUseCases.length} solutions · {filteredUseCases.reduce((sum, sample) => sum + (sample.testCases?.length || 1), 0)} available cases</small></div>
        <div><span className="eyebrow">REFERENCE MATCHES</span>
          <span><b className="d1">Decision-1.1 {aggregateStats.totalQuestions ? `${aggregateStats.d1Correct}/${aggregateStats.totalQuestions}` : "—"}</b>
            <b className="terra">{comparisonModelName} {aggregateStats.totalQuestions ? `${aggregateStats.terraCorrect}/${aggregateStats.totalQuestions}` : "—"}</b></span></div>
        <div><span className="eyebrow">PAIRED REQUEST LATENCY · AVG</span>
          <span><b className="d1">{aggregateStats.d1AvgMs ?? "—"} ms</b><b className="terra">{aggregateStats.terraAvgMs ?? "—"} ms</b></span>
          <small>Failures excluded from both scores and timing.</small></div>
      </section>
      <Disclosure label="Pricing assumptions" className="catalog-pricing">
        <p>Estimated cost = token usage × assumed rates. Not an Azure bill.
          Per 1M tokens: Decision-1.1 ${DECISION1_INPUT_PRICE_PER_1M_USD} input / $0 output;
          {" "}{comparisonModelName} ${TERRA_INPUT_PRICE_PER_1M_USD} input / ${TERRA_OUTPUT_PRICE_PER_1M_USD} output.
          Verify deployment pricing before budgeting. Finite reference examples do not establish general accuracy or probability calibration.</p>
      </Disclosure>

      {/* CLEAN EDITORIAL SOLUTION CARDS GRID */}
      <div className="uc-grid">
        {filteredUseCases.map((uc) => {
          const rep = reports[uc.id];
          const stats = summarizeCatalogReports(rep ? [rep] : []);
          const eco = computeUseCaseEconomics(
            uc,
            stats.d1Usage,
            stats.terraUsage
          );
          const narrative = getScenarioNarrative(uc);
          const isExpanded = expandedReportId === uc.id;

          return (
            <article key={uc.id} className="uc-card">
              <div>
                {/* Header */}
                <div className="uc-meta-row">
                  <span
                    style={{
                      font: "600 var(--font-xs) var(--mono)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--primary)",
                    }}
                  >
                    {uc.industry || "Enterprise"} · {uc.category}
                  </span>
                  <span
                    style={{
                      font: "500 var(--font-xs) var(--mono)",
                      color: "var(--text-dim)",
                    }}
                  >
                    {uc.questions.length} criteria ·{" "}
                    {uc.testCases?.length || 1} cases
                  </span>
                </div>

                <h3 className="uc-title">{uc.label}</h3>

                <p className="catalog-task">{narrative.problemSolved}</p>
                <p className="catalog-capability"><span className="eyebrow">EVALUATES</span> {narrative.whatItProves}</p>
              </div>

              {/* Card Footer: Cost Telemetry, Live Accuracy Result, and Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    font: "500 var(--font-xs) var(--mono)",
                    color: "var(--text-muted)",
                    paddingTop: 8,
                    borderTop: "1px solid var(--border-soft)",
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  <span>
                    Est. / 1k:{" "}
                    <b style={{ color: "var(--primary)" }}>
                      ${eco.d1CostPer1kUsd.toFixed(4)}
                    </b>{" "}
                    vs ${eco.terraCostPer1kUsd.toFixed(2)}
                  </span>

                  {rep && !rep.running && (
                    <button
                      type="button"
                      className="ghost"
                      style={{ padding: "2px 7px", fontSize: "var(--font-xs)" }}
                      onClick={() =>
                        setExpandedReportId(isExpanded ? null : uc.id)
                      }
                    >
                      {stats.pairs} pairs · {stats.failed} failed{" "}
                      {isExpanded ? "▲" : "▼"}
                    </button>
                  )}
                </div>

                {/* Collapsible Per-Case Verification Breakdown */}
                {rep && !rep.running && isExpanded && (
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-card-soft)",
                      border: "1px solid var(--border)",
                      font: "500 var(--font-xs) var(--mono)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {rep.cases.map((c) => (
                      <div
                        key={c.caseId}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.caseTitle}
                        </span>
                        <span>{c.summary ? <>
                          <span className="d1">D1 {c.summary.d1Correct}/{c.summary.totalQuestions} · {c.d1LatencyMs} ms</span>{" / "}
                          <span className="terra">{comparisonModelName} {c.summary.terraCorrect}/{c.summary.totalQuestions} · {c.terraLatencyMs} ms</span>
                        </> : <span className="catalog-failure">{c.failures.join("; ")} · not scored</span>}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => onLaunchInStudio(uc, true)}
                    >
                      Open in Workbench &rarr;
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={rep?.running || batchRunning || (replayMode && !readOnlyCaseIds.includes(uc.id))}
                      onClick={() => runSolutionBenchmark(uc)}
                    >
                      {rep?.running ? "Testing…" : `${replayMode ? "Replay" : "Verify"} ${uc.testCases?.length || 1} Cases`}
                    </button>
                  </div>

                  {uc.origin === "custom" && !readOnlyCaseIds.includes(uc.id) && (
                    <IconButton label={`Delete custom solution: ${uc.label}`} icon={<Trash2 size={16} />} style={{ color: "var(--danger)" }} onClick={() => onDeleteCustomUseCase(uc.id)} />
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {filteredUseCases.length === 0 && <p className="detail-note">No matching solutions. Change the search or industry filter.</p>}
      {showBuilderModal && (
        <Dialog open={showBuilderModal} onClose={() => setShowBuilderModal(false)} title="Custom solution builder" maxWidth={860} className="solution-builder">
            <div className="modal-head">
              <div>
                <div style={{ fontWeight: 700, fontSize: "var(--font-lg)" }}>
                  Create Custom Microsoft-Decision-1.1 Solution
                </div>
                <div style={{ fontSize: "var(--font-sm)", color: "var(--text-muted)" }}>
                  Define your business scenario, typed questions and supplied reference answers.
                </div>
              </div>
              <IconButton label="Close custom solution builder" icon={<X size={18} />} onClick={() => setShowBuilderModal(false)} />
            </div>

            <div
              className="modal-body"
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div
                className="form-grid"
                style={{
                  display: "grid",
                  gap: 10,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      font: "600 var(--font-xs) var(--mono)",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    SOLUTION TITLE
                  </label>
                  <input
                    type="text"
                    style={{ width: "100%" }}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div>
                  <CustomSelect
                    label="Industry Vertical"
                    value={industry}
                    onChange={setIndustry}
                    options={INDUSTRY_VERTICALS.map((v) => ({
                      value: v,
                      label: v,
                      badge: "SECTOR",
                      badgeTone: "d1",
                    }))}
                  />
                </div>
              </div>

              <div
                className="form-grid"
                style={{
                  display: "grid",
                  gap: 10,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      font: "600 var(--font-xs) var(--mono)",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    CATEGORY TAG
                  </label>
                  <input
                    type="text"
                    style={{ width: "100%" }}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      font: "600 var(--font-xs) var(--mono)",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    EXPECTED GATE VERDICT
                  </label>
                  <input
                    type="text"
                    style={{ width: "100%" }}
                    value={expectedGateVerdict}
                    onChange={(e) => setExpectedGateVerdict(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    font: "600 var(--font-xs) var(--mono)",
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  BUSINESS TASK &amp; CAPABILITY UNDER EVALUATION
                </label>
                <input
                  type="text"
                  style={{ width: "100%" }}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    font: "600 var(--font-xs) var(--mono)",
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  SAMPLE INPUT DOCUMENT (`state`)
                </label>
                <textarea
                  style={{ minHeight: 110, fontFamily: "var(--mono)", fontSize: "var(--font-sm)" }}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </div>

              {/* Questions & Ground Truth */}
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      font: "600 var(--font-xs) var(--mono)",
                      color: "var(--text-muted)",
                    }}
                  >
                    DECISION QUESTIONS &amp; REFERENCE ANSWERS (
                    {questions.length})
                  </span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={handleAddQuestion}
                  >
                    + Add Question
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    maxHeight: 240,
                    overflowY: "auto",
                  }}
                >
                  {questions.map((q, idx) => (
                    <div
                      key={idx}
                      className="question-edit-grid"
                      style={{
                        padding: 10,
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        background: "var(--bg-input)",
                        display: "grid",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <input
                        aria-label={`Question ${idx + 1} label`}
                        type="text"
                        value={q.label}
                        onChange={(e) =>
                          handleUpdateQuestion(idx, { label: e.target.value })
                        }
                        placeholder="Label"
                        style={{ fontSize: "var(--font-sm)" }}
                      />
                      <input
                        aria-label={`Question ${idx + 1} instructions`}
                        type="text"
                        value={q.instructions}
                        onChange={(e) =>
                          handleUpdateQuestion(idx, {
                            instructions: e.target.value,
                          })
                        }
                        placeholder="Question prompt"
                        style={{ fontSize: "var(--font-sm)" }}
                      />
                      <input
                        aria-label={`Question ${idx + 1} reference`}
                        type="text"
                        value={expectedMap[q.id] || ""}
                        onChange={(e) =>
                          setExpectedMap((prev) => ({
                            ...prev,
                            [q.id]: e.target.value,
                          }))
                        }
                        placeholder="Expected (e.g. Yes)"
                        style={{ fontSize: "var(--font-sm)", fontFamily: "var(--mono)" }}
                      />
                      <IconButton label={`Remove question: ${q.label}`} icon={<Trash2 size={15} />} onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== idx))} />
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  paddingTop: 10,
                  borderTop: "1px solid var(--border-soft)",
                }}
              >
                <button
                  type="button"
                  className="ghost"
                  disabled={saving}
                  onClick={() => handleSaveAndRun(false)}
                >
                  Save to Catalog
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={saving}
                  onClick={() => handleSaveAndRun(true)}
                >
                  {saving ? "Saving…" : "Save & Open in Workbench"}
                </button>
              </div>
            </div>
        </Dialog>
      )}
    </main>
  );
}
