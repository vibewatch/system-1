"use client";

import React, { useMemo, useState } from "react";
import {
  INDUSTRY_VERTICALS,
  DECISION1_INPUT_PRICE_PER_1M_USD,
  TERRA_INPUT_PRICE_PER_1M_USD,
  TERRA_OUTPUT_PRICE_PER_1M_USD,
  computeCorrectnessSummary,
  computeUseCaseEconomics,
  getScenarioNarrative,
  type CorrectnessSummary,
  type StudioSample,
  type SolutionTestCase,
  type DecisionQuestion,
  type QuestionType,
} from "@/lib/demo-data";
import type { DecisionRunResult } from "@/lib/foundry";
import { CustomSelect, type SelectOption } from "./CustomSelect";
import { Dialog } from "./Dialog";

interface Props {
  allUseCases: StudioSample[];
  comparisonModelName?: string;
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

interface CaseBenchmarkResult {
  caseId: string;
  caseTitle: string;
  scenarioType: string;
  expectedGateVerdict?: string;
  d1LatencyMs: number;
  terraLatencyMs: number;
  summary: CorrectnessSummary;
}

interface SolutionBenchmarkReport {
  solutionId: string;
  running: boolean;
  cases: CaseBenchmarkResult[];
  totalQuestions: number;
  d1TotalCorrect: number;
  d1AccuracyPct: number;
  terraTotalCorrect: number;
  terraAccuracyPct: number;
  agreementPct: number;
  d1AvgMs: number;
  terraAvgMs: number;
  d1Usage?: { input_tokens: number; output_tokens: number };
  terraUsage?: { input_tokens: number; output_tokens: number };
  error?: string;
}

const QUESTION_TYPE_OPTIONS: SelectOption[] = [
  {
    value: "noul",
    label: "NOUL — Calibrated Boolean (Yes / No Probability)",
    badge: "NOUL",
    badgeTone: "d1",
    description: "Returns calibrated P(true) and P(false) in [0, 1]",
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
  onLaunchInStudio,
  onSaveCustomUseCase,
  onDeleteCustomUseCase,
  onRunComparePair,
}: Props) {
  const [selectedIndustry, setSelectedIndustry] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showBuilderModal, setShowBuilderModal] = useState<boolean>(false);

  const [reports, setReports] = useState<
    Record<string, SolutionBenchmarkReport>
  >({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);

  // Custom Solution Builder State
  const [title, setTitle] = useState("Enterprise Vendor Security Gate");
  const [industry, setIndustry] = useState<string>(
    "Financial Services & FinTech"
  );
  const [category, setCategory] = useState("Risk & Compliance Gate");
  const [description, setDescription] = useState(
    "Evaluates vendor security questionnaire responses in one pass using Microsoft-Decision-1 calibrated probabilities."
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
      [uc.id]: {
        solutionId: uc.id,
        running: true,
        cases: [],
        totalQuestions: 0,
        d1TotalCorrect: 0,
        d1AccuracyPct: 0,
        terraTotalCorrect: 0,
        terraAccuracyPct: 0,
        agreementPct: 0,
        d1AvgMs: 0,
        terraAvgMs: 0,
      },
    }));

    const casesToRun: SolutionTestCase[] =
      uc.testCases && uc.testCases.length > 0
        ? uc.testCases
        : [
            {
              id: `${uc.id}-default`,
              title: "Primary Scenario Case",
              scenarioType: "edge" as const,
              content: uc.content,
              expected: uc.expected || {},
              expectedGateVerdict: uc.expectedGateVerdict,
            },
          ];

    try {
      const caseResults: CaseBenchmarkResult[] = [];
      let totalQ = 0;
      let d1Corr = 0;
      let terraCorr = 0;
      let agreeCount = 0;
      let agreeTotal = 0;
      let d1MsSum = 0;
      let terraMsSum = 0;
      let d1TokensIn = 0;
      let d1TokensOut = 0;
      let terraTokensIn = 0;
      let terraTokensOut = 0;

      for (const tc of casesToRun) {
        const data = onRunComparePair
          ? await onRunComparePair(tc.content, uc.questions)
          : await (
              await fetch("/api/compare", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  state: tc.content,
                  questions: uc.questions,
                  mode: "compare",
                }),
              })
            ).json();
        const d1Res = data.decision1;
        const terraRes = data.terra;

        const summary = computeCorrectnessSummary(
          uc.questions,
          tc.expected || uc.expected,
          d1Res?.answers,
          terraRes?.answers
        );

        const d1Ms = d1Res?.latency_ms || 0;
        const terraMs = terraRes?.latency_ms || 0;
        d1MsSum += d1Ms;
        terraMsSum += terraMs;
        if (d1Res?.usage) {
          d1TokensIn += d1Res.usage.input_tokens || 0;
          d1TokensOut += d1Res.usage.output_tokens || 0;
        }
        if (terraRes?.usage) {
          terraTokensIn += terraRes.usage.input_tokens || 0;
          terraTokensOut += terraRes.usage.output_tokens || 0;
        }

        totalQ += summary.totalQuestions;
        d1Corr += summary.d1Correct;
        terraCorr += summary.terraCorrect;
        for (const r of summary.rows) {
          if (r.modelsAgree !== null) {
            agreeTotal++;
            if (r.modelsAgree) agreeCount++;
          }
        }

        caseResults.push({
          caseId: tc.id,
          caseTitle: tc.title,
          scenarioType: tc.scenarioType,
          expectedGateVerdict: tc.expectedGateVerdict,
          d1LatencyMs: d1Ms,
          terraLatencyMs: terraMs,
          summary,
        });
      }

      const n = Math.max(1, caseResults.length);
      setReports((prev) => ({
        ...prev,
        [uc.id]: {
          solutionId: uc.id,
          running: false,
          cases: caseResults,
          totalQuestions: totalQ,
          d1TotalCorrect: d1Corr,
          d1AccuracyPct: totalQ > 0 ? Math.round((d1Corr / totalQ) * 100) : 100,
          terraTotalCorrect: terraCorr,
          terraAccuracyPct:
            totalQ > 0 ? Math.round((terraCorr / totalQ) * 100) : 100,
          agreementPct:
            agreeTotal > 0 ? Math.round((agreeCount / agreeTotal) * 100) : 100,
          d1AvgMs: Math.round(d1MsSum / n),
          terraAvgMs: Math.round(terraMsSum / n),
          d1Usage:
            d1TokensIn > 0
              ? {
                  input_tokens: Math.round(d1TokensIn / n),
                  output_tokens: Math.round(d1TokensOut / n),
                }
              : undefined,
          terraUsage:
            terraTokensIn > 0
              ? {
                  input_tokens: Math.round(terraTokensIn / n),
                  output_tokens: Math.round(terraTokensOut / n),
                }
              : undefined,
        },
      }));
    } catch (err: any) {
      setReports((prev) => ({
        ...prev,
        [uc.id]: {
          solutionId: uc.id,
          running: false,
          cases: [],
          totalQuestions: 0,
          d1TotalCorrect: 0,
          d1AccuracyPct: 0,
          terraTotalCorrect: 0,
          terraAccuracyPct: 0,
          agreementPct: 0,
          d1AvgMs: 0,
          terraAvgMs: 0,
          error: err?.message || "Verification failed",
        },
      }));
    }
  };

  const runBatchSuite = async () => {
    setBatchRunning(true);
    try {
      const queue = filteredUseCases.slice(0, 6);
      for (const uc of queue) {
        await runSolutionBenchmark(uc);
      }
    } finally {
      setBatchRunning(false);
    }
  };

  const aggregateStats = useMemo(() => {
    const completed = Object.values(reports).filter(
      (r) => !r.running && !r.error && r.cases.length > 0
    );
    if (completed.length === 0) return null;
    const totalCases = completed.reduce((acc, r) => acc + r.cases.length, 0);
    const totalQuestions = completed.reduce(
      (acc, r) => acc + r.totalQuestions,
      0
    );
    const d1Correct = completed.reduce((acc, r) => acc + r.d1TotalCorrect, 0);
    const terraCorrect = completed.reduce(
      (acc, r) => acc + r.terraTotalCorrect,
      0
    );
    const avgD1Ms = Math.round(
      completed.reduce((acc, r) => acc + r.d1AvgMs, 0) / completed.length
    );
    const avgTerraMs = Math.round(
      completed.reduce((acc, r) => acc + r.terraAvgMs, 0) / completed.length
    );
    return {
      solutionsTested: completed.length,
      totalCases,
      totalQuestions,
      d1AccuracyPct:
        totalQuestions > 0 ? Math.round((d1Correct / totalQuestions) * 100) : 0,
      terraAccuracyPct:
        totalQuestions > 0
          ? Math.round((terraCorrect / totalQuestions) * 100)
          : 0,
      avgD1Ms,
      avgTerraMs,
      speedup: avgD1Ms > 0 ? (avgTerraMs / avgD1Ms).toFixed(1) : "—",
    };
  }, [reports]);

  const fleetEconomics = useMemo(() => {
    const targetList =
      filteredUseCases.length > 0 ? filteredUseCases : allUseCases;
    let totalD1Per1k = 0;
    let totalTerraPer1k = 0;
    let totalMonthlySaved = 0;
    for (const uc of targetList) {
      const rep = reports[uc.id];
      const eco = computeUseCaseEconomics(uc, rep?.d1Usage, rep?.terraUsage);
      totalD1Per1k += eco.d1CostPer1kUsd;
      totalTerraPer1k += eco.terraCostPer1kUsd;
      totalMonthlySaved += eco.monthlySavingsUsd;
    }
    const count = Math.max(1, targetList.length);
    const avgD1Per1k = totalD1Per1k / count;
    const avgTerraPer1k = totalTerraPer1k / count;
    const savingsPct =
      avgTerraPer1k > 0
        ? Number(((1 - avgD1Per1k / avgTerraPer1k) * 100).toFixed(1))
        : 99.4;
    const costMultiplier =
      avgD1Per1k > 0 ? Math.round(avgTerraPer1k / avgD1Per1k) : 180;
    return {
      avgD1Per1k,
      avgTerraPer1k,
      savingsPct,
      costMultiplier,
      totalMonthlySaved,
    };
  }, [filteredUseCases, allUseCases, reports]);

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
      } else {
        await runSolutionBenchmark(newSample);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="layout single catalog-page" style={{ gap: 24 }}>
      {/* TOP BAR: Title, Industry Filters & Actions */}
      <section className="catalog-heading">
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
              The solution library
            </span>
            <h1
              style={{
                margin: "3px 0 4px",
                fontSize: "clamp(19px, 2vw, 25px)",
                fontWeight: 700,
                letterSpacing: "-0.025em",
              }}
            >
              Find a problem worth testing.
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--text-muted)",
                maxWidth: 740,
              }}
            >
              Explore {allUseCases.length} business scenarios, or bring your own.
              Each one connects a real problem with a capability you can test.
            </p>
          </div>

          <div>
            <button
              type="button"
              className="primary"
              onClick={() => setShowBuilderModal(true)}
            >
              Create your solution &rarr;
            </button>
          </div>
        </div>

        <div className="catalog-filters">
          <input type="text" aria-label="Search solutions" placeholder="Search a problem or industry…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          <CustomSelect value={selectedIndustry} onChange={setSelectedIndustry} minWidth={0} options={[
            { value: "all", label: `All industries (${allUseCases.length})` },
            ...Array.from(new Set(allUseCases.map((uc) => uc.industry).filter((industry): industry is string => Boolean(industry)))).map((industry) => ({ value: industry, label: `${industry} (${industryCounts[industry] || 0})` })),
          ]} />
          <span>{filteredUseCases.length} solutions</span>
        </div>
      </section>

      <details className="catalog-batch-details">
        <summary>Batch verification &amp; cost estimates{batchRunning ? " · Running…" : aggregateStats ? ` · ${aggregateStats.solutionsTested} tested` : ""}</summary>
        <div className="catalog-batch-actions">
          <p>Verify up to six filtered solutions against their expected labels. Cost projections use configured pricing and example traffic volumes.</p>
          <button type="button" className="ghost" disabled={batchRunning || !filteredUseCases.length} onClick={runBatchSuite}>{batchRunning ? "Verifying…" : `Verify ${Math.min(6, filteredUseCases.length)} solutions`}</button>
        </div>
      <section className="wb-proof-strip">
        <div className="wb-proof-cell">
          <div className="wb-proof-label">
            <span>01 · Official Foundry Pricing</span>
            <span>Zero Output Billing</span>
          </div>
          <div className="wb-proof-main">
            <span className="wb-proof-hero accent">
              ${DECISION1_INPUT_PRICE_PER_1M_USD}/1M
            </span>
            <div style={{ textAlign: "right", font: "500 11px var(--mono)" }}>
              <div style={{ color: "var(--primary)", fontWeight: 700 }}>
                Decision-1 Output: $0.00 / 1M
              </div>
              <div style={{ color: "var(--terra)" }}>
                {comparisonModelName}: ${TERRA_INPUT_PRICE_PER_1M_USD}/1M in · $
                {TERRA_OUTPUT_PRICE_PER_1M_USD}/1M out
              </div>
            </div>
          </div>
          <div className="wb-proof-sub">
            <span>Single forward pass</span>
            <span>{fleetEconomics.costMultiplier}× cheaper per call</span>
          </div>
        </div>

        <div className="wb-proof-cell">
          <div className="wb-proof-label">
            <span>02 · Fleet Cost / 1,000 Calls</span>
            <span>Across {filteredUseCases.length} Scenarios</span>
          </div>
          <div className="wb-proof-main">
            <span className="wb-proof-hero accent">
              ${fleetEconomics.avgD1Per1k.toFixed(4)}
            </span>
            <div style={{ textAlign: "right", font: "500 11px var(--mono)" }}>
              <div style={{ color: "var(--primary)", fontWeight: 700 }}>
                Saves {fleetEconomics.savingsPct}% vs LLM
              </div>
              <div style={{ color: "var(--terra)" }}>
                {comparisonModelName}: ${fleetEconomics.avgTerraPer1k.toFixed(2)}{" "}
                / 1k
              </div>
            </div>
          </div>
          <div className="wb-proof-sub">
            <span>Est. fleet savings</span>
            <span>
              $
              {fleetEconomics.totalMonthlySaved.toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })}
              /month
            </span>
          </div>
        </div>

        <div className="wb-proof-cell">
          <div className="wb-proof-label">
            <span>03 · Batch Verification Status</span>
            <span>Ground-Truth Suite</span>
          </div>
          <div className="wb-proof-main">
            <span className="wb-proof-hero accent">
              {aggregateStats ? `${aggregateStats.d1AccuracyPct}%` : "Ready"}
            </span>
            <div style={{ textAlign: "right", font: "500 11px var(--mono)" }}>
              <div style={{ color: "var(--primary)", fontWeight: 700 }}>
                {aggregateStats
                  ? `${aggregateStats.solutionsTested} solutions (${aggregateStats.totalCases} cases)`
                  : "2 cases per solution"}
              </div>
              <div style={{ color: "var(--terra)" }}>
                {aggregateStats
                  ? `Speedup: ${aggregateStats.speedup}× (${aggregateStats.avgD1Ms}ms vs ${aggregateStats.avgTerraMs}ms)`
                  : "Click Verify Suite above"}
              </div>
            </div>
          </div>
          <div className="wb-proof-sub">
            <span>Violation + Compliant pairs</span>
            <span>100% deterministic JSON schema</span>
          </div>
        </div>
      </section>
      </details>

      {!filteredUseCases.length && <div className="catalog-empty"><h2>No matching solutions</h2><p>Try another search or industry.</p><button className="text-button" onClick={() => { setSearchQuery(""); setSelectedIndustry("all"); }}>Clear filters &rarr;</button></div>}
      <div className="uc-grid">
        {filteredUseCases.map((uc) => {
          const rep = reports[uc.id];
          const eco = computeUseCaseEconomics(
            uc,
            rep?.d1Usage,
            rep?.terraUsage
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
                      font: "600 10px var(--mono)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--primary)",
                    }}
                  >
                    {uc.industry || "Enterprise"} · {uc.category}
                  </span>
                  <span
                    style={{
                      font: "500 10.5px var(--mono)",
                      color: "var(--text-dim)",
                    }}
                  >
                    {uc.questions.length} criteria ·{" "}
                    {uc.testCases?.length || 1} cases
                  </span>
                </div>

                <h3 className="uc-title">{uc.label}</h3>

                <p className="uc-desc">{narrative.problemSolved}</p>
                <details className="purpose-disclosure">
                  <summary>Capability &amp; estimated cost</summary>
                  <div className="purpose-content">
                    <p>{narrative.whatItProves}</p>
                    <p>Estimated cost / 1,000 calls: Decision-1 ${eco.d1CostPer1kUsd.toFixed(4)} vs. {comparisonModelName} ${eco.terraCostPer1kUsd.toFixed(2)}. {eco.savingsPct}% estimated savings.</p>
                  </div>
                </details>
              </div>

              {/* Card Footer: Cost Telemetry, Live Accuracy Result, and Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    font: "500 11px var(--mono)",
                    color: "var(--text-muted)",
                    paddingTop: 8,
                    borderTop: "1px solid var(--border-soft)",
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  <span>{uc.testCases?.length || 1} test cases · {uc.questions.length} questions</span>

                  {rep && !rep.running && !rep.error && (
                    <button
                      type="button"
                      className="ghost"
                      style={{ padding: "2px 7px", fontSize: 10.5 }}
                      onClick={() =>
                        setExpandedReportId(isExpanded ? null : uc.id)
                      }
                    >
                      ✓ D1 {rep.d1AccuracyPct}% ({rep.d1AvgMs}ms){" "}
                      {isExpanded ? "▲" : "▼"}
                    </button>
                  )}
                </div>
                {rep?.error && <p role="alert" className="comparison-error">{rep.error}</p>}

                {/* Collapsible Per-Case Verification Breakdown */}
                {rep && !rep.running && !rep.error && isExpanded && (
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-card-soft)",
                      border: "1px solid var(--border)",
                      font: "500 11px var(--mono)",
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
                        <span style={{ color: "var(--primary)", flexShrink: 0 }}>
                          D1 {c.summary.d1Correct}/{c.summary.totalQuestions} (
                          {c.d1LatencyMs}ms)
                        </span>
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
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onLaunchInStudio(uc, false)}
                    >
                      Try this scenario &rarr;
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={rep?.running}
                      onClick={() => runSolutionBenchmark(uc)}
                    >
                      {rep?.running ? "Testing…" : `Verify ${uc.testCases?.length || 1} cases`}
                    </button>
                  </div>

                  {uc.origin === "custom" && (
                    <button
                      type="button"
                      className="ghost"
                      style={{ color: "var(--danger)" }}
                      onClick={() => onDeleteCustomUseCase(uc.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* MODAL DIALOG: Custom Solution Builder */}
      <Dialog open={showBuilderModal} onClose={() => setShowBuilderModal(false)} title="Create your solution" maxWidth={860}>
          <div
            className="builder-content"
          >
            <div className="modal-head">
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  Create Custom Microsoft-Decision-1 Solution
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Define your business scenario, typed questions (Noul / Choice /
                  Score), and expected ground-truth answers
                </div>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setShowBuilderModal(false)}
              >
                Close &times;
              </button>
            </div>

            <div
              className="modal-body"
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      font: "600 10.5px var(--mono)",
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
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      font: "600 10.5px var(--mono)",
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
                      font: "600 10.5px var(--mono)",
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
                    font: "600 10.5px var(--mono)",
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  WHAT PROBLEM THIS SOLVES &amp; WHAT IT PROVES
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
                    font: "600 10.5px var(--mono)",
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  SAMPLE INPUT DOCUMENT (`state`)
                </label>
                <textarea
                  style={{ minHeight: 110, fontFamily: "var(--mono)", fontSize: 12 }}
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
                      font: "600 10.5px var(--mono)",
                      color: "var(--text-muted)",
                    }}
                  >
                    DECISION QUESTIONS &amp; GROUND-TRUTH ANSWERS (
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
                      style={{
                        padding: 10,
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        background: "var(--bg-input)",
                        display: "grid",
                        gridTemplateColumns: "140px 1fr 160px auto",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <input
                        type="text"
                        value={q.label}
                        onChange={(e) =>
                          handleUpdateQuestion(idx, { label: e.target.value })
                        }
                        placeholder="Label"
                        style={{ fontSize: 12 }}
                      />
                      <input
                        type="text"
                        value={q.instructions}
                        onChange={(e) =>
                          handleUpdateQuestion(idx, {
                            instructions: e.target.value,
                          })
                        }
                        placeholder="Question prompt"
                        style={{ fontSize: 12 }}
                      />
                      <input
                        type="text"
                        value={expectedMap[q.id] || ""}
                        onChange={(e) =>
                          setExpectedMap((prev) => ({
                            ...prev,
                            [q.id]: e.target.value,
                          }))
                        }
                        placeholder="Expected (e.g. Yes)"
                        style={{ fontSize: 12, fontFamily: "var(--mono)" }}
                      />
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={() =>
                          setQuestions((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                      >
                        &times;
                      </button>
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
          </div>
      </Dialog>
    </main>
  );
}
