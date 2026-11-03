"use client";

import { PublicClientApplication } from "@azure/msal-browser";
import {
  CLAIM_DEMO,
  DecisionQuestion,
  RUNTIME_SCENARIOS,
  RUNTIME_SYSTEM_PROMPT,
  SHARED_ENTITY_FIELDS,
  TRIAGE_FEED,
} from "./demo-data";
import type {
  DecisionRunResult,
  ExtractedSpan,
  NormalizedDecision,
} from "./foundry";

export type ExecutionMode = "frontend" | "backend";
export type BrowserAuthMethod = "entra_msal" | "entra_token" | "api_key";

export interface AzureClientConfig {
  mode: ExecutionMode;
  endpoint: string;
  decisionEndpoint: string;
  decisionDeployment: string;
  terraDeployment: string;
  authMethod: BrowserAuthMethod;
  tenantId: string;
  clientId: string;
  accessToken: string;
  accountName?: string;
  tokenExpiresAt?: number;
}

export const CONFIG_STORAGE_KEY = "ms_decision1_azure_config_v1";

export const DEFAULT_AZURE_CONFIG: AzureClientConfig = {
  mode: "frontend", // Default is frontend-only mode per user requirement
  endpoint: "",
  decisionEndpoint: "",
  decisionDeployment: "Decision-1",
  terraDeployment: "gpt-6.1-terra",
  authMethod: "entra_msal",
  tenantId: "common",
  clientId: "",
  accessToken: "",
  accountName: "",
};

export function loadAzureConfig(): AzureClientConfig {
  if (typeof window === "undefined") return DEFAULT_AZURE_CONFIG;
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_AZURE_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_AZURE_CONFIG,
      ...parsed,
    };
  } catch {
    return DEFAULT_AZURE_CONFIG;
  }
}

export function saveAzureConfig(cfg: AzureClientConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore storage errors
  }
}

export function isFrontendConfigured(cfg: AzureClientConfig): boolean {
  if (cfg.mode !== "frontend") return true;
  const hasEndpoint = Boolean(
    cfg.endpoint.trim() || cfg.decisionEndpoint.trim()
  );
  const hasCred = Boolean(cfg.accessToken.trim());
  return hasEndpoint && hasCred;
}

let msalInstanceCache: {
  key: string;
  pca: PublicClientApplication;
} | null = null;

async function getMsalInstance(
  tenantId: string,
  clientId: string
): Promise<PublicClientApplication> {
  const cleanTenant = tenantId.trim() || "common";
  const cleanClient = clientId.trim();
  if (!cleanClient) {
    throw new Error(
      "Please provide your Entra ID Application (Client) ID for browser OAuth2 sign-in, or switch to Entra ID Access Token mode."
    );
  }
  const cacheKey = `${cleanTenant}::${cleanClient}`;
  if (msalInstanceCache && msalInstanceCache.key === cacheKey) {
    return msalInstanceCache.pca;
  }
  const pca = new PublicClientApplication({
    auth: {
      clientId: cleanClient,
      authority: `https://login.microsoftonline.com/${cleanTenant}`,
      redirectUri:
        typeof window !== "undefined" ? window.location.origin : undefined,
    },
    cache: {
      cacheLocation: "localStorage",
    },
  });
  await pca.initialize();
  msalInstanceCache = { key: cacheKey, pca };
  return pca;
}

export async function signInWithEntraPopup(
  tenantId: string,
  clientId: string
): Promise<{
  accessToken: string;
  accountName: string;
  expiresAt: number;
}> {
  const pca = await getMsalInstance(tenantId, clientId);
  const scopes = ["https://cognitiveservices.azure.com/.default"];
  const loginRes = await pca.loginPopup({
    scopes,
    prompt: "select_account",
  });
  const account = loginRes.account;
  let tokenRes = loginRes;
  if (!tokenRes.accessToken && account) {
    tokenRes = await pca.acquireTokenSilent({
      scopes,
      account,
    });
  }
  return {
    accessToken: tokenRes.accessToken,
    accountName: account?.username || account?.name || "Entra ID User",
    expiresAt: tokenRes.expiresOn
      ? tokenRes.expiresOn.getTime()
      : Date.now() + 3600_000,
  };
}

function getAuthHeaders(cfg: AzureClientConfig): Record<string, string> {
  const token = cfg.accessToken.trim();
  if (!token) {
    throw new Error(
      "Missing Entra ID Access Token. Please sign in with Microsoft Entra ID or provide an access token in Azure Settings."
    );
  }
  if (cfg.authMethod === "api_key") {
    return {
      "Content-Type": "application/json",
      "api-key": token,
    };
  }
  return {
    "Content-Type": "application/json",
    Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
  };
}

function normalizeEndpoint(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function buildSystemOnePayload(
  state: unknown,
  questions: DecisionQuestion[],
  deployment: string
) {
  const qMap: Record<string, Record<string, unknown>> = {};
  for (const q of questions) {
    const entry: Record<string, unknown> = {
      type: q.type,
      instructions: q.instructions,
    };
    if (q.criteria) entry.criteria = q.criteria;
    qMap[q.id] = entry;
  }
  return {
    model: deployment || "Decision-1",
    state,
    questions: qMap,
  };
}

export function normalizeDecision1Answers(
  rawDecisions: Record<string, any>,
  questions: DecisionQuestion[]
): Record<string, NormalizedDecision> {
  const out: Record<string, NormalizedDecision> = {};
  for (const q of questions) {
    const d = rawDecisions?.[q.id] || {};
    const probs: Record<string, number> = d.probabilities || d.probs || {};
    if (q.type === "noul") {
      const pTrue =
        typeof d.noul === "number"
          ? d.noul
          : typeof probs["true"] === "number"
          ? probs["true"]
          : typeof probs["yes"] === "number"
          ? probs["yes"]
          : 0.5;
      const yes = pTrue >= 0.5;
      out[q.id] = {
        id: q.id,
        type: "noul",
        label: yes ? "Yes" : "No",
        key: yes ? "yes" : "no",
        value: pTrue,
        confidence: Math.max(pTrue, 1 - pTrue),
        cls: pTrue > 0.65 ? "yes" : pTrue < 0.35 ? "no" : "unsure",
        detail: `${Math.round(pTrue * 100)}% yes`,
        probabilities: {
          Yes: Number(pTrue.toFixed(4)),
          No: Number((1 - pTrue).toFixed(4)),
        },
        raw: d,
      };
    } else if (q.type === "score") {
      const scale = Array.isArray(q.criteria)
        ? q.criteria
        : ["Low", "Medium", "High", "Critical"];
      const scoreVal = typeof d.score === "number" ? d.score : 0;
      const maxIdx = Math.max(1, scale.length - 1);
      const norm = Math.max(0, Math.min(1, scoreVal / maxIdx));
      const idx = Math.max(
        0,
        Math.min(scale.length - 1, Math.round(scoreVal))
      );
      const namedProbs: Record<string, number> = {};
      scale.forEach((lvl, i) => {
        namedProbs[lvl] =
          probs[lvl] ?? probs[String(i)] ?? (i === idx ? 0.85 : 0.05);
      });
      const topConf =
        typeof d.confidence === "number"
          ? d.confidence
          : probs[String(idx)] ?? probs[scale[idx]] ?? 0.9;
      out[q.id] = {
        id: q.id,
        type: "score",
        label: scale[idx] || String(scoreVal.toFixed(2)),
        key: scale[idx] || String(idx),
        value: norm,
        confidence: topConf,
        rawScore: Number(scoreVal.toFixed(3)),
        cls: "scale",
        detail: `${scoreVal.toFixed(2)} / ${maxIdx} (${scale[idx] || ""})`,
        probabilities: namedProbs,
        raw: d,
      };
    } else {
      const topChoice =
        typeof d.choice === "string"
          ? d.choice
          : Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
      const topProb =
        typeof probs[topChoice] === "number"
          ? probs[topChoice]
          : typeof d.confidence === "number"
          ? d.confidence
          : 0.95;
      const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
      const runnerUp = sorted
        .filter(([k]) => k !== topChoice)
        .slice(0, 2)
        .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
        .join(" · ");
      out[q.id] = {
        id: q.id,
        type: "choice",
        label: topChoice,
        key: topChoice,
        value: topProb,
        confidence: topProb,
        cls: "choice",
        detail:
          `${Math.round(topProb * 100)}%` + (runnerUp ? ` · ${runnerUp}` : ""),
        probabilities: probs,
        raw: d,
      };
    }
  }
  return out;
}

export async function callDecision1Browser(
  cfg: AzureClientConfig,
  state: unknown,
  questions: DecisionQuestion[]
): Promise<DecisionRunResult> {
  const baseUrl = normalizeEndpoint(cfg.decisionEndpoint || cfg.endpoint);
  if (!baseUrl) {
    throw new Error(
      "Azure Foundry Endpoint is not configured. Click 'Azure Settings' in the top bar to configure your endpoint."
    );
  }
  const deployment = cfg.decisionDeployment.trim() || "Decision-1";
  const payload = buildSystemOnePayload(state, questions, deployment);
  const t0 = performance.now();

  const res = await fetch(`${baseUrl}/providers/microsoft/v1/systemone`, {
    method: "POST",
    headers: getAuthHeaders(cfg),
    body: JSON.stringify(payload),
  });
  const latency_ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Microsoft-Decision-1 HTTP ${res.status}: ${errText.slice(0, 300)}`
    );
  }
  const data = await res.json();
  const rawDecisions = data.answers || data.decisions || {};
  return {
    ok: true,
    status: res.status,
    model: data.model || `Microsoft-Decision-1 (${deployment})`,
    endpointUsed: baseUrl,
    latency_ms,
    answers: normalizeDecision1Answers(rawDecisions, questions),
    usage: data.usage || { input_tokens: 0, output_tokens: 0 },
    rawPayload: data,
    requestPayload: payload,
  };
}

export async function callTerraDecisionBrowser(
  cfg: AzureClientConfig,
  state: unknown,
  questions: DecisionQuestion[]
): Promise<DecisionRunResult> {
  const baseUrl = normalizeEndpoint(cfg.endpoint || cfg.decisionEndpoint);
  if (!baseUrl) {
    throw new Error(
      "Azure Foundry Endpoint is not configured. Click 'Azure Settings' in the top bar."
    );
  }
  const deployment = cfg.terraDeployment.trim() || "gpt-6.1-terra";
  const stateStr =
    typeof state === "string" ? state : JSON.stringify(state, null, 2);

  const schemaDesc = questions.map((q) => {
    if (q.type === "noul") {
      return `- "${q.id}" (type: noul): ${q.instructions} -> Return {"noul": <probability 0.0 to 1.0 that the answer is true/yes>}`;
    } else if (q.type === "score") {
      const scale = Array.isArray(q.criteria)
        ? q.criteria
        : ["Low", "Medium", "High", "Critical"];
      return `- "${q.id}" (type: score, scale 0..${scale.length - 1} [${scale.join(
        ", "
      )}]): ${q.instructions} -> Return {"score": <float 0.0 to ${
        scale.length - 1
      }>, "probs": {<each label>: <prob 0..1>}}`;
    } else {
      const opts =
        q.criteria && !Array.isArray(q.criteria)
          ? Object.entries(q.criteria)
              .map(([k, v]) => `${k} (${v})`)
              .join("; ")
          : "";
      return `- "${q.id}" (type: choice, options: ${opts}): ${q.instructions} -> Return {"choice": "<best_option_key>", "probs": {<each option key>: <prob 0..1>}}`;
    }
  });

  const prompt = `You are a structured decision engine. Evaluate the following state and answer every question in strict JSON format under a top-level "decisions" key. No markdown fences, only valid JSON.

STATE:
${stateStr}

QUESTIONS:
${schemaDesc.join("\n")}

Return JSON of shape:
{
  "decisions": {
    "<question_id>": { ... }
  }
}`;

  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/openai/v1/responses`, {
    method: "POST",
    headers: getAuthHeaders(cfg),
    body: JSON.stringify({
      model: deployment,
      input: prompt,
      max_output_tokens: 900,
    }),
  });
  const latency_ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `${deployment} HTTP ${res.status}: ${errText.slice(0, 300)}`
    );
  }
  const data = await res.json();
  let outText = data.output_text || "";
  if (!outText && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.text) outText += c.text;
        }
      }
    }
  }
  const cleaned = outText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let parsed: any = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = {};
      }
    }
  }
  const rawDecisions = parsed.decisions || parsed || {};
  return {
    ok: true,
    status: res.status,
    model: data.model || deployment,
    endpointUsed: baseUrl,
    latency_ms,
    answers: normalizeDecision1Answers(rawDecisions, questions),
    usage: data.usage || { input_tokens: 0, output_tokens: 0 },
    rawPayload: data,
    rawText: outText,
    requestPayload: { model: deployment, input: prompt },
  };
}

export async function extractEntitiesBrowser(
  cfg: AzureClientConfig,
  content: string,
  fields: Record<string, string>
): Promise<{
  fields: Record<
    string,
    { value: string; confidence: number; spans: ExtractedSpan[] }
  >;
  spans: ExtractedSpan[];
  latency_ms: number;
}> {
  const baseUrl = normalizeEndpoint(cfg.endpoint || cfg.decisionEndpoint);
  const deployment = cfg.terraDeployment.trim() || "gpt-6.1-terra";
  const fieldList = Object.entries(fields)
    .map(([k, desc]) => `- "${k}": ${desc}`)
    .join("\n");

  const prompt = `Extract all mentioned entities from the text for these fields:
${fieldList}

TEXT:
${content}

Return ONLY valid JSON of shape:
{
  "fields": {
    "<field_name>": {
      "value": "<best extracted string or empty string if not present>",
      "confidence": <number 0.0 to 1.0>,
      "mentions": ["<exact verbatim substring from TEXT>"]
    }
  }
}`;

  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/openai/v1/responses`, {
    method: "POST",
    headers: getAuthHeaders(cfg),
    body: JSON.stringify({
      model: deployment,
      input: prompt,
      max_output_tokens: 900,
    }),
  });
  const latency_ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    return { fields: {}, spans: [], latency_ms };
  }
  const data = await res.json();
  let outText = data.output_text || "";
  if (!outText && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.text) outText += c.text;
        }
      }
    }
  }
  const cleaned = outText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let parsed: any = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {};
  }
  const rawFields = parsed.fields || {};
  const resultFields: Record<
    string,
    { value: string; confidence: number; spans: ExtractedSpan[] }
  > = {};
  const allSpans: ExtractedSpan[] = [];

  for (const fieldName of Object.keys(fields)) {
    const f = rawFields[fieldName] || {};
    const val = typeof f.value === "string" ? f.value.trim() : "";
    const conf =
      typeof f.confidence === "number" ? f.confidence : val ? 0.92 : 0;
    const mentions: string[] = Array.isArray(f.mentions)
      ? f.mentions
      : val
      ? [val]
      : [];
    const fieldSpans: ExtractedSpan[] = [];
    for (const m of mentions) {
      if (!m || typeof m !== "string") continue;
      let fromIdx = 0;
      while (fromIdx < content.length) {
        const idx = content.indexOf(m, fromIdx);
        if (idx === -1) break;
        const sp: ExtractedSpan = {
          field: fieldName,
          text: m,
          start: idx,
          end: idx + m.length,
          probability: conf,
        };
        fieldSpans.push(sp);
        allSpans.push(sp);
        fromIdx = idx + m.length;
      }
    }
    resultFields[fieldName] = {
      value: val,
      confidence: conf,
      spans: fieldSpans,
    };
  }
  allSpans.sort((a, b) => a.start - b.start);
  return { fields: resultFields, spans: allSpans, latency_ms };
}

export async function streamConversationBrowser(
  cfg: AzureClientConfig,
  systemPrompt: string,
  userPrompt: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const baseUrl = normalizeEndpoint(cfg.endpoint || cfg.decisionEndpoint);
  const deployment = cfg.terraDeployment.trim() || "gpt-6.1-terra";
  const res = await fetch(`${baseUrl}/openai/v1/responses`, {
    method: "POST",
    headers: getAuthHeaders(cfg),
    body: JSON.stringify({
      model: deployment,
      instructions: systemPrompt,
      input: userPrompt,
      stream: true,
      max_output_tokens: 900,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const errText = await res.text();
    throw new Error(
      `Stream failed (${res.status}): ${errText.slice(0, 240)}`
    );
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (
          evt.type === "response.output_text.delta" &&
          typeof evt.delta === "string"
        ) {
          onDelta(evt.delta);
        }
      } catch {
        // ignore partial line
      }
    }
  }
}

// Browser-side dispatcher for all interactive flows when in Frontend-Only mode
export class BrowserFoundryDispatcher {
  private runtimeAbort: AbortController | null = null;
  private triageAbort = false;
  private currentConfig: AzureClientConfig;

  constructor(
    initialConfig: AzureClientConfig,
    private emitMsg: (msg: { event: string; data: any; ts: number }) => void
  ) {
    this.currentConfig = initialConfig;
  }

  updateConfig(next: AzureClientConfig) {
    this.currentConfig = next;
  }

  private emit(event: string, data: any) {
    this.emitMsg({ event, data, ts: Date.now() });
  }

  private getConfig(): AzureClientConfig {
    return this.currentConfig;
  }

  stopAll() {
    if (this.runtimeAbort) {
      this.runtimeAbort.abort();
      this.runtimeAbort = null;
    }
    this.triageAbort = true;
  }

  async dispatch(action: string, payload: Record<string, any> = {}) {
    const cfg = this.getConfig();

    if (action === "health_check") {
      if (!isFrontendConfigured(cfg)) {
        this.emit("health_status", {
          ok: false,
          mode: "frontend",
          needsSetup: true,
          error:
            "Frontend-Only Mode: Configure your Azure AI Foundry endpoint & Entra ID sign-in to start.",
        });
        return;
      }
      try {
        const t0 = performance.now();
        const res = await callDecision1Browser(cfg, "Service health probe.", [
          {
            id: "ready",
            label: "Ready",
            type: "noul",
            instructions: "Is this a service health probe?",
          },
        ]);
        this.emit("health_status", {
          ok: true,
          mode: "frontend",
          endpoint: cfg.endpoint,
          activeDecisionEndpoint: cfg.decisionEndpoint || cfg.endpoint,
          decisionDeployment: cfg.decisionDeployment,
          terraDeployment: cfg.terraDeployment,
          round_trip_ms: Math.round(performance.now() - t0),
          decision_latency_ms: res.latency_ms,
        });
      } catch (err: any) {
        this.emit("health_status", {
          ok: false,
          mode: "frontend",
          error: err?.message || "Connection test failed",
        });
      }
      return;
    }

    if (action === "run_compare") {
      const { state, questions } = payload;
      this.emit("compare_started", { mode: "compare" });
      await Promise.all([
        callDecision1Browser(cfg, state, questions)
          .then((res) =>
            this.emit("compare_model_done", { tier: "decision1", result: res })
          )
          .catch((err) =>
            this.emit("compare_model_done", {
              tier: "decision1",
              error: err.message,
            })
          ),
        callTerraDecisionBrowser(cfg, state, questions)
          .then((res) =>
            this.emit("compare_model_done", { tier: "terra", result: res })
          )
          .catch((err) =>
            this.emit("compare_model_done", {
              tier: "terra",
              error: err.message,
            })
          ),
      ]);
      this.emit("compare_finished", {});
      return;
    }

    if (action === "stop_runtime") {
      if (this.runtimeAbort) {
        this.runtimeAbort.abort();
        this.runtimeAbort = null;
      }
      this.emit("runtime_stopped", {});
      return;
    }

    if (action === "start_runtime") {
      if (this.runtimeAbort) this.runtimeAbort.abort();
      const abortCtrl = new AbortController();
      this.runtimeAbort = abortCtrl;

      const scenario =
        RUNTIME_SCENARIOS.find((s) => s.id === payload.scenarioId) ||
        RUNTIME_SCENARIOS[0];
      const questions: DecisionQuestion[] =
        Array.isArray(payload.questions) && payload.questions.length > 0
          ? payload.questions
          : scenario.questions;
      const fields: Record<string, string> = {
        ...SHARED_ENTITY_FIELDS,
        ...scenario.extra,
      };

      const pick: Record<string, string> = {};
      for (const [k, arr] of Object.entries(scenario.fill)) {
        pick[k] = arr[Math.floor(Math.random() * arr.length)];
      }
      const ending =
        scenario.endings[Math.floor(Math.random() * scenario.endings.length)];
      pick.ending = ending.text;
      const filledPrompt = scenario.prompt.replace(
        /\{(\w+)\}/g,
        (_, k) => pick[k] || k
      );

      this.emit("runtime_started", {
        scenarioId: scenario.id,
        pick,
        ending,
        questions,
      });

      let transcript = "";
      let d1Busy = false;
      let d1Pending = false;
      let terraBusy = false;
      let extractBusy = false;
      let extractPending = false;
      let spans: ExtractedSpan[] = [];

      const triggerDecision1 = () => {
        if (abortCtrl.signal.aborted) return;
        const snap = transcript;
        if (snap.length < 18) return;
        if (d1Busy) {
          d1Pending = true;
          return;
        }
        d1Busy = true;
        callDecision1Browser(cfg, scenario.header + snap, questions)
          .then((res) => {
            if (abortCtrl.signal.aborted) return;
            this.emit("runtime_decision", {
              tier: "decision1",
              latency_ms: res.latency_ms,
              answers: res.answers,
              wordCount: snap.trim().split(/\s+/).length,
            });
          })
          .catch(() => {})
          .finally(() => {
            d1Busy = false;
            if (d1Pending && !abortCtrl.signal.aborted) {
              d1Pending = false;
              triggerDecision1();
            }
          });
      };

      const triggerTerra = () => {
        if (abortCtrl.signal.aborted || terraBusy) return;
        const snap = transcript;
        if (snap.length < 40) return;
        terraBusy = true;
        callTerraDecisionBrowser(cfg, scenario.header + snap, questions)
          .then((res) => {
            if (abortCtrl.signal.aborted) return;
            this.emit("runtime_terra_decision", {
              tier: "terra",
              latency_ms: res.latency_ms,
              answers: res.answers,
              wordCount: snap.trim().split(/\s+/).length,
            });
          })
          .catch(() => {})
          .finally(() => {
            terraBusy = false;
          });
      };

      const triggerExtract = () => {
        if (abortCtrl.signal.aborted) return;
        const snap = transcript;
        if (snap.length < 25) return;
        if (extractBusy) {
          extractPending = true;
          return;
        }
        extractBusy = true;
        extractEntitiesBrowser(cfg, snap, fields)
          .then((res) => {
            if (abortCtrl.signal.aborted) return;
            spans = res.spans;
            this.emit("runtime_extract", {
              latency_ms: res.latency_ms,
              spans: res.spans,
            });
          })
          .catch(() => {})
          .finally(() => {
            extractBusy = false;
            if (extractPending && !abortCtrl.signal.aborted) {
              extractPending = false;
              triggerExtract();
            }
          });
      };

      try {
        let wordCounter = 0;
        await streamConversationBrowser(
          cfg,
          RUNTIME_SYSTEM_PROMPT,
          filledPrompt,
          (delta) => {
            if (abortCtrl.signal.aborted) return;
            transcript += delta;
            this.emit("runtime_token", { delta, transcript, spans });
            if (/\s/.test(delta)) {
              wordCounter++;
              triggerDecision1();
              if (wordCounter % 8 === 0) triggerTerra();
            }
            if (/[.!?\n]/.test(delta)) {
              triggerExtract();
            }
          },
          abortCtrl.signal
        );
        if (!abortCtrl.signal.aborted) {
          const [finalD1, finalTerra, finalExt] = await Promise.allSettled([
            callDecision1Browser(cfg, scenario.header + transcript, questions),
            callTerraDecisionBrowser(
              cfg,
              scenario.header + transcript,
              questions
            ),
            extractEntitiesBrowser(cfg, transcript, fields),
          ]);
          if (finalD1.status === "fulfilled") {
            this.emit("runtime_decision", {
              tier: "decision1",
              latency_ms: finalD1.value.latency_ms,
              answers: finalD1.value.answers,
              wordCount: transcript.trim().split(/\s+/).length,
            });
          }
          if (finalTerra.status === "fulfilled") {
            this.emit("runtime_terra_decision", {
              tier: "terra",
              latency_ms: finalTerra.value.latency_ms,
              answers: finalTerra.value.answers,
              wordCount: transcript.trim().split(/\s+/).length,
            });
          }
          if (finalExt.status === "fulfilled") {
            this.emit("runtime_extract", {
              latency_ms: finalExt.value.latency_ms,
              spans: finalExt.value.spans,
            });
          }
          this.emit("runtime_done", { transcript });
        }
      } catch (err: any) {
        if (!abortCtrl.signal.aborted) {
          this.emit("error", { message: err?.message || "Stream error" });
        }
      }
      return;
    }

    if (action === "stop_triage") {
      this.triageAbort = true;
      this.emit("triage_stopped", {});
      return;
    }

    if (action === "start_triage") {
      this.triageAbort = false;
      const rate = Number(payload.rate) || 10;
      const messages = TRIAGE_FEED.messages;
      const questions = TRIAGE_FEED.questions;
      const N = messages.length;

      this.emit("triage_started", { total: N, rate });
      const d1Queue: Array<{ idx: number; arrivedAt: number }> = [];
      const terraQueue: Array<{ idx: number; arrivedAt: number }> = [];
      let arrivedCount = 0;

      const arrivalPromise = (async () => {
        for (let i = 0; i < N; i++) {
          if (this.triageAbort) break;
          const now = performance.now();
          arrivedCount++;
          d1Queue.push({ idx: i, arrivedAt: now });
          terraQueue.push({ idx: i, arrivedAt: now });
          this.emit("triage_arrival", {
            index: i,
            text: messages[i],
            arrivedCount,
          });
          await new Promise((r) => setTimeout(r, 1000 / rate));
        }
      })();

      const runD1Worker = async () => {
        while (!this.triageAbort) {
          const item = d1Queue.shift();
          if (!item) {
            if (arrivedCount >= N) break;
            await new Promise((r) => setTimeout(r, 25));
            continue;
          }
          try {
            const res = await callDecision1Browser(
              cfg,
              messages[item.idx],
              questions
            );
            if (this.triageAbort) break;
            const wait_ms = Math.round(performance.now() - item.arrivedAt);
            this.emit("triage_item_done", {
              lane: "decision1",
              index: item.idx,
              latency_ms: res.latency_ms,
              wait_ms,
              answers: res.answers,
              spans: [],
            });
          } catch {
            // continue
          }
        }
      };

      const runTerraWorker = async () => {
        while (!this.triageAbort) {
          const item = terraQueue.shift();
          if (!item) {
            if (arrivedCount >= N) break;
            await new Promise((r) => setTimeout(r, 40));
            continue;
          }
          try {
            const res = await callTerraDecisionBrowser(
              cfg,
              messages[item.idx],
              questions
            );
            if (this.triageAbort) break;
            const wait_ms = Math.round(performance.now() - item.arrivedAt);
            this.emit("triage_item_done", {
              lane: "terra",
              index: item.idx,
              latency_ms: res.latency_ms,
              wait_ms,
              answers: res.answers,
            });
          } catch {
            // continue
          }
        }
      };

      await Promise.all([
        arrivalPromise,
        ...Array.from({ length: 8 }, () => runD1Worker()),
        ...Array.from({ length: 4 }, () => runTerraWorker()),
      ]);
      if (!this.triageAbort) {
        this.emit("triage_done", {});
      }
      return;
    }

    if (action === "run_agent_form") {
      const content = payload.content || CLAIM_DEMO.text;
      const gates = CLAIM_DEMO.gates;
      const formSpec = CLAIM_DEMO.form;
      const fieldsMap: Record<string, string> = {};
      for (const f of formSpec) fieldsMap[f.name] = f.definition;

      this.emit("agent_step", {
        step: "gate_start",
        icon: "⚡",
        text: `Evaluating <b>${gates.length} policy gates</b> on <code>Microsoft-Decision-1</code> vs <code>${cfg.terraDeployment}</code>`,
        status: "run",
        elapsed_ms: 0,
      });

      const t0 = performance.now();
      const [d1GateRes, terraGateRes, extractRes] = await Promise.all([
        callDecision1Browser(cfg, content, gates),
        callTerraDecisionBrowser(cfg, content, gates),
        extractEntitiesBrowser(cfg, content, fieldsMap),
      ]);

      this.emit("agent_gates_done", {
        decision1: d1GateRes,
        terra: terraGateRes,
      });

      this.emit("agent_step", {
        step: "gate_done",
        icon: "✓",
        text: `Policy gates evaluated: <b>Decision-1 in ${d1GateRes.latency_ms}ms</b> vs <b>${cfg.terraDeployment} in ${terraGateRes.latency_ms}ms</b>`,
        status: "ok",
        elapsed_ms: d1GateRes.latency_ms,
      });

      for (const spec of formSpec) {
        const extracted = extractRes.fields[spec.name];
        const val = extracted?.value || "";
        const conf = extracted?.confidence || 0;
        const spans = extracted?.spans || [];
        this.emit("agent_field_filled", {
          name: spec.name,
          label: spec.label,
          value: val,
          confidence: conf,
          status: !val ? "miss" : conf < 0.78 ? "review" : "ok",
          alternatives: [],
          spans,
        });
        await new Promise((r) => setTimeout(r, 45));
      }

      this.emit("agent_done", {
        total_ms: Math.round(performance.now() - t0),
      });
    }
  }
}
