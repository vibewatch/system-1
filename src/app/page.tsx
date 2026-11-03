"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import RuntimeView from "@/components/RuntimeView";
import StudioCompareView from "@/components/StudioCompareView";
import TriageScaleView from "@/components/TriageScaleView";
import AgentFormView from "@/components/AgentFormView";
import { UseCaseFrameworkView } from "@/components/UseCaseFrameworkView";
import { AzureSettingsModal } from "@/components/AzureSettingsModal";
import { Dialog } from "@/components/Dialog";
import { ReplayControls } from "@/components/ReplayControls";
import { ReplayDispatcher, parseReplayBundle, type ReplayBundle, type ReplayProgress } from "@/lib/replay";
import {
  RUNTIME_SCENARIOS,
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
const REPLAY_STORAGE_KEY = "ms_decision1_replay_enabled_v1";
const REPLAY_URL = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/replays/showcase.json`;

export interface WsIncomingMessage {
  event: string;
  data: any;
  ts: number;
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<
    "studio" | "framework" | "runtime" | "triage" | "form"
  >("runtime");
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
  const [configLoaded, setConfigLoaded] = useState(false);
  const [replayEnabled, setReplayEnabled] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayBundle, setReplayBundle] = useState<ReplayBundle | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState("");
  const [replayProgress, setReplayProgress] = useState<ReplayProgress | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const replayDispatcherRef = useRef<ReplayDispatcher | null>(null);
  const replayLoadRef = useRef(false);
  const replayEnabledRef = useRef(replayEnabled);
  replayEnabledRef.current = replayEnabled;

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
  const [pendingStory, setPendingStory] = useState<string | null>(null);
  const [runtimeLaunchKey, setRuntimeLaunchKey] = useState(0);

  const allUseCases = useMemo(() => {
    if (replayEnabled && replayBundle) return replayBundle.scenarios;
    const customIds = new Set(customUseCases.map((c) => c.id));
    return [
      ...customUseCases,
      ...STUDIO_SAMPLES.filter((s) => !customIds.has(s.id)),
    ];
  }, [customUseCases, replayEnabled, replayBundle]);

  useEffect(() => {
    const cfg = loadAzureConfig();
    setAzureConfig(cfg);
    try { setReplayEnabled(window.localStorage.getItem(REPLAY_STORAGE_KEY) === "true"); } catch {}
    setConfigLoaded(true);
  }, []);

  const loadReplay = useCallback(async (file?: File) => {
    if (replayLoadRef.current) return;
    replayLoadRef.current = true;
    setReplayLoading(true);
    setReplayError("");
    try {
      let value: unknown;
      if (file) {
        if (file.size > 25 * 1024 * 1024) throw new Error("Replay files must be smaller than 25 MB.");
        value = JSON.parse(await file.text());
      } else {
        const response = await fetch(REPLAY_URL);
        if (!response.ok) throw new Error(`Could not load recordings (HTTP ${response.status}). You can import a downloaded replay file.`);
        value = await response.json();
      }
      setReplayBundle(parseReplayBundle(value));
    } catch (error) {
      setReplayError((error as Error).message);
    } finally {
      replayLoadRef.current = false;
      setReplayLoading(false);
    }
  }, []);

  useEffect(() => {
    if ((replayEnabled || replayOpen) && !replayBundle && !replayLoading && !replayError) void loadReplay();
  }, [replayEnabled, replayOpen, replayBundle, replayLoading, replayError, loadReplay]);

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

    let savedReplay = false;
    try { savedReplay = window.localStorage.getItem(REPLAY_STORAGE_KEY) === "true"; } catch {}
    if (loadAzureConfig().mode === "backend" && !savedReplay) {
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
    if (replayEnabled) return;
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
  }, [replayEnabled]);

  const handleDeleteCustomUseCase = useCallback(async (id: string) => {
    if (replayEnabled) return;
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
  }, [replayEnabled]);

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

  useEffect(() => {
    if (!replayEnabled || !replayBundle) return;
    const dispatcher = new ReplayDispatcher(replayBundle, (message) => {
      if (message.event === "health_status") setHealth(message.data);
      if (message.event === "error") setReplayError(message.data.message);
      listenersRef.current.forEach((handler) => handler(message));
    }, setReplayProgress);
    replayDispatcherRef.current = dispatcher;
    dispatcher.setSpeed(replaySpeed);
    dispatcher.dispatch("health_check");
    return () => {
      dispatcher.stop();
      replayDispatcherRef.current = null;
    };
    // Playback speed is updated independently so it does not reset a recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayEnabled, replayBundle]);

  useEffect(() => {
    if (!pendingStory || !replayEnabled || !replayBundle || activeTab !== "runtime") return;
    const scenario = RUNTIME_SCENARIOS.find((item) => item.id === pendingStory);
    const timer = window.setTimeout(() => {
      setReplayError("");
      replayDispatcherRef.current?.dispatch("start_runtime", {
        scenarioId: pendingStory, questions: scenario?.questions || [],
      });
      setPendingStory(null);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [pendingStory, replayEnabled, replayBundle, activeTab, runtimeLaunchKey]);

  const playRecordedStory = (scenarioId: string) => {
    if (pendingStory) return;
    replayDispatcherRef.current?.stop();
    setActiveTab("runtime");
    setRuntimeExternalScenarioId(scenarioId);
    setRuntimeLaunchKey((key) => key + 1);
    setPendingStory(scenarioId);
    setReplayError("");
    setReplayEnabled(true);
    try { window.localStorage.setItem(REPLAY_STORAGE_KEY, "true"); } catch {}
    if (!replayBundle) void loadReplay();
  };

  useEffect(() => {
    if (pendingStory && replayError && !replayLoading) setPendingStory(null);
  }, [pendingStory, replayError, replayLoading]);

  useEffect(() => {
    replayDispatcherRef.current?.setSpeed(replaySpeed);
  }, [replaySpeed]);

  // Keep browser dispatcher synced with latest azureConfig
  useEffect(() => {
    if (!browserDispatcherRef.current) {
      browserDispatcherRef.current = new BrowserFoundryDispatcher(
        azureConfig,
        (msg) => {
          if (replayEnabledRef.current) return;
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

    if (configLoaded && !replayEnabled && azureConfig.mode === "frontend") {
      browserDispatcherRef.current.dispatch("health_check");
    }
  }, [azureConfig, configLoaded, replayEnabled]);

  const sendWs = useCallback(
    (action: string, payload: Record<string, any> = {}) => {
      if (replayEnabled) {
        setReplayError("");
        return replayDispatcherRef.current?.dispatch(action, payload) ?? false;
      }
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
    [azureConfig.mode, replayEnabled]
  );

  const handleRunComparePair = useCallback(
    async (state: unknown, questions: DecisionQuestion[]) => {
      if (replayEnabled) {
        if (!replayDispatcherRef.current) throw new Error("Load a replay file before verifying a suite.");
        return replayDispatcherRef.current.comparePair(state, questions);
      }
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
    [azureConfig, replayEnabled]
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!configLoaded || replayEnabled || azureConfig.mode !== "backend") {
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
        if (!alive || replayEnabledRef.current) return;
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
  }, [azureConfig.mode, replayEnabled, configLoaded]);

  const refreshHealth = () => {
    sendWs("health_check");
  };

  const handleUpdateAzureConfig = (next: AzureClientConfig) => {
    setReplayEnabled(false);
    setReplayError("");
    try { window.localStorage.setItem(REPLAY_STORAGE_KEY, "false"); } catch {}
    setAzureConfig(next);
    saveAzureConfig(next);
    if (next.mode === "backend") {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: "health_check" }));
      }
    }
  };

  const isFrontendReady =
    azureConfig.mode === "frontend" &&
    Boolean(azureConfig.endpoint.trim()) &&
    Boolean(azureConfig.accessToken.trim());

  const effectiveReady =
    replayEnabled ? Boolean(replayBundle && !replayLoading) : azureConfig.mode === "frontend" ? isFrontendReady : wsConnected;

  const comparisonModelLabel =
    replayEnabled && replayBundle ? replayBundle.models.terra : azureConfig.mode === "frontend"
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
        <button className="brand brand-home" onClick={() => setActiveTab("runtime")} aria-label="Microsoft-Decision-1 home">
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
            className={`nav-tab ${activeTab === "runtime" ? "active" : ""}`}
            onClick={() => setActiveTab("runtime")}
            aria-current={activeTab === "runtime" ? "page" : undefined}
          >
            Live story
          </button>
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
            <summary className={`nav-tab ${["triage", "form"].includes(activeTab) ? "active" : ""}`}>More demos <span aria-hidden="true">⌄</span></summary>
            <div className="header-menu-panel">
              {([["triage", "Queue triage", "Compare throughput at scale"], ["form", "Claims workflow", "Policy gates and form extraction"]] as const).map(([tab, title, description]) =>
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
              <button onClick={() => setReplayOpen(true)}><strong>Demo replay</strong><small>{replayEnabled ? "Recorded playback enabled" : "Use recorded results · no Azure calls"}</small></button>
              <button onClick={() => setShowGuide(true)}><strong>How to use this lab</strong><small>A three-step guide</small></button>
              <button onClick={() => setDemoVideoOpen(true)}><strong>Watch the product tour</strong><small>69 seconds · narrated demo</small></button>
              <button onClick={() => setTheme((t) => t === "light" ? "dark" : "light")}><strong>{theme === "light" ? "Switch to dark appearance" : "Switch to light appearance"}</strong></button>
            </div>
          </details>
        </div>
      </header>

      {replayEnabled && <div className="replay-banner">
        <div><strong>Recorded replay</strong><span>{replayBundle ? `Azure run from ${new Date(replayBundle.recordedAt).toLocaleDateString()} · no live model calls` : "Loading recordings…"}</span></div>
        {replayProgress && <span className="replay-progress-label">{replayProgress.paused ? "Paused" : replayProgress.playing ? "Playing" : "Complete"} · {(replayProgress.elapsedMs / 1000).toFixed(1)}s / {(replayProgress.durationMs / 1000).toFixed(1)}s</span>}
        {replayProgress?.playing && <button className="text-button" onClick={() => replayProgress.paused ? replayDispatcherRef.current?.resume() : replayDispatcherRef.current?.pause()}>{replayProgress.paused ? "Resume" : "Pause"}</button>}
        <button className="text-button" onClick={() => setReplayOpen(true)}>Replay controls</button>
        {replayError && <p role="alert" className="comparison-error">{replayError}</p>}
      </div>}

      <ReplayControls
        open={replayOpen} onClose={() => setReplayOpen(false)} bundle={replayBundle} enabled={replayEnabled}
        loading={replayLoading} error={replayError} progress={replayProgress} speed={replaySpeed}
        onEnable={(enabled) => {
          setPendingStory(null);
          setReplayEnabled(enabled);
          setReplayError("");
          setActiveTab("studio");
          setStudioExternalSample(null);
          setStudioExternalTrigger(0);
          try { window.localStorage.setItem(REPLAY_STORAGE_KEY, String(enabled)); } catch {}
        }}
        onLoadDefault={() => void loadReplay()}
        onImport={(file) => void loadReplay(file)}
        onPause={() => replayDispatcherRef.current?.pause()} onResume={() => replayDispatcherRef.current?.resume()}
        onStop={() => replayDispatcherRef.current?.stop()} onSpeed={setReplaySpeed}
      />

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
      {!replayEnabled && azureConfig.mode === "frontend" && !isFrontendReady && (
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
      {activeTab !== "runtime" && activeTab in workflowDescriptions && (
        <div className="workspace-intro">
          <button className="text-button" onClick={() => setActiveTab("studio")}>&larr; Back to comparison</button>
          <h1>{workflowDescriptions[activeTab as keyof typeof workflowDescriptions].title}</h1>
          <p>{workflowDescriptions[activeTab as keyof typeof workflowDescriptions].problem} {workflowDescriptions[activeTab as keyof typeof workflowDescriptions].proof}</p>
        </div>
      )}
      <div style={{ display: activeTab === "runtime" ? "block" : "none" }}>
        <RuntimeView
          key={`${replayEnabled ? `replay-runtime-${replayBundle?.recordedAt}` : "live-runtime"}-${runtimeLaunchKey}`}
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
          externalScenarioId={runtimeExternalScenarioId}
          replayMode={replayEnabled}
          replayLoading={replayLoading || pendingStory !== null}
          comparisonModelName={comparisonModelLabel}
          onPlayRecorded={playRecordedStory}
          onOpenWorkbench={(sampleId = "refund-authorization") => handleLaunchInStudio(allUseCases.find((sample) => sample.id === sampleId) || STUDIO_SAMPLES[0])}
          onOpenTriage={() => setActiveTab("triage")}
        />
      </div>

      <div style={{ display: activeTab === "studio" ? "block" : "none" }}>
        <StudioCompareView
          key={replayEnabled ? `replay-studio-${replayBundle?.recordedAt}` : "live-studio"}
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
          comparisonModelName={comparisonModelLabel}
          endpointUrl={
            replayEnabled && replayBundle ? replayBundle.endpoint : azureConfig.mode === "frontend" && azureConfig.endpoint
              ? azureConfig.endpoint
              : health?.endpoint ||
                "https://<your-foundry-resource>.cognitiveservices.azure.com"
          }
          allUseCases={allUseCases}
          externalSample={studioExternalSample}
          externalTrigger={studioExternalTrigger}
          onOpenFramework={() => setActiveTab("framework")}
          onOpenSettings={() => setSettingsOpen(true)}
          replayMode={replayEnabled}
        />
      </div>

      <div style={{ display: activeTab === "triage" ? "block" : "none" }}>
        <TriageScaleView
          key={replayEnabled ? "replay-triage" : "live-triage"}
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
          replayMode={replayEnabled}
        />
      </div>

      <div style={{ display: activeTab === "form" ? "block" : "none" }}>
        <AgentFormView
          key={replayEnabled ? "replay-form" : "live-form"}
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
        />
      </div>

      <div style={{ display: activeTab === "framework" ? "block" : "none" }}>
        <UseCaseFrameworkView
          key={replayEnabled ? `replay-framework-${replayBundle?.recordedAt}` : "live-framework"}
          allUseCases={allUseCases}
          comparisonModelName={comparisonModelLabel}
          onLaunchInStudio={handleLaunchInStudio}
          onLaunchRuntimeScenario={handleLaunchRuntimeScenario}
          onSaveCustomUseCase={handleSaveCustomUseCase}
          onDeleteCustomUseCase={handleDeleteCustomUseCase}
          onRunComparePair={handleRunComparePair}
          replayMode={replayEnabled}
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
          {replayEnabled ? "Recorded replay" : azureConfig.mode === "backend" ? "Backend server" : "Client-only"} · {effectiveReady && (health?.ok ?? true) ? "Ready" : "Setup needed"}
        </button>
      </footer>
    </div>
  );
}
