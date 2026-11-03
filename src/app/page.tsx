"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import RuntimeView from "@/components/RuntimeView";
import StudioCompareView from "@/components/StudioCompareView";
import TriageScaleView from "@/components/TriageScaleView";
import AgentFormView from "@/components/AgentFormView";
import { UseCaseFrameworkView } from "@/components/UseCaseFrameworkView";
import { AzureSettingsModal } from "@/components/AzureSettingsModal";
import {
  STUDIO_SAMPLES,
  type StudioSample,
  type DecisionQuestion,
} from "@/lib/demo-data";
import {
  DEFAULT_AZURE_CONFIG,
  loadAzureConfig,
  saveAzureConfig,
  BrowserFoundryDispatcher,
  callDecision1Browser,
  callTerraDecisionBrowser,
  type AzureClientConfig,
} from "@/lib/client-foundry";

const CUSTOM_SOLUTIONS_LS_KEY = "ms_decision1_custom_solutions_v1";

export interface WsIncomingMessage {
  event: string;
  data: any;
  ts: number;
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<
    "studio" | "framework" | "runtime" | "triage" | "form"
  >("studio");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [showGuide, setShowGuide] = useState<boolean>(true);

  const [azureConfig, setAzureConfig] = useState<AzureClientConfig>(
    DEFAULT_AZURE_CONFIG
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [demoVideoOpen, setDemoVideoOpen] = useState(false);
  const demoVideoRef = useRef<HTMLVideoElement | null>(null);

  const [customUseCases, setCustomUseCases] = useState<StudioSample[]>([]);
  const [studioExternalSample, setStudioExternalSample] =
    useState<StudioSample | null>(null);
  const [studioExternalTrigger, setStudioExternalTrigger] = useState(0);
  const [runtimeExternalScenarioId, setRuntimeExternalScenarioId] = useState<
    string | null
  >(null);

  const allUseCases = useMemo(() => {
    const customIds = new Set(customUseCases.map((c) => c.id));
    return [
      ...customUseCases,
      ...STUDIO_SAMPLES.filter((s) => !customIds.has(s.id)),
    ];
  }, [customUseCases]);

  useEffect(() => {
    const cfg = loadAzureConfig();
    setAzureConfig(cfg);
  }, []);

  useEffect(() => {
    let localList: StudioSample[] = [];
    try {
      const raw = window.localStorage.getItem(CUSTOM_SOLUTIONS_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) localList = parsed;
      }
    } catch {
      // ignore
    }
    if (localList.length > 0) {
      setCustomUseCases(localList);
    }

    if (loadAzureConfig().mode === "backend") {
      fetch("/api/usecases")
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.customUseCases)) {
            const map = new Map<string, StudioSample>();
            for (const item of [...localList, ...d.customUseCases]) {
              map.set(item.id, item);
            }
            const merged = Array.from(map.values());
            setCustomUseCases(merged);
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleSaveCustomUseCase = useCallback(async (uc: StudioSample) => {
    setCustomUseCases((prev) => {
      const next = [uc, ...prev.filter((item) => item.id !== uc.id)];
      try {
        window.localStorage.setItem(
          CUSTOM_SOLUTIONS_LS_KEY,
          JSON.stringify(next)
        );
      } catch {
        // ignore
      }
      return next;
    });
    try {
      const res = await fetch("/api/usecases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useCase: uc }),
      });
      const data = await res.json();
      if (Array.isArray(data.customUseCases)) {
        setCustomUseCases(data.customUseCases);
      }
    } catch {
      // In pure frontend-only static hosting, localStorage persists the solution
    }
  }, []);

  const handleDeleteCustomUseCase = useCallback(async (id: string) => {
    setCustomUseCases((prev) => {
      const next = prev.filter((item) => item.id !== id);
      try {
        window.localStorage.setItem(
          CUSTOM_SOLUTIONS_LS_KEY,
          JSON.stringify(next)
        );
      } catch {
        // ignore
      }
      return next;
    });
    try {
      const res = await fetch(`/api/usecases?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (Array.isArray(data.customUseCases)) {
        setCustomUseCases(data.customUseCases);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleLaunchInStudio = useCallback(
    (uc: StudioSample, _autoRun = true) => {
      setStudioExternalSample(uc);
      setStudioExternalTrigger((n) => n + 1);
      setActiveTab("studio");
    },
    []
  );

  const handleLaunchRuntimeScenario = useCallback((scenarioId: string) => {
    setRuntimeExternalScenarioId(scenarioId);
    setActiveTab("runtime");
  }, []);

  const [wsConnected, setWsConnected] = useState(false);
  const [wsEventCount, setWsEventCount] = useState(0);
  const [health, setHealth] = useState<{
    ok?: boolean;
    mode?: string;
    endpoint?: string;
    activeDecisionEndpoint?: string;
    decisionDeployment?: string;
    terraDeployment?: string;
    round_trip_ms?: number;
    decision_latency_ms?: number;
    error?: string;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const browserDispatcherRef = useRef<BrowserFoundryDispatcher | null>(null);
  const listenersRef = useRef<Set<(msg: WsIncomingMessage) => void>>(new Set());

  const subscribeWs = useCallback((handler: (msg: WsIncomingMessage) => void) => {
    listenersRef.current.add(handler);
    return () => {
      listenersRef.current.delete(handler);
    };
  }, []);

  // Keep browser dispatcher synced with latest azureConfig
  useEffect(() => {
    if (!browserDispatcherRef.current) {
      browserDispatcherRef.current = new BrowserFoundryDispatcher(
        azureConfig,
        (msg) => {
          setWsEventCount((c) => c + 1);
          if (msg.event === "health_status") {
            setHealth(msg.data);
          }
          listenersRef.current.forEach((fn) => fn(msg));
        }
      );
    } else {
      browserDispatcherRef.current.updateConfig(azureConfig);
    }

    if (azureConfig.mode === "frontend") {
      browserDispatcherRef.current.dispatch("health_check");
    }
  }, [azureConfig]);

  const sendWs = useCallback(
    (action: string, payload: Record<string, any> = {}) => {
      if (azureConfig.mode === "frontend") {
        browserDispatcherRef.current?.dispatch(action, payload);
        return true;
      }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action, payload }));
        return true;
      }
      return false;
    },
    [azureConfig.mode]
  );

  const handleRunComparePair = useCallback(
    async (state: unknown, questions: DecisionQuestion[]) => {
      if (azureConfig.mode === "frontend") {
        const [decision1, terra] = await Promise.all([
          callDecision1Browser(azureConfig, state, questions),
          callTerraDecisionBrowser(azureConfig, state, questions),
        ]);
        return { decision1, terra };
      } else {
        const res = await fetch("/api/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state, questions, mode: "compare" }),
        });
        if (!res.ok) {
          throw new Error(`Compare API failed with HTTP ${res.status}`);
        }
        return await res.json();
      }
    },
    [azureConfig]
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (azureConfig.mode !== "backend") {
      setWsConnected(false);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    let alive = true;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connect = () => {
      if (!alive) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!alive) return;
        setWsConnected(true);
        ws.send(JSON.stringify({ action: "health_check" }));
      };

      ws.onmessage = (ev) => {
        if (!alive) return;
        setWsEventCount((c) => c + 1);
        try {
          const parsed: WsIncomingMessage = JSON.parse(ev.data);
          if (parsed.event === "health_status") {
            setHealth(parsed.data);
          }
          listenersRef.current.forEach((fn) => fn(parsed));
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!alive) return;
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [azureConfig.mode]);

  const refreshHealth = () => {
    sendWs("health_check");
  };

  const handleUpdateAzureConfig = (next: AzureClientConfig) => {
    setAzureConfig(next);
    saveAzureConfig(next);
    if (next.mode === "backend") {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: "health_check" }));
      }
    } else {
      browserDispatcherRef.current?.updateConfig(next);
      browserDispatcherRef.current?.dispatch("health_check");
    }
  };

  const isFrontendReady =
    azureConfig.mode === "frontend" &&
    Boolean(azureConfig.endpoint.trim()) &&
    Boolean(azureConfig.accessToken.trim());

  const effectiveReady =
    azureConfig.mode === "frontend" ? isFrontendReady : wsConnected;

  const comparisonModelLabel =
    azureConfig.mode === "frontend"
      ? azureConfig.terraDeployment || "gpt-6.1-terra"
      : health?.terraDeployment || "gpt-6.1-terra";

  return (
    <div className="app-shell">
      {/* Architectural Single-Row Topbar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">M1</div>
          <div>
            <span className="brand-title">
              Microsoft-Decision-1
              <span className="model-vs-badges">
                <span className="model-pill d1">System-1 Engine</span>
                <span style={{ color: "var(--text-dim)" }}>vs</span>
                <span className="model-pill terra">{comparisonModelLabel}</span>
              </span>
            </span>
            <span className="brand-sub">
              {azureConfig.mode === "backend"
                ? "Frontend + Backend Server (Default) · Azure AI Foundry"
                : "Client-Only Browser Mode · Custom Azure Endpoint & Entra ID"}
            </span>
          </div>
        </div>

        <nav className="nav-tabs" aria-label="Primary Workspaces">
          <button
            className={`nav-tab ${activeTab === "studio" ? "active" : ""}`}
            onClick={() => setActiveTab("studio")}
          >
            <span className="num">01</span> Decision Workbench
          </button>
          <button
            className={`nav-tab ${activeTab === "framework" ? "active" : ""}`}
            onClick={() => setActiveTab("framework")}
          >
            <span className="num">02</span> Industry Catalog ({allUseCases.length})
          </button>
          <button
            className={`nav-tab ${activeTab === "runtime" ? "active" : ""}`}
            onClick={() => setActiveTab("runtime")}
          >
            <span className="num">03</span> Stream + Decide
          </button>
          <button
            className={`nav-tab ${activeTab === "triage" ? "active" : ""}`}
            onClick={() => setActiveTab("triage")}
          >
            <span className="num">04</span> Triage at Scale
          </button>
          <button
            className={`nav-tab ${activeTab === "form" ? "active" : ""}`}
            onClick={() => setActiveTab("form")}
          >
            <span className="num">05</span> Claims Gate &amp; Form
          </button>
        </nav>

        <div className="topbar-right">
          <button
            type="button"
            className="ghost"
            onClick={() => setDemoVideoOpen(true)}
            style={{
              borderColor: "var(--primary)",
              color: "var(--primary)",
              background: "var(--primary-soft)",
              fontWeight: 600,
            }}
            title="Watch the 69-second narrated Playwright product demo (Azure Neural TTS)"
          >
            &#9654; Watch Demo (1:09)
          </button>

          <button
            type="button"
            className="ghost"
            onClick={() => setShowGuide((g) => !g)}
            style={{
              borderColor: showGuide ? "var(--primary)" : "var(--border)",
              color: showGuide ? "var(--primary)" : "var(--text)",
            }}
          >
            {showGuide ? "Hide Guide" : "? Quick Guide"}
          </button>

          <button
            type="button"
            className="pill"
            onClick={() => setSettingsOpen(true)}
            style={{ cursor: "pointer" }}
            title="Configure Execution Mode (Backend Server vs Client-Only Browser) and Azure AI Foundry Credentials"
          >
            <span
              className={`dot ${
                effectiveReady && (health?.ok ?? true) ? "ok" : "warn"
              }`}
            />
            <span>
              {azureConfig.mode === "backend"
                ? wsConnected
                  ? health?.decision_latency_ms
                    ? `Backend Mode · ${health.decision_latency_ms}ms`
                    : "Backend Mode · Connected"
                  : "Backend Mode · Connecting…"
                : isFrontendReady
                ? "Client-Only Mode · Ready"
                : "Client-Only · Setup Endpoint"}
            </span>
            <span style={{ color: "var(--text-dim)", marginLeft: 2 }}>⚙</span>
          </button>

          <button
            type="button"
            className="ghost"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            title="Switch between Editorial Paper (Light) and Matte Graphite (Dark)"
          >
            {theme === "light" ? "Graphite" : "Paper"}
          </button>
        </div>
      </header>

      {/* Collapsible 3-Step User Guide & Architecture Overview */}
      {showGuide && (
        <section className="guide-strip" aria-label="How to use this showcase">
          <div className="guide-strip-inner">
            <div>
              <span className="guide-step-num">Why Microsoft-Decision-1?</span>
              <div className="guide-step-title">
                Deterministic System-1 Decisions in One Forward Pass
              </div>
              <p className="guide-step-desc">
                Evaluates structured questions (<b>Noul</b> yes/no,{" "}
                <b>Choice</b> routing, <b>Score</b> rubrics) in ~260ms with
                calibrated probabilities and <b>$0 output token cost</b>.
              </p>
            </div>

            <div className="guide-step">
              <span className="guide-step-num">Step 01 · Select Scenario</span>
              <div className="guide-step-title">
                Read the Problem &amp; Proof Brief
              </div>
              <p className="guide-step-desc">
                Pick any of the 16 enterprise scenarios on the left to see what
                business bottleneck it solves and what capability of{" "}
                <b>Microsoft-Decision-1</b> it proves.
              </p>
            </div>

            <div className="guide-step">
              <span className="guide-step-num">Step 02 · Switch Test Cases</span>
              <div className="guide-step-title">
                Test Violation vs. Compliant Inputs
              </div>
              <p className="guide-step-desc">
                Toggle between <b>Case 1 (Violation / High-Risk)</b> and{" "}
                <b>Case 2 (Compliant / Safe Pass)</b> and click{" "}
                <b>Run Evaluation</b> to compare live against{" "}
                <code>{comparisonModelLabel}</code>.
              </p>
            </div>

            <div className="guide-step">
              <span className="guide-step-num">Step 03 · Inspect Proof</span>
              <div className="guide-step-title">
                Verify Speed, Accuracy &amp; Cost
              </div>
              <p className="guide-step-desc">
                Review the 3-pillar proof scoreboard (latency speedup,
                ground-truth accuracy, and cost per 1,000 calls) or switch to{" "}
                <b>Client-Only Mode</b> via the top-right{" "}
                <b>Backend Mode ⚙</b> menu.
              </p>
            </div>

            <div>
              <button
                type="button"
                className="ghost"
                style={{ padding: "4px 8px", fontSize: 11.5 }}
                onClick={() => setShowGuide(false)}
                title="Dismiss guide"
              >
                Dismiss &times;
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Compact notice only if user manually switched to Client-Only mode without configuring endpoint yet */}
      {azureConfig.mode === "frontend" && !isFrontendReady && (
        <div className="guide-strip">
          <div
            style={{
              padding: "10px 16px",
              borderRadius: "var(--radius-sm)",
              background: "var(--amber-soft)",
              border: "1px solid var(--amber)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              fontSize: 12.5,
            }}
          >
            <span>
              <b>Client-Only Mode Selected:</b> Enter your Azure AI Foundry
              endpoint and Microsoft Entra ID credentials to run directly in the
              browser, or switch back to the default Backend Server Mode.
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="primary"
                onClick={() => setSettingsOpen(true)}
              >
                Configure Client Endpoint
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  handleUpdateAzureConfig({
                    ...azureConfig,
                    mode: "backend",
                  })
                }
              >
                Use Default Backend Mode
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Showcase Tab */}
      <div style={{ display: activeTab === "runtime" ? "block" : "none" }}>
        <RuntimeView
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
          externalScenarioId={runtimeExternalScenarioId}
        />
      </div>

      <div style={{ display: activeTab === "studio" ? "block" : "none" }}>
        <StudioCompareView
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
          comparisonModelName={comparisonModelLabel}
          endpointUrl={
            azureConfig.mode === "frontend" && azureConfig.endpoint
              ? azureConfig.endpoint
              : health?.endpoint ||
                "https://<your-foundry-resource>.cognitiveservices.azure.com"
          }
          allUseCases={allUseCases}
          externalSample={studioExternalSample}
          externalTrigger={studioExternalTrigger}
          onOpenFramework={() => setActiveTab("framework")}
        />
      </div>

      <div style={{ display: activeTab === "triage" ? "block" : "none" }}>
        <TriageScaleView
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
        />
      </div>

      <div style={{ display: activeTab === "form" ? "block" : "none" }}>
        <AgentFormView
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
        />
      </div>

      <div style={{ display: activeTab === "framework" ? "block" : "none" }}>
        <UseCaseFrameworkView
          allUseCases={allUseCases}
          comparisonModelName={comparisonModelLabel}
          onLaunchInStudio={handleLaunchInStudio}
          onLaunchRuntimeScenario={handleLaunchRuntimeScenario}
          onSaveCustomUseCase={handleSaveCustomUseCase}
          onDeleteCustomUseCase={handleDeleteCustomUseCase}
          onRunComparePair={handleRunComparePair}
        />
      </div>

      <AzureSettingsModal
        open={settingsOpen}
        config={azureConfig}
        onClose={() => setSettingsOpen(false)}
        onSave={handleUpdateAzureConfig}
      />

      {demoVideoOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setDemoVideoOpen(false)}
        >
          <div
            className="modal-card"
            style={{ maxWidth: 1020 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="section-kicker" style={{ marginBottom: 4 }}>
                  Product Tour · Playwright 1080p Cut · Azure Neural TTS Narration
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>
                  Microsoft-Decision-1 Showcase &amp; Live Benchmark (1:09)
                </h3>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a
                  href="./demo-microsoft-decision-1.mp4"
                  download="microsoft-decision-1-demo.mp4"
                  className="ghost"
                  style={{
                    textDecoration: "none",
                    padding: "6px 11px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                    color: "var(--text)",
                  }}
                >
                  Download MP4 (15 MB)
                </a>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setDemoVideoOpen(false)}
                >
                  Close &times;
                </button>
              </div>
            </div>
            <div className="modal-body" style={{ padding: 16 }}>
              <video
                ref={demoVideoRef}
                src="./demo-microsoft-decision-1.mp4"
                controls
                autoPlay
                playsInline
                style={{
                  width: "100%",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  background: "#0D0E0D",
                  display: "block",
                }}
              />
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 12,
                  alignItems: "center",
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "var(--text-dim)",
                    marginRight: 4,
                  }}
                >
                  CHAPTERS:
                </span>
                {[
                  { label: "01 · System-1 Engine (0:00)", sec: 0 },
                  { label: "02 · Live Benchmark & Cost (0:11)", sec: 11.0 },
                  { label: "03 · 16 Industry Solutions (0:24)", sec: 24.2 },
                  { label: "04 · Stream + Decide (0:36)", sec: 35.8 },
                  { label: "05 · Triage at Scale (0:47)", sec: 47.0 },
                  { label: "06 · Backend & Client Modes (0:57)", sec: 57.0 },
                ].map((ch) => (
                  <button
                    key={ch.label}
                    type="button"
                    className="pill"
                    style={{ cursor: "pointer", fontSize: 11 }}
                    onClick={() => {
                      if (demoVideoRef.current) {
                        demoVideoRef.current.currentTime = ch.sec;
                        demoVideoRef.current.play();
                      }
                    }}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <span>
          Execution Mode:{" "}
          <b>
            {azureConfig.mode === "backend"
              ? "Frontend + Backend Server (Default)"
              : "Client-Only Browser Direct"}
          </b>{" "}
          · Endpoint:{" "}
          <b>
            {azureConfig.mode === "frontend"
              ? azureConfig.endpoint || "(Configure in Connection Settings)"
              : health?.endpoint ||
                "https://icsuaaisea.cognitiveservices.azure.com"}
          </b>{" "}
          · Auth: <b>Microsoft Entra ID</b>
        </span>
        <span>
          Models:{" "}
          <b>
            Microsoft-Decision-1 (
            {azureConfig.mode === "frontend"
              ? azureConfig.decisionDeployment
              : health?.decisionDeployment || "Decision-1"}
            )
          </b>{" "}
          vs <b>{comparisonModelLabel}</b> · Pricing: <b>$0.042/1M input · $0 output</b>
        </span>
      </footer>
    </div>
  );
}
