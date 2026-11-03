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
    "runtime" | "studio" | "triage" | "form" | "framework"
  >("runtime");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const [azureConfig, setAzureConfig] = useState<AzureClientConfig>(
    DEFAULT_AZURE_CONFIG
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      {/* Topbar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S1</div>
          <div>
            <span className="brand-title">
              FOUNDRY // SYSTEM-ONE
              <span className="model-vs-badges">
                <span className="model-pill d1">Microsoft-Decision-1</span>
                <span style={{ color: "var(--text-dim)" }}>vs</span>
                <span className="model-pill terra">{comparisonModelLabel}</span>
              </span>
            </span>
            <span className="brand-sub">
              {azureConfig.mode === "frontend"
                ? "Frontend-Only Mode (Default) · Bring Your Own Azure Foundry Endpoint & Entra ID"
                : "Backend Server Mode · Azure AI Foundry + Real-Time WebSocket"}
            </span>
          </div>
        </div>

        <nav className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === "runtime" ? "active" : ""}`}
            onClick={() => setActiveTab("runtime")}
          >
            <span className="num">01</span> Stream + Decide
          </button>
          <button
            className={`nav-tab ${activeTab === "studio" ? "active" : ""}`}
            onClick={() => setActiveTab("studio")}
          >
            <span className="num">02</span> Decision Studio
          </button>
          <button
            className={`nav-tab ${activeTab === "triage" ? "active" : ""}`}
            onClick={() => setActiveTab("triage")}
          >
            <span className="num">03</span> Triage at Scale
          </button>
          <button
            className={`nav-tab ${activeTab === "form" ? "active" : ""}`}
            onClick={() => setActiveTab("form")}
          >
            <span className="num">04</span> Agent Gate &amp; Form
          </button>
          <button
            className={`nav-tab ${activeTab === "framework" ? "active" : ""}`}
            onClick={() => setActiveTab("framework")}
          >
            <span className="num">05</span> Solutions &amp; Benchmarks (
            {allUseCases.length})
          </button>
        </nav>

        <div className="topbar-right">
          <div
            className="pill"
            onClick={() =>
              azureConfig.mode === "frontend" && !isFrontendReady
                ? setSettingsOpen(true)
                : refreshHealth()
            }
            style={{ cursor: "pointer" }}
            title="Click to check connection or configure Azure Foundry Endpoint & Entra ID"
          >
            <span className={`dot ${effectiveReady && health?.ok ? "ok" : "bad"}`} />
            <span>
              {azureConfig.mode === "frontend"
                ? isFrontendReady
                  ? health?.ok
                    ? `FRONTEND DIRECT · D1 ${health.decision_latency_ms}ms`
                    : "FRONTEND DIRECT · Click to Verify"
                  : "FRONTEND MODE · Setup Azure Endpoint"
                : wsConnected
                ? health?.ok
                  ? `BACKEND WS · D1 ${health.decision_latency_ms}ms`
                  : "BACKEND WS · Checking Foundry…"
                : "WS RECONNECTING"}
            </span>
          </div>

          <button
            className="btn btn-primary"
            style={{ padding: "6px 12px", fontSize: "0.74rem" }}
            onClick={() => setSettingsOpen(true)}
          >
            ⚙ Azure Endpoint &amp; Entra ID
          </button>

          <button
            className="ghost"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "☀ Daylight" : "☾ Obsidian"}
          </button>
        </div>
      </header>

      {/* Frontend-Only Mode Onboarding Banner when user hasn't entered endpoint/token yet */}
      {azureConfig.mode === "frontend" && !isFrontendReady && (
        <div
          style={{
            margin: "0 0 14px 0",
            padding: "12px 16px",
            borderRadius: 10,
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.35)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: "0.76rem",
                fontWeight: 700,
                color: "var(--accent-d1)",
              }}
            >
              FRONTEND-ONLY MODE ACTIVE (DEFAULT) — CONNECT YOUR AZURE AI FOUNDRY
              DEPLOYMENT
            </div>
            <div
              style={{
                fontSize: "0.78rem",
                color: "var(--text-secondary)",
                marginTop: 2,
              }}
            >
              Sign in with <b>Microsoft Entra ID</b> (OAuth2 PKCE or Bearer
              token) and configure your Azure AI Foundry endpoint &amp;{" "}
              <code>Microsoft-Decision-1</code> deployment to run 100% in the
              browser — or switch to Backend Server Mode to use the server&apos;s
              pre-authenticated Azure CLI session.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setSettingsOpen(true)}
            >
              Configure Azure Endpoint &amp; Entra ID
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                handleUpdateAzureConfig({
                  ...azureConfig,
                  mode: "backend",
                })
              }
            >
              Switch to Backend Server Mode
            </button>
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

      {/* Footer */}
      <footer className="footer">
        <span>
          Mode:{" "}
          <b>
            {azureConfig.mode === "frontend"
              ? "Frontend-Only Browser Direct (Default)"
              : "Backend Server WebSocket"}
          </b>{" "}
          · Endpoint:{" "}
          <b>
            {azureConfig.mode === "frontend"
              ? azureConfig.endpoint || "(Configure in Azure Settings)"
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
          vs <b>{comparisonModelLabel}</b> · Events: <b>{wsEventCount}</b>
        </span>
      </footer>
    </div>
  );
}
