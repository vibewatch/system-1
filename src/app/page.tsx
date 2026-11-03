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
import { IconButton } from "@/components/IconButton";
import { Tooltip } from "@/components/Tooltip";
import { ReplayDispatcher, parseReplayBundle, type ReplayBundle, type ReplayProgress } from "@/lib/replay";
import { AudioLines, ClipboardCheck, GitCompareArrows, Grid2X2, HelpCircle, ListFilter, Moon, MoreHorizontal, Pause, Play, Radio, RotateCcw, Settings2, Square, Sun, Video, X } from "lucide-react";
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
const DEMO_MODE_KEY = "ms_decision1_demo_mode_v2";
const TECHNICAL_DEMO = {
  src: "./demo-microsoft-decision-1.mp4?v=stream-triage-conversation-v3",
  captions: "./demo-microsoft-decision-1.en.vtt?v=stream-triage-conversation-v3",
  duration: "2:58",
  chapters: [
    { label: "Purpose & model · 0:00", sec: 0 },
    { label: "Customer context · 0:18", sec: 18.175 },
    { label: "Signals & outcome · 0:33", sec: 33.7375 },
    { label: "Inbox triage · 1:09", sec: 69.375 },
    { label: "Triage results · 2:18", sec: 138.5125 },
    { label: "Where it fits · 2:38", sec: 158.875 },
  ],
};

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
  const [showGuide, setShowGuide] = useState<boolean>(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [replayEnabled, setReplayEnabled] = useState(true);
  const replayEnabledRef = useRef(true);
  replayEnabledRef.current = replayEnabled;
  const [replayBundle, setReplayBundle] = useState<ReplayBundle | null>(null);
  const [replayLoading, setReplayLoading] = useState(true);
  const [readyReplayBundle, setReadyReplayBundle] = useState<ReplayBundle | null>(null);
  const replayReady = Boolean(replayBundle && readyReplayBundle === replayBundle);
  const replayLoadId = useRef(0);
  const [replayError, setReplayError] = useState("");
  const [replayProgress, setReplayProgress] = useState<ReplayProgress | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const replaySpeedRef = useRef(1);
  replaySpeedRef.current = replaySpeed;
  const [replayRevision, setReplayRevision] = useState(0);
  const [replayOpen, setReplayOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const replayDispatcherRef = useRef<ReplayDispatcher | null>(null);

  const [azureConfig, setAzureConfig] = useState<AzureClientConfig>(
    DEFAULT_AZURE_CONFIG
  );
  const activeConfigRef = useRef(azureConfig);
  activeConfigRef.current = azureConfig;
  const [browserConfig, setBrowserConfig] = useState<AzureClientConfig | null>(null);
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
    if (replayEnabled && replayBundle) {
      const recordedIds = new Set(replayBundle.scenarios.map((c) => c.id));
      return [...replayBundle.scenarios, ...customUseCases.filter((c) => !recordedIds.has(c.id))];
    }
    const customIds = new Set(customUseCases.map((c) => c.id));
    return [
      ...customUseCases,
      ...STUDIO_SAMPLES.filter((s) => !customIds.has(s.id)),
    ];
  }, [customUseCases, replayEnabled, replayBundle]);

  useEffect(() => {
    const cfg = loadAzureConfig();
    setAzureConfig(cfg);
    try { setReplayEnabled(window.localStorage.getItem(DEMO_MODE_KEY) !== "live"); } catch {}
    setConfigLoaded(true);
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

    let alive = true;
    if (configLoaded && !replayEnabled && azureConfig.mode === "backend") {
      fetch("/api/usecases")
        .then((r) => r.json())
        .then((d) => {
          if (alive && Array.isArray(d.customUseCases)) {
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
    return () => { alive = false; };
  }, [configLoaded, replayEnabled, azureConfig.mode]);

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
    if (replayEnabled || azureConfig.mode !== "backend") return;
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
  }, [replayEnabled, azureConfig.mode]);

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
    if (replayEnabled || azureConfig.mode !== "backend") return;
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
  }, [replayEnabled, azureConfig.mode]);

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

  const loadDefaultReplay = useCallback(async () => {
    const loadId = ++replayLoadId.current;
    setReplayLoading(true);
    setReplayError("");
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/replays/showcase.json`);
      if (!response.ok) throw new Error(`Could not load recordings (HTTP ${response.status}).`);
      const bundle = parseReplayBundle(await response.json());
      if (loadId !== replayLoadId.current) return;
      setReplayBundle(bundle);
      setReplayRevision((value) => value + 1);
    } catch (error) { if (loadId === replayLoadId.current) setReplayError((error as Error).message); }
    finally { if (loadId === replayLoadId.current) setReplayLoading(false); }
  }, []);

  useEffect(() => { if (configLoaded) void loadDefaultReplay(); }, [configLoaded, loadDefaultReplay]);
  useEffect(() => {
    setReadyReplayBundle(null);
    if (!replayEnabled || !replayBundle) return;
    const dispatcher = new ReplayDispatcher(replayBundle, (message) => {
      if (!replayEnabledRef.current) return;
      setWsEventCount((count) => count + 1);
      if (message.event === "error") setReplayError(message.data.message);
      listenersRef.current.forEach((handler) => handler(message));
    }, setReplayProgress);
    replayDispatcherRef.current = dispatcher;
    dispatcher.setSpeed(replaySpeedRef.current);
    setReadyReplayBundle(replayBundle);
    return () => { dispatcher.stop(); replayDispatcherRef.current = null; };
  }, [replayEnabled, replayBundle]);

  const handleReplayMode = (enabled: boolean) => {
    setHealth(null);
    setReplayError("");
    setReplayEnabled(enabled);
    try { window.localStorage.setItem(DEMO_MODE_KEY, enabled ? "replay" : "live"); } catch {}
  };
  const importReplay = async (file: File) => {
    const loadId = ++replayLoadId.current;
    setReplayLoading(false);
    setReplayError("");
    try {
      if (file.size > 25_000_000) throw new Error("Replay files must be smaller than 25 MB.");
      const bundle = parseReplayBundle(JSON.parse(await file.text()));
      if (loadId !== replayLoadId.current) return;
      setReplayBundle(bundle);
      setReplayRevision((value) => value + 1);
      handleReplayMode(true);
    } catch (error) { if (loadId === replayLoadId.current) setReplayError((error as Error).message); }
  };

  useEffect(() => {
    setBrowserConfig(null);
    if (!configLoaded || replayEnabled || azureConfig.mode !== "frontend") return;
    setHealth(null);
    let alive = true;
    const dispatcher = new BrowserFoundryDispatcher(azureConfig, (msg) => {
      if (!alive || replayEnabledRef.current || activeConfigRef.current !== azureConfig) return;
      setWsEventCount((c) => c + 1);
      if (msg.event === "health_status") setHealth(msg.data);
      listenersRef.current.forEach((fn) => fn(msg));
    });
    browserDispatcherRef.current = dispatcher;
    setBrowserConfig(azureConfig);
    dispatcher.dispatch("health_check");
    return () => {
      alive = false;
      dispatcher.dispatch("stop_runtime");
      dispatcher.dispatch("stop_triage");
      browserDispatcherRef.current = null;
    };
  }, [azureConfig, configLoaded, replayEnabled]);

  const sendWs = useCallback(
    (action: string, payload: Record<string, any> = {}) => {
      if (!configLoaded) return false;
      if (replayEnabled) {
        setReplayError("");
        return replayDispatcherRef.current?.dispatch(action, payload) ?? false;
      }
      if (azureConfig.mode === "frontend") {
        if (!browserDispatcherRef.current) return false;
        browserDispatcherRef.current.dispatch(action, payload);
        return true;
      }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action, payload }));
        return true;
      }
      return false;
    },
    [azureConfig.mode, configLoaded, replayEnabled]
  );

  const handleRunComparePair = useCallback(
    async (state: unknown, questions: DecisionQuestion[]) => {
      if (replayEnabled) {
        if (!replayDispatcherRef.current) throw new Error("The recorded showcase is still loading.");
        return replayDispatcherRef.current.comparePair(state, questions);
      }
      if (!configLoaded) throw new Error("Connection settings are still loading.");
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
    [azureConfig, configLoaded, replayEnabled]
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
  }, [azureConfig.mode, configLoaded, replayEnabled]);

  const refreshHealth = () => {
    sendWs("health_check");
  };

  const handleUpdateAzureConfig = (next: AzureClientConfig) => {
    setHealth(null);
    setAzureConfig(next);
    saveAzureConfig(next);
    if (!replayEnabled && next.mode === "backend" && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "health_check" }));
    }
  };

  const isFrontendReady =
    azureConfig.mode === "frontend" &&
    Boolean(azureConfig.endpoint.trim()) &&
    Boolean(azureConfig.accessToken.trim());

  const effectiveReady =
    configLoaded && (replayEnabled ? replayReady && !replayLoading : azureConfig.mode === "frontend" ? isFrontendReady && browserConfig === azureConfig : wsConnected);

  const comparisonModelLabel =
    replayEnabled ? replayBundle?.models.terra || "Loading baseline…" : azureConfig.mode === "frontend"
      ? azureConfig.terraDeployment.trim() || DEFAULT_AZURE_CONFIG.terraDeployment
      : health?.terraDeployment || "Baseline deployment";
  const decisionModelLabel = replayEnabled ? replayBundle?.models.decision1 || "Loading Decision model…" : azureConfig.mode === "frontend"
    ? azureConfig.decisionDeployment.trim() || DEFAULT_AZURE_CONFIG.decisionDeployment : health?.decisionDeployment || "Decision deployment";
  const endpointLabel = replayEnabled ? replayBundle?.endpoint || "" : azureConfig.mode === "frontend" ? azureConfig.endpoint : health?.endpoint || "";
  const modelSource = replayEnabled ? "Recorded Azure run" : azureConfig.mode === "frontend" ? "Browser configuration" : "Backend health metadata";
  const transportKey = replayEnabled ? `replay-${replayRevision}` : `live-${azureConfig.mode}-${azureConfig.endpoint}-${azureConfig.decisionDeployment}-${azureConfig.terraDeployment}`;
  const navigation = [
    { id: "studio" as const, label: "Workbench", full: "Decision Workbench", icon: <GitCompareArrows size={16} /> },
    { id: "framework" as const, label: "Catalog", full: `Industry Catalog · ${allUseCases.length} solutions`, icon: <Grid2X2 size={16} /> },
    { id: "runtime" as const, label: "Stream", full: "Stream + Decide", icon: <AudioLines size={16} /> },
    { id: "triage" as const, label: "Triage", full: "Triage at Scale", icon: <ListFilter size={16} /> },
    { id: "form" as const, label: "Claims", full: "Claims Gate & Form", icon: <ClipboardCheck size={16} /> },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">M1</div>
          <div className="brand-copy">
            <span className="brand-title">Decision Lab</span>
            <Tooltip content={`${decisionModelLabel} vs ${comparisonModelLabel} · ${modelSource}. Open model details.`}>
              <button className="model-summary" onClick={() => setModelsOpen(true)} aria-label={`Model details: ${decisionModelLabel} vs ${comparisonModelLabel}`}>
                <span className="model-name d1">{decisionModelLabel}</span><span className="model-versus">vs</span><span className="model-name terra">{comparisonModelLabel}</span>
              </button>
            </Tooltip>
          </div>
        </div>

        <nav className="nav-tabs" aria-label="Primary Workspaces">
          {navigation.map((item) => <Tooltip key={item.id} content={item.full}><button
            className={`nav-tab ${activeTab === item.id ? "active" : ""}`}
            onClick={() => setActiveTab(item.id)} aria-label={item.full} aria-current={activeTab === item.id ? "page" : undefined}
          ><span aria-hidden="true">{item.icon}</span><span className="nav-label">{item.label}</span></button></Tooltip>)}
        </nav>

        <div className="topbar-right">
          <IconButton label="Demo replay" icon={replayEnabled ? <Play size={17} /> : <Radio size={17} />} tag={replayEnabled ? "Replay" : "Live"} className={replayEnabled ? "active" : ""} tooltip={replayEnabled ? "Recorded demos · playback, import, download or switch to live" : "Live execution · open replay options"} onClick={() => setReplayOpen(true)} />
          <IconButton label="Connection settings" icon={<Settings2 size={17} />} tooltip={`Connection settings · ${replayEnabled ? "settings apply to live mode" : azureConfig.mode === "backend" ? "Backend server" : "Browser-only execution"}`} onClick={() => setSettingsOpen(true)} />
          <div className="header-secondary-actions">
            <IconButton label="Watch technical demo" icon={<Video size={17} />} tooltip={`Stream and Triage technical walkthrough · ${TECHNICAL_DEMO.duration} · English narration and captions`} onClick={() => setDemoVideoOpen(true)} />
            <IconButton label={showGuide ? "Hide quick guide" : "Show quick guide"} icon={<HelpCircle size={17} />} aria-pressed={showGuide} onClick={() => setShowGuide((value) => !value)} />
            <IconButton label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} icon={theme === "light" ? <Moon size={17} /> : <Sun size={17} />} onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} />
          </div>
          <div className="header-more-action"><IconButton label="More actions" icon={<MoreHorizontal size={17} />} onClick={() => setMoreOpen(true)} /></div>
        </div>
      </header>

      {replayEnabled && <div className="demo-mode-strip" role="status">
        <span className={`dot ${effectiveReady ? "ok" : "warn"}`} />
        <span>{replayLoading ? "Loading recorded demos…" : replayProgress?.playing ? replayProgress.label : "Recorded Azure demo"}</span>
        <span className="demo-mode-note">{replayProgress?.paused ? "Paused" : `${replaySpeed}× playback`} · original model latency · no model calls</span>
        {replayProgress?.playing && <div className="replay-inline-controls">
          <IconButton label={replayProgress.paused ? "Resume replay" : "Pause replay"} icon={replayProgress.paused ? <Play size={14} /> : <Pause size={14} />} onClick={() => replayProgress.paused ? replayDispatcherRef.current?.resume() : replayDispatcherRef.current?.pause()} />
          <IconButton label="Stop replay" icon={<Square size={14} />} onClick={() => replayDispatcherRef.current?.stop()} />
        </div>}
      </div>}
      {replayEnabled && replayError && <div className="transport-error" role="alert">{replayError}<IconButton label="Open replay options" icon={<Settings2 size={16} />} onClick={() => setReplayOpen(true)} /></div>}

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
                Pick an enterprise scenario on the left to see what
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
                <b>{replayEnabled ? "Replay comparison" : "Run Evaluation"}</b> to compare {replayEnabled ? "recorded results" : "live"} against{" "}
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
                <b>Live mode</b> via replay options. Connection settings choose
                the backend server (default live transport) or browser-only mode.
              </p>
            </div>

            <div>
              <IconButton label="Dismiss guide" icon={<X size={16} />} onClick={() => setShowGuide(false)} />
            </div>
          </div>
        </section>
      )}

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
              fontSize: "var(--font-sm)",
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
          key={transportKey}
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
          externalScenarioId={runtimeExternalScenarioId}
          replayMode={replayEnabled}
          comparisonModelName={comparisonModelLabel}
        />
      </div>

      <div style={{ display: activeTab === "studio" ? "block" : "none" }}>
        <StudioCompareView
          key={transportKey}
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
          comparisonModelName={comparisonModelLabel}
          decisionModelName={decisionModelLabel}
          replayMode={replayEnabled}
          endpointUrl={endpointLabel || "https://<your-foundry-resource>.cognitiveservices.azure.com"}
          allUseCases={allUseCases}
          externalSample={studioExternalSample}
          externalTrigger={studioExternalTrigger}
          onOpenFramework={() => setActiveTab("framework")}
        />
      </div>

      <div style={{ display: activeTab === "triage" ? "block" : "none" }}>
        <TriageScaleView
          key={transportKey}
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
          replayMode={replayEnabled}
          comparisonModelName={comparisonModelLabel}
        />
      </div>

      <div style={{ display: activeTab === "form" ? "block" : "none" }}>
        <AgentFormView
          key={transportKey}
          sendWs={sendWs}
          subscribeWs={subscribeWs}
          wsConnected={effectiveReady}
          replayMode={replayEnabled}
          comparisonModelName={comparisonModelLabel}
        />
      </div>

      <div style={{ display: activeTab === "framework" ? "block" : "none" }}>
        <UseCaseFrameworkView
          key={transportKey}
          allUseCases={allUseCases}
          comparisonModelName={comparisonModelLabel}
          replayMode={replayEnabled}
          readOnlyCaseIds={replayEnabled ? replayBundle?.scenarios.map((sample) => sample.id) : []}
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

      <ReplayControls open={replayOpen} onClose={() => setReplayOpen(false)} bundle={replayBundle} enabled={replayEnabled} loading={replayLoading} error={replayError} progress={replayProgress} speed={replaySpeed} onEnable={handleReplayMode} onLoadDefault={loadDefaultReplay} onImport={importReplay} onPause={() => replayDispatcherRef.current?.pause()} onResume={() => replayDispatcherRef.current?.resume()} onStop={() => replayDispatcherRef.current?.stop()} onSpeed={(speed) => { setReplaySpeed(speed); replayDispatcherRef.current?.setSpeed(speed); }} />
      <Dialog open={modelsOpen} onClose={() => setModelsOpen(false)} title="Model details" maxWidth={600}>
        <div className="modal-head"><h2>Model details</h2><IconButton label="Close model details" icon={<X size={18} />} onClick={() => setModelsOpen(false)} /></div>
        <div className="modal-body">
          <dl className="model-details">
            <dt>Decision deployment</dt><dd className="d1">{decisionModelLabel}</dd>
            <dt>LLM baseline</dt><dd className="terra">{comparisonModelLabel}</dd>
            <dt>Metadata source</dt><dd>{modelSource}</dd>
            <dt>Foundry resource</dt><dd>{replayEnabled ? "Redacted for public replay" : endpointLabel || "Waiting for live connection metadata"}</dd>
            <dt>Status</dt><dd>{replayEnabled ? replayLoading ? "Loading recordings" : replayReady ? "Ready · no sign-in needed" : "Recording unavailable" : health?.error || (effectiveReady ? "Connected" : "Waiting for live connection")}</dd>
            {replayEnabled && replayBundle && <><dt>Recorded</dt><dd>{new Date(replayBundle.recordedAt).toLocaleString()}</dd></>}
          </dl>
          <p className="detail-note">Model names come from the active recording, browser configuration or backend—not a hardcoded header. Recorded measurements are from the original Azure run.</p>
          {!replayEnabled && <IconButton label="Refresh live metadata" icon={<RotateCcw size={16} />} tag="Refresh" onClick={refreshHealth} />}
        </div>
      </Dialog>
      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More actions" maxWidth={380}>
        <div className="modal-head"><h2>More actions</h2><IconButton label="Close more actions" icon={<X size={18} />} onClick={() => setMoreOpen(false)} /></div>
        <div className="modal-body more-actions">
          <IconButton label="Watch technical demo" icon={<Video size={18} />} tag={`Technical demo · ${TECHNICAL_DEMO.duration}`} onClick={() => { setMoreOpen(false); setDemoVideoOpen(true); }} />
          <IconButton label={showGuide ? "Hide quick guide" : "Show quick guide"} icon={<HelpCircle size={18} />} tag="Quick guide" onClick={() => { setMoreOpen(false); setShowGuide((value) => !value); }} />
          <IconButton label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} icon={theme === "light" ? <Moon size={18} /> : <Sun size={18} />} tag={theme === "light" ? "Dark theme" : "Light theme"} onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} />
        </div>
      </Dialog>
      {demoVideoOpen && (
        <Dialog open={demoVideoOpen} onClose={() => setDemoVideoOpen(false)} title="Stream and Triage technical walkthrough" maxWidth={1020}>
            <div className="modal-head" style={{ flexWrap: "wrap", gap: 12 }}>
              <div>
                <div className="section-kicker" style={{ marginBottom: 4 }}>
                  Conversational Walkthrough · Recorded Azure Results
                </div>
                <h3 style={{ fontSize: "var(--font-lg)", fontWeight: 700 }}>
                  Stream &amp; Triage Walkthrough ({TECHNICAL_DEMO.duration})
                </h3>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a
                  href={TECHNICAL_DEMO.src}
                  download="decision-1-stream-triage.mp4"
                  className="ghost"
                  style={{
                    textDecoration: "none",
                    padding: "6px 11px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    fontSize: "var(--font-sm)",
                    color: "var(--text)",
                  }}
                >
                  Download MP4
                </a>
                <IconButton label="Close technical demo" icon={<X size={18} />} onClick={() => setDemoVideoOpen(false)} />
              </div>
            </div>
            <div className="modal-body" style={{ padding: 16, maxHeight: "calc(100dvh - 200px)" }}>
              <video
                ref={demoVideoRef}
                src={TECHNICAL_DEMO.src}
                aria-label="Stream and Triage technical walkthrough"
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
              >
                <track kind="captions" src={TECHNICAL_DEMO.captions} srcLang="en" label="English" default />
              </video>
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
                    fontSize: "var(--font-xs)",
                    color: "var(--text-dim)",
                    marginRight: 4,
                  }}
                >
                  CHAPTERS:
                </span>
                {TECHNICAL_DEMO.chapters.map((ch) => (
                  <button
                    key={ch.label}
                    type="button"
                    className="pill"
                    style={{ cursor: "pointer", fontSize: "var(--font-xs)" }}
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
        </Dialog>
      )}

      {/* Footer */}
      <footer className="footer">
        <span>
          {replayEnabled ? "Recorded Azure demo · original measurements · no sign-in" : azureConfig.mode === "backend" ? "Live · backend server · Microsoft Entra ID" : "Live · browser direct · Microsoft Entra ID"}
        </span>
        <span>
          Models:{" "}
          <b>
            {decisionModelLabel}
          </b>{" "}
          vs <b>{comparisonModelLabel}</b> · Pricing: <b>$0.042/1M input · $0 output</b>
        </span>
      </footer>
    </div>
  );
}
