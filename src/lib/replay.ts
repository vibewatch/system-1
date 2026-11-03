import type { DecisionQuestion, StudioSample } from "./demo-data";
import type { DecisionRunResult } from "./foundry";

export type ReplayAction = "run_compare" | "start_runtime" | "start_triage" | "run_agent_form";
export interface ReplayEvent {
  event: string;
  data: Record<string, any>;
  offsetMs: number;
}
export interface ReplayRecording {
  id: string;
  label: string;
  action: ReplayAction;
  payload: Record<string, any>;
  durationMs: number;
  events: ReplayEvent[];
}
export interface ReplayBundle {
  version: 1;
  recordedAt: string;
  endpoint: string;
  models: { decision1: string; terra: string };
  scenarios: StudioSample[];
  recordings: ReplayRecording[];
}
export interface ReplayProgress {
  label: string;
  elapsedMs: number;
  durationMs: number;
  playing: boolean;
  paused: boolean;
}

const ACTIONS: ReplayAction[] = ["run_compare", "start_runtime", "start_triage", "run_agent_form"];
const EVENTS = new Set([
  "compare_started", "compare_model_done", "compare_finished",
  "runtime_started", "runtime_token", "runtime_decision", "runtime_terra_decision", "runtime_extract", "runtime_done",
  "runtime_story_stage", "runtime_evaluation_started", "runtime_navigation_state",
  "triage_started", "triage_arrival", "triage_item_done", "triage_done",
  "agent_step", "agent_gates_done", "agent_field_filled", "agent_done",
]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function recordingMatches(recording: ReplayRecording, action: string, payload: Record<string, any>): boolean {
  if (recording.action !== action) return false;
  if (action === "run_compare") return canonical(recording.payload.state) === canonical(payload.state ?? "") && canonical(recording.payload.questions) === canonical(payload.questions);
  if (action === "start_runtime") return recording.payload.scenarioId === (payload.scenarioId || "dealer") && (!payload.questions || canonical(recording.payload.questions) === canonical(payload.questions));
  if (action === "start_triage") return recording.payload.rate === (Number(payload.rate) || 10) && recording.payload.raceTerra === (payload.raceTerra !== false);
  return recording.payload.content === payload.content;
}

export function parseReplayBundle(value: unknown): ReplayBundle {
  const bundle = value as ReplayBundle;
  if (!bundle || bundle.version !== 1 || !Number.isFinite(Date.parse(bundle.recordedAt)) ||
      typeof bundle.endpoint !== "string" || typeof bundle.models?.decision1 !== "string" || typeof bundle.models?.terra !== "string" ||
      !Array.isArray(bundle.scenarios) || !Array.isArray(bundle.recordings) || !bundle.recordings.length || bundle.recordings.length > 1000) {
    throw new Error("This is not a supported version-1 replay file.");
  }
  for (const scenario of bundle.scenarios) {
    if (!scenario || typeof scenario.id !== "string" || typeof scenario.label !== "string" ||
        typeof scenario.content !== "string" || typeof scenario.category !== "string" ||
        !Array.isArray(scenario.questions) || scenario.questions.some((question) =>
          typeof question.id !== "string" || typeof question.label !== "string" || typeof question.instructions !== "string" ||
          !["noul", "choice", "score"].includes(question.type))) throw new Error("Invalid scenario in replay file.");
  }
  for (const recording of bundle.recordings) {
    if (!ACTIONS.includes(recording.action) || typeof recording.id !== "string" || typeof recording.label !== "string" ||
        !recording.payload || typeof recording.payload !== "object" || !Array.isArray(recording.events) || !recording.events.length ||
        !Number.isFinite(recording.durationMs) || recording.durationMs < 0 || recording.durationMs > 3_600_000) {
      throw new Error("Invalid recording in replay file.");
    }
    let previous = -1;
    for (const event of recording.events) {
      if (!EVENTS.has(event.event) || !event.data || typeof event.data !== "object" || !Number.isFinite(event.offsetMs) ||
          event.offsetMs < previous || event.offsetMs > recording.durationMs) throw new Error("Invalid event timeline in replay file.");
      previous = event.offsetMs;
    }
    const terminal = { run_compare: "compare_finished", start_runtime: "runtime_done", start_triage: "triage_done", run_agent_form: "agent_done" }[recording.action];
    if (!recording.events.some((event) => event.event === terminal)) throw new Error("Incomplete recording: missing final event.");
  }
  return bundle;
}

export class ReplayDispatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recording: ReplayRecording | null = null;
  private index = 0;
  private elapsed = 0;
  private anchor = 0;
  private speed = 1;
  private paused = false;

  constructor(
    readonly bundle: ReplayBundle,
    private emit: (message: { event: string; data: any; ts: number }) => void,
    private progress: (state: ReplayProgress | null) => void = () => {},
  ) {}

  private notify() {
    if (!this.recording) return;
    this.progress({
      label: this.recording.label, elapsedMs: Math.min(this.elapsed, this.recording.durationMs),
      durationMs: this.recording.durationMs, playing: this.index < this.recording.events.length, paused: this.paused,
    });
  }
  private updateClock() {
    if (!this.paused && this.recording) this.elapsed += (performance.now() - this.anchor) * this.speed;
    this.anchor = performance.now();
  }
  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private deliver(event: ReplayEvent) {
    const data = structuredClone(event.data);
    // Imported files may contain log HTML; only the existing bold markup is allowed.
    if (event.event === "agent_step" && typeof data.text === "string") {
      data.text = data.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/&lt;(\/?)b&gt;/g, "<$1b>");
    }
    this.emit({ event: event.event, data, ts: Date.parse(this.bundle.recordedAt) + event.offsetMs });
  }
  private tick = () => {
    this.clearTimer();
    if (!this.recording || this.paused) return;
    this.updateClock();
    while (this.index < this.recording.events.length && this.recording.events[this.index].offsetMs <= this.elapsed) {
      this.deliver(this.recording.events[this.index++]);
    }
    this.notify();
    if (this.index < this.recording.events.length) {
      const delay = (this.recording.events[this.index].offsetMs - this.elapsed) / this.speed;
      this.timer = setTimeout(this.tick, Math.min(100, Math.max(1, delay)));
    }
  };

  dispatch(action: string, payload: Record<string, any> = {}): boolean {
    if (action === "health_check") {
      this.emit({ event: "health_status", data: { ok: true, mode: "replay", endpoint: this.bundle.endpoint, decisionDeployment: this.bundle.models.decision1, terraDeployment: this.bundle.models.terra }, ts: Date.now() });
      return true;
    }
    if (action === "stop_runtime" || action === "stop_triage") {
      this.stop();
      this.emit({ event: action === "stop_runtime" ? "runtime_stopped" : "triage_stopped", data: {}, ts: Date.now() });
      return true;
    }
    const recording = this.bundle.recordings.find((item) => recordingMatches(item, action, payload));
    if (!recording) {
      this.emit({ event: "error", data: { message: "No recording matches this input or question set. Choose a recorded scenario, or switch back to live mode." }, ts: Date.now() });
      return false;
    }
    this.stop();
    this.recording = recording;
    this.index = 0;
    this.elapsed = 0;
    this.paused = false;
    this.anchor = performance.now();
    this.tick();
    return true;
  }
  setSpeed(speed: number) {
    this.updateClock();
    this.speed = Math.max(0.25, Math.min(4, speed));
    this.tick();
  }
  pause() {
    this.updateClock();
    this.paused = true;
    this.clearTimer();
    this.notify();
  }
  resume() {
    this.paused = false;
    this.anchor = performance.now();
    this.tick();
  }
  stop() {
    const action = this.recording?.action;
    const wasPlaying = this.recording && this.index < this.recording.events.length;
    this.clearTimer();
    this.recording = null;
    this.progress(null);
    if (wasPlaying) {
      const event = action === "run_compare" ? "compare_finished" : action === "start_runtime" ? "runtime_stopped" : action === "start_triage" ? "triage_stopped" : "agent_done";
      this.emit({ event, data: { cancelled: true }, ts: Date.now() });
    }
  }
  async comparePair(state: unknown, questions: DecisionQuestion[]): Promise<{ decision1: DecisionRunResult; terra: DecisionRunResult }> {
    const recording = this.bundle.recordings.find((item) => recordingMatches(item, "run_compare", { state, questions }));
    if (!recording) throw new Error("No recording matches this test case. Switch to live mode to evaluate new inputs.");
    const results = Object.fromEntries(recording.events.filter((event) => event.event === "compare_model_done").map((event) => [event.data.tier, structuredClone(event.data.result)]));
    if (!results.decision1 || !results.terra) throw new Error("This recording does not contain both model results.");
    return { decision1: results.decision1, terra: results.terra };
  }
}
