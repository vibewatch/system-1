"use client";

import React, { useMemo, useState } from "react";
import {
  INDUSTRY_VERTICALS,
  RUNTIME_SCENARIOS,
  DECISION1_INPUT_PRICE_PER_1M_USD,
  TERRA_INPUT_PRICE_PER_1M_USD,
  TERRA_OUTPUT_PRICE_PER_1M_USD,
  computeCorrectnessSummary,
  computeUseCaseEconomics,
  type CorrectnessSummary,
  type StudioSample,
  type SolutionTestCase,
  type UseCaseOrigin,
  type DecisionQuestion,
  type QuestionType,
} from "@/lib/demo-data";
import type { DecisionRunResult } from "@/lib/foundry";
import { CustomSelect, type SelectOption } from "./CustomSelect";

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

const ORIGIN_FILTERS: { id: "all" | UseCaseOrigin; label: string }[] = [
  { id: "all", label: "All Solution Templates" },
  { id: "industry", label: "Enterprise Industry Solutions" },
  { id: "builtin", label: "Core Foundry Benchmarks" },
  { id: "custom", label: "My Custom Solutions" },
];

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

const ORIGIN_OPTIONS: SelectOption[] = [
  {
    value: "custom",
    label: "Custom User Solution",
    badge: "CUSTOM",
    badgeTone: "custom",
  },
  {
    value: "industry",
    label: "Enterprise Industry Solution",
    badge: "INDUSTRY",
    badgeTone: "d1",
  },
  {
    value: "builtin",
    label: "Core Foundry Benchmark",
    badge: "CORE",
    badgeTone: "neutral",
  },
];

export function UseCaseFrameworkView({
  allUseCases,
  comparisonModelName = "gpt-6.1-terra",
  onLaunchInStudio,
  onLaunchRuntimeScenario,
  onSaveCustomUseCase,
  onDeleteCustomUseCase,
  onRunComparePair,
}: Props) {
  const [selectedIndustry, setSelectedIndustry] =
    useState<string>("All Industries");
  const [selectedOrigin, setSelectedOrigin] = useState<"all" | UseCaseOrigin>(
    "all"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showBuilder, setShowBuilder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [builderMessage, setBuilderMessage] = useState<string | null>(null);
  const [benchmarks, setBenchmarks] = useState<
    Record<string, SolutionBenchmarkReport>
  >({});

  // Builder state
  const [draftId, setDraftId] = useState("custom-fraud-gate");
  const [draftLabel, setDraftLabel] = useState(
    "Custom · Real-Time Payment Chargeback & Carding Gate"
  );
  const [draftIndustry, setDraftIndustry] = useState<string>(
    "Financial Services & FinTech"
  );
  const [draftCategory, setDraftCategory] = useState("Risk & Fraud Gate");
  const [draftOrigin, setDraftOrigin] = useState<UseCaseOrigin>("custom");
  const [draftDescription, setDraftDescription] = useState(
    "Screens high-velocity digital goods orders for stolen card indicators, VPN mismatch, and instant gift-card liquidation."
  );
  const [draftCodeRule, setDraftCodeRule] = useState(
    "if (d.vpn_country_mismatch.noul > 0.7 && d.fraud_score.score >= 2.0) holdOrderFor3DS();"
  );
  const [draftContent, setDraftContent] = useState(
    `ORDER #ORD-99412 | Amount: $1,450.00 USD (3x $483 Digital Gift Cards)
Account Age: 14 minutes | Email: x8891_temp@maildrop.cc
Billing Address: 410 Terry Ave N, Seattle, WA 98109 (US)
Session IP Geolocation: Lagos, Nigeria (Commercial Datacenter ASN)
Payment Method: 4th distinct Visa BIN attempted in 3 minutes (3 prior declines for invalid CVV).`
  );
  const [draftExpected, setDraftExpected] = useState<Record<string, string>>({
    order_action: "block_and_lock_account",
    fraud_score: "Confirmed Card Testing|High Risk",
    vpn_country_mismatch: "Yes",
    card_testing_velocity: "Yes",
  });
  const [draftQuestions, setDraftQuestions] = useState<DecisionQuestion[]>([
    {
      id: "order_action",
      label: "Checkout Gate Action",
      type: "choice",
      instructions: "How should the checkout risk engine handle this order?",
      criteria: {
        auto_fulfill: "Low-risk verified customer purchase",
        step_up_3ds_kyc: "Moderate risk; require 3D Secure + ID verification",
        block_and_lock_account:
          "High-confidence carding or account takeover; block immediately",
      },
    },
    {
      id: "fraud_score",
      label: "Chargeback Risk Score",
      type: "score",
      instructions: "What is the chargeback and carding risk level?",
      criteria: ["Clean", "Elevated", "High Risk", "Confirmed Card Testing"],
    },
    {
      id: "vpn_country_mismatch",
      label: "IP vs Billing Country Mismatch?",
      type: "noul",
      instructions:
        "Does the session IP country conflict with the billing address country?",
    },
    {
      id: "card_testing_velocity",
      label: "Multiple Declined Cards?",
      type: "noul",
      instructions:
        "Did the user attempt multiple payment cards with prior CVV declines?",
    },
  ]);

  const industryOptions: SelectOption[] = useMemo(
    () =>
      INDUSTRY_VERTICALS.filter((v) => v !== "All Industries").map((v) => ({
        value: v,
        label: v,
        badge: "SECTOR",
        badgeTone: "neutral" as const,
      })),
    []
  );

  const filteredUseCases = useMemo(() => {
    return allUseCases.filter((uc) => {
      if (
        selectedIndustry !== "All Industries" &&
        uc.industry !== selectedIndustry
      ) {
        return false;
      }
      if (selectedOrigin !== "all" && uc.origin !== selectedOrigin) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${uc.label} ${uc.category} ${uc.industry || ""} ${
          uc.description || ""
        } ${uc.content}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allUseCases, selectedIndustry, selectedOrigin, searchQuery]);

  const countsByIndustry = useMemo(() => {
    const map: Record<string, number> = {
      "All Industries": allUseCases.length,
    };
    for (const v of INDUSTRY_VERTICALS) {
      if (v !== "All Industries") map[v] = 0;
    }
    for (const uc of allUseCases) {
      const ind = uc.industry || "AI Safety & Agent Guardrails";
      map[ind] = (map[ind] || 0) + 1;
    }
    return map;
  }, [allUseCases]);

  const runSolutionBenchmark = async (uc: StudioSample) => {
    if (!onRunComparePair) {
      onLaunchInStudio(uc, true);
      return;
    }
    const cases: SolutionTestCase[] =
      uc.testCases && uc.testCases.length > 0
        ? uc.testCases
        : [
            {
              id: `${uc.id}-default`,
              title: "Primary Test Case",
              scenarioType: "violation",
              content: uc.content,
              expected: uc.expected || {},
              expectedGateVerdict: uc.expectedGateVerdict,
            },
          ];

    setBenchmarks((prev) => ({
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

    try {
      const caseResults: CaseBenchmarkResult[] = [];
      let totalQ = 0;
      let d1Corr = 0;
      let trCorr = 0;
      let agreeCount = 0;
      let agreeTotal = 0;
      let d1MsSum = 0;
      let trMsSum = 0;
      let d1InTok = 0;
      let d1OutTok = 0;
      let trInTok = 0;
      let trOutTok = 0;

      for (const tc of cases) {
        const { decision1, terra } = await onRunComparePair(
          tc.content,
          uc.questions
        );
        const summary = computeCorrectnessSummary(
          uc.questions,
          tc.expected,
          decision1?.answers,
          terra?.answers
        );
        const d1Ms = decision1?.latency_ms || 0;
        const trMs = terra?.latency_ms || 0;
        d1MsSum += d1Ms;
        trMsSum += trMs;
        d1InTok += decision1?.usage?.input_tokens || 0;
        d1OutTok += decision1?.usage?.output_tokens || 0;
        trInTok += terra?.usage?.input_tokens || 0;
        trOutTok += terra?.usage?.output_tokens || 0;
        totalQ += summary.totalQuestions;
        d1Corr += summary.d1Correct;
        trCorr += summary.terraCorrect;
        agreeCount += summary.agreementCount;
        agreeTotal += uc.questions.length;

        caseResults.push({
          caseId: tc.id,
          caseTitle: tc.title,
          scenarioType: tc.scenarioType,
          expectedGateVerdict: tc.expectedGateVerdict,
          d1LatencyMs: d1Ms,
          terraLatencyMs: trMs,
          summary,
        });
      }

      const nCases = Math.max(1, caseResults.length);
      setBenchmarks((prev) => ({
        ...prev,
        [uc.id]: {
          solutionId: uc.id,
          running: false,
          cases: caseResults,
          totalQuestions: totalQ,
          d1TotalCorrect: d1Corr,
          d1AccuracyPct: totalQ > 0 ? Math.round((d1Corr / totalQ) * 100) : 0,
          terraTotalCorrect: trCorr,
          terraAccuracyPct:
            totalQ > 0 ? Math.round((trCorr / totalQ) * 100) : 0,
          agreementPct:
            agreeTotal > 0 ? Math.round((agreeCount / agreeTotal) * 100) : 0,
          d1AvgMs: Math.round(d1MsSum / nCases),
          terraAvgMs: Math.round(trMsSum / nCases),
          d1Usage: {
            input_tokens: Math.round(d1InTok / nCases),
            output_tokens: Math.round(d1OutTok / nCases),
          },
          terraUsage: {
            input_tokens: Math.round(trInTok / nCases),
            output_tokens: Math.round(trOutTok / nCases),
          },
        },
      }));
    } catch (err: any) {
      setBenchmarks((prev) => ({
        ...prev,
        [uc.id]: {
          ...prev[uc.id],
          running: false,
          error:
            err?.message ||
            "Benchmark failed. Configure your Azure Foundry Endpoint & Entra ID in Azure Settings.",
        },
      }));
    }
  };

  const loadIntoBuilder = (uc: StudioSample, asClone = true) => {
    setDraftId(asClone && uc.origin !== "custom" ? `${uc.id}-custom` : uc.id);
    setDraftLabel(
      asClone && uc.origin !== "custom" ? `${uc.label} (Custom)` : uc.label
    );
    setDraftIndustry(uc.industry || "AI Safety & Agent Guardrails");
    setDraftCategory(uc.category);
    setDraftOrigin("custom");
    setDraftDescription(uc.description || "");
    setDraftCodeRule(uc.codeRule || "");
    setDraftContent(uc.content);
    setDraftExpected({ ...(uc.expected || {}) });
    setDraftQuestions(JSON.parse(JSON.stringify(uc.questions)));
    setShowBuilder(true);
    setBuilderMessage(
      `Loaded "${uc.label}" into the Solution Studio. Customize questions, expected ground truth, or payload and click Save.`
    );
  };

  const addQuestion = (type: QuestionType) => {
    const idx = draftQuestions.length + 1;
    const next: DecisionQuestion =
      type === "noul"
        ? {
            id: `check_${idx}`,
            label: `Condition Check #${idx}`,
            type: "noul",
            instructions: "Does the input satisfy this specific condition?",
          }
        : type === "choice"
        ? {
            id: `route_${idx}`,
            label: `Routing Decision #${idx}`,
            type: "choice",
            instructions: "Which path should handle this input?",
            criteria: {
              fast_path: "Standard low-risk path",
              manual_review: "Requires human specialist review",
              reject_gate: "Fails mandatory policy check",
            },
          }
        : {
            id: `rubric_${idx}`,
            label: `Risk Rubric #${idx}`,
            type: "score",
            instructions: "Rate the intensity or severity on a 4-point scale.",
            criteria: ["Low", "Moderate", "High", "Critical"],
          };
    setDraftQuestions([...draftQuestions, next]);
  };

  const updateQuestion = (
    index: number,
    patch: Partial<DecisionQuestion>
  ) => {
    setDraftQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== index) return q;
        const merged = { ...q, ...patch };
        if (patch.type && patch.type !== q.type) {
          if (patch.type === "noul") {
            delete merged.criteria;
          } else if (patch.type === "score") {
            merged.criteria = ["Low", "Moderate", "High", "Critical"];
          } else if (patch.type === "choice") {
            merged.criteria = {
              option_a: "First routing option",
              option_b: "Second routing option",
            };
          }
        }
        return merged;
      })
    );
  };

  const removeQuestion = (index: number) => {
    setDraftQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const buildSampleObject = (): StudioSample => {
    const cleanId =
      draftId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-") || `custom-${Date.now()}`;
    return {
      id: cleanId,
      label: draftLabel.trim() || "Custom Decision Solution",
      category: draftCategory.trim() || "Custom Gate",
      industry: draftIndustry,
      origin: draftOrigin,
      description: draftDescription.trim(),
      codeRule: draftCodeRule.trim() || undefined,
      content: draftContent,
      expected: draftExpected,
      testCases: [
        {
          id: `${cleanId}-case-1`,
          title: "Case 1: Primary Ground-Truth Evaluation Case",
          scenarioType: "violation",
          content: draftContent,
          expected: draftExpected,
        },
      ],
      questions: draftQuestions,
    };
  };

  const handleSave = async (andCompare = false) => {
    setSaving(true);
    setBuilderMessage(null);
    try {
      const sample = buildSampleObject();
      await onSaveCustomUseCase(sample);
      setBuilderMessage(
        `Saved "${sample.label}" with ground-truth expectations to your Solution Library.`
      );
      if (andCompare) {
        onLaunchInStudio(sample, true);
      }
    } finally {
      setSaving(false);
    }
  };

  const originBadge = (origin?: UseCaseOrigin) => {
    if (origin === "industry") {
      return { text: "INDUSTRY SOLUTION", cls: "badge-d1" };
    }
    if (origin === "custom") {
      return { text: "CUSTOM SOLUTION", cls: "badge-custom" };
    }
    return { text: "CORE BENCHMARK", cls: "badge-demo" };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Top Banner */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">
              Microsoft-Decision-1 Industry Solutions &amp; Correctness
              Benchmark Suite
            </div>
            <div className="panel-sub">
              Evaluate multi-case ground-truth accuracy, model-to-model
              agreement, and latency speedup across {allUseCases.length}{" "}
              enterprise decision gates — or build your own solution
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn btn-primary"
              onClick={() => setShowBuilder((v) => !v)}
            >
              {showBuilder
                ? "Hide Solution Studio"
                : "+ Create / Customize Solution"}
            </button>
          </div>
        </div>

        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Filter Bar */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 240px 260px",
              gap: 10,
              alignItems: "center",
            }}
          >
            <input
              type="text"
              className="cselect-search"
              style={{ marginBottom: 0, padding: "9px 12px" }}
              placeholder="Search Microsoft-Decision-1 solutions by industry or guardrail (tool firewall, RAG, SWIFT AML, prior auth, EDR, fab QA)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <CustomSelect
              value={selectedOrigin}
              onChange={(val) =>
                setSelectedOrigin(val as "all" | UseCaseOrigin)
              }
              options={ORIGIN_FILTERS.map((o) => ({
                value: o.id,
                label: o.label,
                badge:
                  o.id === "industry"
                    ? "SECTOR"
                    : o.id === "custom"
                    ? "USER"
                    : undefined,
                badgeTone:
                  o.id === "industry"
                    ? "d1"
                    : o.id === "custom"
                    ? "custom"
                    : "neutral",
              }))}
            />
            <CustomSelect
              value={selectedIndustry}
              onChange={(val) => setSelectedIndustry(val)}
              options={INDUSTRY_VERTICALS.map((ind) => ({
                value: ind,
                label: `${ind} (${countsByIndustry[ind] || 0})`,
              }))}
            />
          </div>

          {/* Industry Pills */}
          <div className="industry-pills">
            {INDUSTRY_VERTICALS.map((ind) => (
              <button
                key={ind}
                type="button"
                className={`industry-pill ${
                  selectedIndustry === ind ? "active" : ""
                }`}
                onClick={() => setSelectedIndustry(ind)}
              >
                {ind} ({countsByIndustry[ind] || 0})
              </button>
            ))}
          </div>

          {/* Microsoft Foundry Pricing & Cost Economics Banner */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 8,
              background: "var(--bg-input)",
              border: "1px solid var(--border-soft)",
              fontFamily: "var(--mono)",
              fontSize: "0.71rem",
            }}
          >
            <span>
              <b style={{ color: "var(--primary-bright)" }}>
                Microsoft-Decision-1 Foundry Pricing:
              </b>{" "}
              <b>${DECISION1_INPUT_PRICE_PER_1M_USD.toFixed(3)} / 1M input tokens</b>{" "}
              &middot;{" "}
              <b style={{ color: "var(--accent-d1)" }}>
                $0.00 / 1M output tokens (FREE)
              </b>
            </span>
            <span style={{ color: "var(--text-muted)" }}>
              vs{" "}
              <b style={{ color: "var(--terra-bright)" }}>
                {comparisonModelName}:
              </b>{" "}
              ${TERRA_INPUT_PRICE_PER_1M_USD.toFixed(2)} / 1M input &middot; $
              {TERRA_OUTPUT_PRICE_PER_1M_USD.toFixed(2)} / 1M output (~130–200&times;
              higher cost per gate)
            </span>
          </div>
        </div>
      </div>

      {/* Interactive Use Case Builder (Expandable) */}
      {showBuilder && (
        <div className="panel" style={{ borderColor: "var(--accent-d1)" }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">
                Interactive Use Case &amp; Industry Solution Builder
              </div>
              <div className="panel-sub">
                Author your own state + typed questions (NOUL, CHOICE, SCORE)
                and compare Microsoft-Decision-1 vs gpt-6.1-terra head-to-head
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                disabled={saving}
                onClick={() => handleSave(false)}
              >
                Save to Library
              </button>
              <button
                className="btn btn-primary"
                disabled={saving}
                onClick={() => handleSave(true)}
              >
                Save &amp; Run Live Comparison &rarr;
              </button>
            </div>
          </div>

          <div className="panel-body">
            {builderMessage && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid rgba(16, 185, 129, 0.35)",
                  background: "var(--accent-d1-soft)",
                  color: "var(--accent-d1)",
                  fontFamily: "var(--mono)",
                  fontSize: "0.74rem",
                }}
              >
                {builderMessage}
              </div>
            )}

            <div className="builder-grid">
              {/* Left Column: Metadata + Input Content */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: "0.66rem",
                        color: "var(--text-muted)",
                        marginBottom: 4,
                      }}
                    >
                      USE CASE TITLE
                    </div>
                    <input
                      className="q-input"
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                    />
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: "0.66rem",
                        color: "var(--text-muted)",
                        marginBottom: 4,
                      }}
                    >
                      UNIQUE ID
                    </div>
                    <input
                      className="q-input"
                      value={draftId}
                      onChange={(e) => setDraftId(e.target.value)}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 10,
                  }}
                >
                  <CustomSelect
                    label="Industry Vertical"
                    value={draftIndustry}
                    onChange={setDraftIndustry}
                    options={industryOptions}
                  />
                  <CustomSelect
                    label="Classification Tag"
                    value={draftOrigin}
                    onChange={(v) => setDraftOrigin(v as UseCaseOrigin)}
                    options={ORIGIN_OPTIONS}
                  />
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: "0.66rem",
                        color: "var(--text-muted)",
                        marginBottom: 4,
                      }}
                    >
                      CATEGORY LABEL
                    </div>
                    <input
                      className="q-input"
                      value={draftCategory}
                      onChange={(e) => setDraftCategory(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.66rem",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    SUMMARY DESCRIPTION
                  </div>
                  <input
                    className="q-input"
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                  />
                </div>

                <div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.66rem",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    DETERMINISTIC APPLICATION CODE RULE (OPTIONAL)
                  </div>
                  <input
                    className="q-input"
                    style={{ fontFamily: "var(--mono)", fontSize: "0.74rem" }}
                    value={draftCodeRule}
                    onChange={(e) => setDraftCodeRule(e.target.value)}
                    placeholder="if (d.risk_check.noul > 0.7) blockAction();"
                  />
                </div>

                <div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.66rem",
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    STATE / DOCUMENT / PAYLOAD TO EVALUATE
                  </div>
                  <textarea
                    className="studio-textarea"
                    style={{ minHeight: 165 }}
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                  />
                </div>
              </div>

              {/* Right Column: Typed Questions Schema Builder */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.7rem",
                      textTransform: "uppercase",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Typed Questions ({draftQuestions.length}) — Single Forward
                    Pass
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "4px 8px", fontSize: "0.68rem" }}
                      onClick={() => addQuestion("noul")}
                    >
                      + NOUL
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "4px 8px", fontSize: "0.68rem" }}
                      onClick={() => addQuestion("choice")}
                    >
                      + CHOICE
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "4px 8px", fontSize: "0.68rem" }}
                      onClick={() => addQuestion("score")}
                    >
                      + SCORE
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    maxHeight: 430,
                    overflowY: "auto",
                    paddingRight: 4,
                  }}
                >
                  {draftQuestions.map((q, idx) => (
                    <div key={idx} className="q-editor-card">
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "140px 1fr 190px auto",
                          gap: 8,
                          marginBottom: 8,
                          alignItems: "center",
                        }}
                      >
                        <input
                          className="q-input"
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: "0.72rem",
                          }}
                          value={q.id}
                          onChange={(e) =>
                            updateQuestion(idx, { id: e.target.value })
                          }
                          placeholder="question_id"
                        />
                        <input
                          className="q-input"
                          value={q.label}
                          onChange={(e) =>
                            updateQuestion(idx, { label: e.target.value })
                          }
                          placeholder="Display Label"
                        />
                        <CustomSelect
                          size="sm"
                          value={q.type}
                          onChange={(val) =>
                            updateQuestion(idx, { type: val as QuestionType })
                          }
                          options={QUESTION_TYPE_OPTIONS}
                        />
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: "5px 8px", fontSize: "0.68rem" }}
                          onClick={() => removeQuestion(idx)}
                        >
                          &times;
                        </button>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 210px",
                          gap: 8,
                          marginBottom: q.type !== "noul" ? 8 : 0,
                        }}
                      >
                        <input
                          className="q-input"
                          value={q.instructions}
                          onChange={(e) =>
                            updateQuestion(idx, {
                              instructions: e.target.value,
                            })
                          }
                          placeholder="Question instructions..."
                        />
                        <input
                          className="q-input"
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: "0.72rem",
                            borderColor: "rgba(16, 185, 129, 0.35)",
                          }}
                          value={draftExpected[q.id] || ""}
                          onChange={(e) =>
                            setDraftExpected((prev) => ({
                              ...prev,
                              [q.id]: e.target.value,
                            }))
                          }
                          placeholder="Expected Ground Truth (e.g. Yes)"
                          title="Expected Ground-Truth Answer for Correctness Scoring"
                        />
                      </div>

                      {q.type === "score" && (
                        <div>
                          <div
                            style={{
                              fontFamily: "var(--mono)",
                              fontSize: "0.63rem",
                              color: "var(--text-muted)",
                              marginBottom: 3,
                            }}
                          >
                            SCORE RUBRIC LEVELS (COMMA-SEPARATED, LOW TO HIGH)
                          </div>
                          <input
                            className="q-input"
                            style={{
                              fontFamily: "var(--mono)",
                              fontSize: "0.72rem",
                            }}
                            value={
                              Array.isArray(q.criteria)
                                ? q.criteria.join(", ")
                                : "Low, Moderate, High, Critical"
                            }
                            onChange={(e) =>
                              updateQuestion(idx, {
                                criteria: e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </div>
                      )}

                      {q.type === "choice" && (
                        <div>
                          <div
                            style={{
                              fontFamily: "var(--mono)",
                              fontSize: "0.63rem",
                              color: "var(--text-muted)",
                              marginBottom: 3,
                            }}
                          >
                            CHOICE OPTIONS (ONE PER LINE: key: description)
                          </div>
                          <textarea
                            className="q-input"
                            style={{
                              fontFamily: "var(--mono)",
                              fontSize: "0.71rem",
                              minHeight: 62,
                            }}
                            value={
                              q.criteria && !Array.isArray(q.criteria)
                                ? Object.entries(q.criteria)
                                    .map(([k, v]) => `${k}: ${v}`)
                                    .join("\n")
                                : ""
                            }
                            onChange={(e) => {
                              const obj: Record<string, string> = {};
                              for (const line of e.target.value.split("\n")) {
                                const colon = line.indexOf(":");
                                if (colon > 0) {
                                  const k = line
                                    .slice(0, colon)
                                    .trim()
                                    .replace(/\s+/g, "_");
                                  const v = line.slice(colon + 1).trim();
                                  if (k) obj[k] = v || k;
                                }
                              }
                              updateQuestion(idx, { criteria: obj });
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Solution Cards Grid */}
      <div className="uc-grid">
        {filteredUseCases.map((uc) => {
          const badge = originBadge(uc.origin);
          const bench = benchmarks[uc.id];
          const numCases = uc.testCases?.length || 1;
          return (
            <div key={uc.id} className="uc-card">
              <div className="uc-card-top">
                <div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.64rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      marginBottom: 3,
                    }}
                  >
                    {uc.industry || "Cross-Industry"} &middot; {uc.category}{" "}
                    &middot;{" "}
                    <b>
                      {numCases} Test Case{numCases > 1 ? "s" : ""}
                    </b>
                  </div>
                  <div className="uc-card-title">{uc.label}</div>
                </div>
                <span className={`cselect-badge ${badge.cls}`}>
                  {badge.text}
                </span>
              </div>

              {uc.description && (
                <div className="uc-card-desc">{uc.description}</div>
              )}

              {/* Questions Pills + Ground Truth Preview */}
              <div className="uc-q-pills">
                {uc.questions.map((q) => (
                  <span
                    key={q.id}
                    className="uc-q-pill"
                    title={
                      uc.expected?.[q.id]
                        ? `Expected Ground Truth: ${uc.expected[q.id]}`
                        : q.instructions
                    }
                  >
                    <span className={`t-${q.type}`}>{q.type}</span>
                    <span>{q.id}</span>
                    {uc.expected?.[q.id] && (
                      <span
                        style={{
                          color: "var(--accent-d1)",
                          opacity: 0.9,
                          fontSize: "0.62rem",
                        }}
                      >
                        ={uc.expected[q.id].split("|")[0]}
                      </span>
                    )}
                  </span>
                ))}
              </div>

              {/* Code rule snippet */}
              {uc.codeRule && (
                <div className="uc-code-rule">
                  <span style={{ color: "var(--text-muted)" }}>// Gate: </span>
                  {uc.codeRule}
                </div>
              )}

              {/* Use Case Cost & Token Economics Card */}
              {(() => {
                const econ = computeUseCaseEconomics(
                  uc,
                  bench?.d1Usage,
                  bench?.terraUsage
                );
                return (
                  <div
                    style={{
                      padding: "9px 11px",
                      borderRadius: 8,
                      background: "rgba(16, 185, 129, 0.05)",
                      border: "1px solid rgba(16, 185, 129, 0.22)",
                      fontFamily: "var(--mono)",
                      fontSize: "0.68rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 6,
                      }}
                    >
                      <span style={{ color: "var(--text-muted)" }}>
                        USE CASE COST (PER 1,000 GATES{" "}
                        {econ.isLiveMeasured ? "· LIVE TOKENS" : "· EST."})
                      </span>
                      <span
                        style={{
                          color: "var(--accent-d1)",
                          fontWeight: 700,
                        }}
                      >
                        {econ.costMultiplier}&times; Cheaper ({econ.savingsPct}%
                        Saved)
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <span>
                        Decision-1:{" "}
                        <b style={{ color: "var(--primary-bright)" }}>
                          ${econ.d1CostPer1kUsd.toFixed(4)} / 1k
                        </b>{" "}
                        <span style={{ color: "var(--text-muted)" }}>
                          ({econ.d1InputTokens} in, $0 out)
                        </span>
                      </span>
                      <span>
                        {comparisonModelName}:{" "}
                        <b style={{ color: "var(--terra-bright)" }}>
                          ${econ.terraCostPer1kUsd.toFixed(3)} / 1k
                        </b>{" "}
                        <span style={{ color: "var(--text-muted)" }}>
                          ({econ.terraInputTokens} in + {econ.terraOutputTokens}{" "}
                          out)
                        </span>
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        paddingTop: 3,
                        borderTop: "1px dashed rgba(16, 185, 129, 0.2)",
                        color: "var(--text-secondary)",
                        fontSize: "0.65rem",
                      }}
                    >
                      <span>
                        At {(econ.dailyVolume / 1000).toFixed(0)}k calls/day: D1{" "}
                        <b>${econ.d1MonthlyUsd.toFixed(2)}/mo</b> vs LLM{" "}
                        <b>${econ.terraMonthlyUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}/mo</b>
                      </span>
                      <span style={{ color: "var(--accent-d1)" }}>
                        Save{" "}
                        <b>
                          $
                          {econ.monthlySavingsUsd.toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })}
                          /mo
                        </b>
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Live Multi-Case Correctness Scorecard */}
              {bench && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "var(--bg-input)",
                    border: "1px solid var(--border)",
                    fontFamily: "var(--mono)",
                    fontSize: "0.7rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {bench.running ? (
                    <div style={{ color: "var(--accent-d1)" }}>
                      Scoring {numCases} test case{numCases > 1 ? "s" : ""} (
                      {numCases * uc.questions.length} typed checks) on
                      Microsoft-Decision-1 vs {comparisonModelName}...
                    </div>
                  ) : bench.error ? (
                    <div style={{ color: "var(--danger)" }}>{bench.error}</div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 8,
                        }}
                      >
                        <span style={{ color: "var(--primary-bright)" }}>
                          <b>
                            Decision-1 Correctness: {bench.d1AccuracyPct}% (
                            {bench.d1TotalCorrect}/{bench.totalQuestions})
                          </b>{" "}
                          &middot; {bench.d1AvgMs}ms
                        </span>
                        <span style={{ color: "var(--terra-bright)" }}>
                          {comparisonModelName}: {bench.terraAccuracyPct}% (
                          {bench.terraTotalCorrect}/{bench.totalQuestions})
                          &middot; {bench.terraAvgMs}ms
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          color: "var(--text-muted)",
                          fontSize: "0.66rem",
                        }}
                      >
                        <span>
                          Model Agreement: <b>{bench.agreementPct}%</b>
                        </span>
                        {bench.d1AvgMs > 0 && bench.terraAvgMs > 0 && (
                          <span style={{ color: "var(--accent-d1)" }}>
                            Speedup:{" "}
                            <b>
                              {(bench.terraAvgMs / bench.d1AvgMs).toFixed(1)}
                              &times; faster
                            </b>
                          </span>
                        )}
                      </div>
                      {bench.cases.map((c) => (
                        <div
                          key={c.caseId}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            paddingTop: 4,
                            borderTop: "1px dashed var(--border-soft)",
                            fontSize: "0.66rem",
                          }}
                        >
                          <span>{c.caseTitle}</span>
                          <span>
                            D1:{" "}
                            <b style={{ color: "var(--primary-bright)" }}>
                              {c.summary.d1Correct}/{c.summary.totalQuestions} ✓
                            </b>{" "}
                            | {comparisonModelName}:{" "}
                            <b style={{ color: "var(--terra-bright)" }}>
                              {c.summary.terraCorrect}/
                              {c.summary.totalQuestions} ✓
                            </b>
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="uc-card-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1, padding: "7px 10px", fontSize: "0.73rem" }}
                  onClick={() => onLaunchInStudio(uc, true)}
                >
                  Evaluate in Studio &rarr;
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "7px 10px", fontSize: "0.72rem" }}
                  disabled={bench?.running}
                  onClick={() => runSolutionBenchmark(uc)}
                  title="Run all ground-truth test cases and measure correctness"
                >
                  {bench?.running
                    ? "Scoring..."
                    : `Score (${numCases} Case${numCases > 1 ? "s" : ""})`}
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "7px 10px", fontSize: "0.72rem" }}
                  onClick={() => loadIntoBuilder(uc, true)}
                >
                  {uc.origin === "custom" ? "Edit" : "Clone"}
                </button>
                {uc.origin === "custom" && (
                  <button
                    type="button"
                    className="btn"
                    style={{
                      padding: "7px 9px",
                      fontSize: "0.72rem",
                      color: "var(--danger)",
                    }}
                    onClick={() => onDeleteCustomUseCase(uc.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Streaming Scenarios Section */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">
              Real-Time Word-by-Word Streaming Scenarios (Stream + Decide)
            </div>
            <div className="panel-sub">
              Includes Microsoft-Decision-1 Autonomous Coding Agent Supervisor
              alongside live customer conversation telemetry
            </div>
          </div>
        </div>
        <div className="panel-body">
          <div className="uc-grid">
            {RUNTIME_SCENARIOS.map((sc) => {
              const badge = originBadge(sc.origin);
              return (
                <div key={sc.id} className="uc-card">
                  <div className="uc-card-top">
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: "0.64rem",
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          marginBottom: 3,
                        }}
                      >
                        {sc.industry || "Streaming Telemetry"}
                      </div>
                      <div className="uc-card-title">{sc.label}</div>
                    </div>
                    <span className={`cselect-badge ${badge.cls}`}>
                      {badge.text}
                    </span>
                  </div>
                  <div className="uc-card-desc">
                    {sc.description || "Real-time word-by-word SystemOne decision evaluation"}
                  </div>
                  <div className="uc-q-pills">
                    {sc.questions.map((q) => (
                      <span key={q.id} className="uc-q-pill">
                        <span className={`t-${q.type}`}>{q.type}</span>
                        <span>{q.id}</span>
                      </span>
                    ))}
                  </div>
                  <div className="uc-card-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: "100%", fontSize: "0.74rem" }}
                      onClick={() => onLaunchRuntimeScenario(sc.id)}
                    >
                      Launch Live Word-by-Word Stream &rarr;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
