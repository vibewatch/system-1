"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import RuntimeView from "@/components/RuntimeView";
import StudioCompareView from "@/components/StudioCompareView";
import TriageScaleView from "@/components/TriageScaleView";
import AgentFormView from "@/components/AgentFormView";
import { UseCaseFrameworkView } from "@/components/UseCaseFrameworkView";
import { AzureSettingsModal } from "@/components/AzureSettingsModal";
import { Dialog } from "@/components/Dialog";
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
  const [showGuide, setShowGuide] = useState(false);
  const toolsMenuRef = useRef<HTMLDetailsElement>(null);
  const examplesMenuRef = useRef<HTMLDetailsElement>(null);

  const [azureConfig, setAzureConfig] = useState<AzureClientConfig>(
    DEFAULT_AZURE_CONFIG
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [demoVideoOpen, setDemoVideoOpen] = useState(false);
  const demoVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const closeMenus = (event: MouseEvent | KeyboardEvent) => {
      for (const menu of [toolsMenuRef.current, examplesMenuRef.current]) {
        if (!menu?.open) continue;
        if (event instanceof KeyboardEvent && event.key === "Escape") {
          menu.open = false;
          menu.querySelector("summary")?.focus();
        } else if (event instanceof MouseEvent && !menu.contains(event.target as Node)) {
          menu.open = false;
        }
      }
    };
    document.addEventListener("click", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("click", closeMenus);
      document.removeEventListener("keydown", closeMenus);
    };
  }, []);

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

  const workflowDescriptions = {
    runtime: { title: "Decisions as the conversation unfolds", problem: "Identify changes in intent before a conversation ends.", proof: "Watch structured signals update as new words arrive, rather than waiting for a complete response." },
    triage: { title: "Route a queue, not just one message", problem: "Keep incoming requests from waiting behind a slow classification step.", proof: "Compare queue depth, throughput and response time as the message rate increases." },
    form: { title: "From a claim to a checked next step", problem: "Check insurance policy conditions before drafting a reply.", proof: "Separate structured policy decisions from generated text, with source-linked form fields." },
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Skip to workspace</a>
      <header className="topbar">
        <button className="brand brand-home" onClick={() => setActiveTab("studio")} aria-label="Microsoft-Decision-1 home">
          <div className="brand-mark">M1</div>
          <div>
            <span className="brand-title">
              Microsoft-Decision-1
            </span>
            <span className="brand-sub">A decision lab</span>
          </div>
        </button>

        <nav className="nav-tabs" aria-label="Primary Workspaces">
          <button
            className={`nav-tab ${activeTab === "studio" ? "active" : ""}`}
            onClick={() => setActiveTab("studio")}
            aria-current={activeTab === "studio" ? "page" : undefined}
          >
            Compare
          </button>
          <button
            className={`nav-tab ${activeTab === "framework" ? "active" : ""}`}
            onClick={() => setActiveTab("framework")}
            aria-current={activeTab === "framework" ? "page" : undefined}
          >
            Solutions
          </button>
          <details className="header-menu" ref={examplesMenuRef}>
            <summary className={`nav-tab ${["runtime", "triage", "form"].includes(activeTab) ? "active" : ""}`}>More demos <span aria-hidden="true">⌄</span></summary>
            <div className="header-menu-panel">
              {([["runtime", "Live conversation", "Decide as words arrive"], ["triage", "Queue triage", "Compare throughput at scale"], ["form", "Claims workflow", "Policy gates and form extraction"]] as const).map(([tab, title, description]) =>
                <button key={tab} onClick={() => { setActiveTab(tab); if (examplesMenuRef.current) examplesMenuRef.current.open = false; }} aria-current={activeTab === tab ? "page" : undefined}>
                  <strong>{title}</strong><small>{description}</small>
                </button>
              )}
            </div>
          </details>
        </nav>

        <div className="topbar-right">
          <details className="header-menu" ref={toolsMenuRef}>
            <summary className="tools-trigger">Options <span aria-hidden="true">⌄</span></summary>
            <div className="header-menu-panel tools-panel" onClick={(event) => { if ((event.target as HTMLElement).closest("button") && toolsMenuRef.current) toolsMenuRef.current.open = false; }}>
              <button onClick={() => setSettingsOpen(true)}><strong>Connection settings</strong><small>{azureConfig.mode === "backend" ? "Backend server (default)" : "Client-only browser"} · {effectiveReady && (health?.ok ?? true) ? "Connected" : "Setup needed"}</small></button>
              <button onClick={() => setShowGuide(true)}><strong>How to use this lab</strong><small>A three-step guide</small></button>
              <button onClick={() => setDemoVideoOpen(true)}><strong>Watch the product tour</strong><small>69 seconds · narrated demo</small></button>
              <button onClick={() => setTheme((t) => t === "light" ? "dark" : "light")}><strong>{theme === "light" ? "Switch to dark appearance" : "Switch to light appearance"}</strong></button>
            </div>
          </details>
        </div>
      </header>

      <Dialog open={showGuide} onClose={() => setShowGuide(false)} title="How to use this lab" maxWidth={620}>
        <div className="modal-head"><h2>From a business problem to a decision</h2><button className="ghost" onClick={() => setShowGuide(false)}>Close &times;</button></div>
        <div className="modal-body guide-body">
          <p>Microsoft-Decision-1 answers structured yes/no, routing and rubric questions. This lab compares those decisions with {comparisonModelLabel} on the same input.</p>
          <ol>
            <li><strong>Choose a scenario</strong><p>Start with a business problem. Expand the scenario's purpose to understand which capability is being tested.</p></li>
            <li><strong>Try both test cases</strong><p>Select a high-risk or safe input, then click Compare models. Selecting a scenario alone does not run inference.</p></li>
            <li><strong>Check the decisions first</strong><p>Compare both models with the expected labels. Inspect details for probabilities, token costs and API responses. A passing example is not a model-wide accuracy claim.</p></li>
          </ol>
          <p>Use <b>Solutions</b> to browse industries or create your own scenario. Connection and execution mode are under <b>Options → Connection settings</b>.</p>
          <button className="primary" onClick={() => { setShowGuide(false); setActiveTab("studio"); }}>Start comparing &rarr;</button>
        </div>
      </Dialog>

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

      <div id="workspace-content" tabIndex={-1}>
      {activeTab in workflowDescriptions && (
        <div className="workspace-intro">
          <button className="text-button" onClick={() => setActiveTab("studio")}>&larr; Back to comparison</button>
          <h1>{workflowDescriptions[activeTab as keyof typeof workflowDescriptions].title}</h1>
          <p>{workflowDescriptions[activeTab as keyof typeof workflowDescriptions].problem} {workflowDescriptions[activeTab as keyof typeof workflowDescriptions].proof}</p>
        </div>
      )}
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
          onOpenSettings={() => setSettingsOpen(true)}
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
      </div>

      <AzureSettingsModal
        key={settingsOpen ? "settings-open" : "settings-closed"}
        open={settingsOpen}
        config={azureConfig}
        onClose={() => setSettingsOpen(false)}
        onSave={handleUpdateAzureConfig}
      />

      <Dialog open={demoVideoOpen} onClose={() => setDemoVideoOpen(false)} title="Product tour" maxWidth={1020}>
          <div>
            <div className="modal-head">
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
                  borderRadius: "var(--radius)",
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
      </Dialog>

      {/* Footer */}
      <footer className="footer">
        <span>Microsoft-Decision-1 / Azure AI Foundry</span>
        <button className="text-button" onClick={() => setSettingsOpen(true)}>
          <span className={`dot ${effectiveReady && (health?.ok ?? true) ? "ok" : "warn"}`} />
          {azureConfig.mode === "backend" ? "Backend server" : "Client-only"} · {effectiveReady && (health?.ok ?? true) ? "Connected" : "Setup needed"}
        </button>
      </footer>
    </div>
  );
}
