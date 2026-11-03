import { DefaultAzureCredential } from "@azure/identity";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DecisionQuestion } from "./demo-data";

const execFileAsync = promisify(execFile);

export const DEFAULT_FOUNDRY_ENDPOINT =
  process.env.AZURE_FOUNDRY_ENDPOINT || "https://icsuaaisea.cognitiveservices.azure.com";
export const FALLBACK_DECISION_ENDPOINT =
  process.env.AZURE_FALLBACK_DECISION_ENDPOINT || "https://icsuaaije.cognitiveservices.azure.com";
export const DECISION_DEPLOYMENT = process.env.AZURE_DECISION_DEPLOYMENT || "Decision-1";
export const TERRA_DEPLOYMENT = process.env.AZURE_TERRA_DEPLOYMENT || "gpt-6.1-terra";

const TOKEN_SCOPE = "https://cognitiveservices.azure.com/.default";
const credential = new DefaultAzureCredential();

let cachedToken: { token: string; expiresOn: number } | null = null;

export async function getEntraToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresOn - now > 120_000) {
    return cachedToken.token;
  }
  try {
    const t = await credential.getToken(TOKEN_SCOPE);
    if (t && t.token) {
      cachedToken = {
        token: t.token,
        expiresOn: t.expiresOnTimestamp || now + 3000_000,
      };
      return t.token;
    }
  } catch {
    // Fallback to az CLI directly
  }

  const { stdout } = await execFileAsync("az", [
    "account",
    "get-access-token",
    "--resource",
    "https://cognitiveservices.azure.com",
    "--query",
    "accessToken",
    "-o",
    "tsv",
  ]);
  const token = stdout.trim();
  cachedToken = {
    token,
    expiresOn: now + 1800_000,
  };
  return token;
}

export interface NormalizedDecision {
  id: string;
  type: "noul" | "choice" | "score";
  value: number; // 0..1 normalized for meter/sparkline
  label: string;
  cls: "yes" | "no" | "unsure" | "choice" | "scale";
  key: string | number | null;
  detail: string;
  confidence: number;
  rawScore?: number;
  probabilities?: Record<string, number>;
  raw: unknown;
}

export interface DecisionRunResult {
  ok: boolean;
  status: number;
  model: string;
  endpointUsed: string;
  latency_ms: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens?: number;
  };
  answers: Record<string, NormalizedDecision>;
  rawPayload: unknown;
  rawText?: string;
  requestPayload: unknown;
  error?: string;
}

export function buildSystemOnePayload(
  state: unknown,
  questions: DecisionQuestion[],
  deploymentName = DECISION_DEPLOYMENT
) {
  const qMap: Record<string, Record<string, unknown>> = {};
  for (const q of questions) {
    const entry: Record<string, unknown> = {
      type: q.type,
      instructions: q.instructions,
    };
    if (q.criteria) {
      entry.criteria = q.criteria;
    }
    qMap[q.id] = entry;
  }
  return {
    model: deploymentName,
    state,
    questions: qMap,
  };
}

export function normalizeDecision1Answer(
  q: DecisionQuestion,
  ans: Record<string, unknown> | undefined
): NormalizedDecision {
  if (!ans) {
    return {
      id: q.id,
      type: q.type,
      value: 0.5,
      label: "–",
      cls: "unsure",
      key: null,
      detail: "no answer",
      confidence: 0,
      raw: null,
    };
  }

  if (q.type === "noul") {
    const p = typeof ans.noul === "number" ? ans.noul : 0.5;
    const isYes = p >= 0.6;
    const isNo = p <= 0.4;
    const label = isYes ? "Yes" : isNo ? "No" : "Unsure";
    const cls = isYes ? "yes" : isNo ? "no" : "unsure";
    const key = isYes ? "yes" : isNo ? "no" : null;
    const confidence = Math.max(p, 1 - p);
    return {
      id: q.id,
      type: "noul",
      value: p,
      label,
      cls,
      key,
      detail: `${Math.round(p * 100)}% yes`,
      confidence,
      probabilities: { true: p, false: 1 - p },
      raw: ans,
    };
  }

  if (q.type === "score") {
    const levels = Array.isArray(q.criteria) ? q.criteria : ["Low", "Medium", "High"];
    const maxIdx = Math.max(1, levels.length - 1);
    const score = typeof ans.score === "number" ? ans.score : maxIdx / 2;
    const idx = Math.min(levels.length - 1, Math.max(0, Math.round(score)));
    const normVal = Math.min(1, Math.max(0, score / maxIdx));
    const probsRaw = (ans.probabilities as Record<string, number>) || {};
    const namedProbs: Record<string, number> = {};
    levels.forEach((lvl, i) => {
      namedProbs[lvl] = probsRaw[String(i)] ?? 0;
    });
    const confidence =
      typeof ans.confidence === "number" ? ans.confidence : probsRaw[String(idx)] ?? 0.8;
    return {
      id: q.id,
      type: "score",
      value: normVal,
      label: levels[idx] || String(idx),
      cls: "scale",
      key: idx,
      rawScore: score,
      detail: `${score.toFixed(2)} / ${maxIdx} (${Math.round(confidence * 100)}% conf)`,
      confidence,
      probabilities: namedProbs,
      raw: ans,
    };
  }

  // choice
  const probs = ((ans.probabilities as Record<string, number>) || {}) as Record<string, number>;
  const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  const choice = (typeof ans.choice === "string" ? ans.choice : sorted[0]?.[0]) || "–";
  const topProb = probs[choice] ?? sorted[0]?.[1] ?? 0;
  const confidence = typeof ans.confidence === "number" ? ans.confidence : topProb;
  const runnersUp = sorted
    .filter(([k]) => k !== choice)
    .slice(0, 2)
    .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
    .join(" · ");

  return {
    id: q.id,
    type: "choice",
    value: topProb,
    label: choice,
    cls: "choice",
    key: topProb >= 0.5 ? choice : null,
    detail: runnersUp ? `${Math.round(topProb * 100)}% · ${runnersUp}` : `${Math.round(topProb * 100)}% conf`,
    confidence,
    probabilities: probs,
    raw: ans,
  };
}

let cachedDecisionEndpoint: { url: string; until: number } | null = null;

export async function callDecision1(
  state: unknown,
  questions: DecisionQuestion[],
  customEndpoint?: string
): Promise<DecisionRunResult> {
  const token = await getEntraToken();
  const primaryBase = (customEndpoint || DEFAULT_FOUNDRY_ENDPOINT).replace(/\/+$/, "");
  const payload = buildSystemOnePayload(state, questions, DECISION_DEPLOYMENT);
  const bodyStr = JSON.stringify(payload);

  const now = Date.now();
  const endpointsToTry: string[] = [];
  if (!customEndpoint && cachedDecisionEndpoint && cachedDecisionEndpoint.until > now) {
    endpointsToTry.push(cachedDecisionEndpoint.url);
  }
  if (!endpointsToTry.includes(primaryBase)) {
    endpointsToTry.push(primaryBase);
  }
  const fallbackClean = FALLBACK_DECISION_ENDPOINT.replace(/\/+$/, "");
  if (fallbackClean && !endpointsToTry.includes(fallbackClean)) {
    endpointsToTry.push(fallbackClean);
  }

  let lastErr = "";
  let lastStatus = 500;

  for (const base of endpointsToTry) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${base}/providers/microsoft/v1/systemone`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: bodyStr,
      });

      const latency_ms = Math.round(performance.now() - t0);
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { detail: text };
      }

      if (!res.ok) {
        lastStatus = res.status;
        lastErr = JSON.stringify(data);
        // If 401/403 RBAC cache propagation on primary, try fallback immediately
        if ((res.status === 401 || res.status === 403 || res.status === 404) && endpointsToTry.length > 1) {
          continue;
        }
        return {
          ok: false,
          status: res.status,
          model: "Microsoft-Decision-1",
          endpointUsed: base,
          latency_ms,
          usage: { input_tokens: 0, output_tokens: 0 },
          answers: {},
          rawPayload: data,
          requestPayload: payload,
          error: lastErr,
        };
      }

      const rawAnswers = (data.answers || {}) as Record<string, Record<string, unknown>>;
      const normalized: Record<string, NormalizedDecision> = {};
      for (const q of questions) {
        normalized[q.id] = normalizeDecision1Answer(q, rawAnswers[q.id]);
      }

      if (!customEndpoint) {
        cachedDecisionEndpoint = { url: base, until: Date.now() + 60_000 };
      }

      const usageObj = (data.usage || {}) as Record<string, number>;
      return {
        ok: true,
        status: res.status,
        model: String(data.model || "microsoft-decision-1"),
        endpointUsed: base,
        latency_ms,
        usage: {
          input_tokens: usageObj.input_tokens ?? 0,
          output_tokens: usageObj.output_tokens ?? 0,
        },
        answers: normalized,
        rawPayload: data,
        requestPayload: payload,
      };
    } catch (err) {
      lastErr = String(err);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    model: "Microsoft-Decision-1",
    endpointUsed: primaryBase,
    latency_ms: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    answers: {},
    rawPayload: { error: lastErr },
    requestPayload: payload,
    error: lastErr,
  };
}

/**
 * Call gpt-6.1-terra on https://icsuaaisea.cognitiveservices.azure.com
 * Supports both /openai/v1/responses and /openai/v1/chat/completions
 */
export async function callTerraText(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600,
  customEndpoint?: string
): Promise<{
  ok: boolean;
  status: number;
  text: string;
  latency_ms: number;
  usage: { input_tokens: number; output_tokens: number; reasoning_tokens: number };
  model: string;
  error?: string;
}> {
  const token = await getEntraToken();
  const base = (customEndpoint || DEFAULT_FOUNDRY_ENDPOINT).replace(/\/+$/, "");
  const t0 = performance.now();

  // First try /openai/v1/responses on icsuaaisea (verified 200 OK with low latency & 0 reasoning overhead)
  try {
    const res = await fetch(`${base}/openai/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: TERRA_DEPLOYMENT,
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: maxTokens,
      }),
    });

    const latency_ms = Math.round(performance.now() - t0);
    if (res.ok) {
      const data = await res.json();
      let outText = "";
      for (const item of data.output || []) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text" && c.text) outText += c.text;
          }
        }
      }
      const usage = data.usage || {};
      return {
        ok: true,
        status: res.status,
        text: outText,
        latency_ms,
        usage: {
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
        },
        model: data.model || TERRA_DEPLOYMENT,
      };
    }

    // Fallback to /openai/v1/chat/completions if needed
    const chatRes = await fetch(`${base}/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: TERRA_DEPLOYMENT,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: maxTokens,
      }),
    });
    const chatLatency = Math.round(performance.now() - t0);
    const chatData = await chatRes.json().catch(() => ({}));
    if (chatRes.ok) {
      const text = chatData.choices?.[0]?.message?.content || "";
      const u = chatData.usage || {};
      return {
        ok: true,
        status: chatRes.status,
        text,
        latency_ms: chatLatency,
        usage: {
          input_tokens: u.prompt_tokens ?? 0,
          output_tokens: u.completion_tokens ?? 0,
          reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
        },
        model: chatData.model || TERRA_DEPLOYMENT,
      };
    }

    return {
      ok: false,
      status: res.status,
      text: "",
      latency_ms: chatLatency,
      usage: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 },
      model: TERRA_DEPLOYMENT,
      error: JSON.stringify(chatData),
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      text: "",
      latency_ms: Math.round(performance.now() - t0),
      usage: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 },
      model: TERRA_DEPLOYMENT,
      error: String(err),
    };
  }
}

/**
 * Evaluate the exact same typed questions using gpt-6.1-terra for head-to-head comparison
 */
export async function callGptTerraDecision(
  state: unknown,
  questions: DecisionQuestion[],
  customEndpoint?: string
): Promise<DecisionRunResult> {
  const schemaPrompt = questions
    .map((q) => {
      if (q.type === "noul") {
        return `- "${q.id}" (type: "noul"): ${q.instructions} -> Return {"type": "noul", "noul": <probability 0.0 to 1.0>}`;
      }
      if (q.type === "score") {
        const levels = Array.isArray(q.criteria) ? q.criteria : [];
        return `- "${q.id}" (type: "score"): ${q.instructions}. Scale levels (0 to ${levels.length - 1}): ${levels
          .map((l, i) => `${i}="${l}"`)
          .join(", ")} -> Return {"type": "score", "score": <float 0.0 to ${
          levels.length - 1
        }>, "confidence": <0.0 to 1.0>, "probabilities": {${levels
          .map((_, i) => `"${i}": <prob>`)
          .join(", ")}}}`;
      }
      const opts = q.criteria && !Array.isArray(q.criteria) ? Object.keys(q.criteria) : [];
      return `- "${q.id}" (type: "choice"): ${q.instructions}. Options: ${JSON.stringify(
        q.criteria
      )} -> Return {"type": "choice", "choice": <one of ${JSON.stringify(
        opts
      )}>, "confidence": <0.0 to 1.0>, "probabilities": {${opts
        .map((o) => `"${o}": <prob>`)
        .join(", ")}}}`;
    })
    .join("\n");

  const systemPrompt =
    "You are an analytical decision evaluator being compared against Microsoft-Decision-1. Respond ONLY with a valid JSON object containing an \"answers\" key mapping each question ID to its typed decision object. Do not wrap in markdown code fences.";
  const userPrompt = `STATE:\n${
    typeof state === "string" ? state : JSON.stringify(state, null, 2)
  }\n\nQUESTIONS TO EVALUATE:\n${schemaPrompt}\n\nReturn JSON: {"answers": { ... }}`;

  const reqPayload = {
    model: TERRA_DEPLOYMENT,
    instructions: systemPrompt,
    input: userPrompt,
  };

  const res = await callTerraText(systemPrompt, userPrompt, 800, customEndpoint);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      model: TERRA_DEPLOYMENT,
      endpointUsed: customEndpoint || DEFAULT_FOUNDRY_ENDPOINT,
      latency_ms: res.latency_ms,
      usage: res.usage,
      answers: {},
      rawPayload: { error: res.error },
      requestPayload: reqPayload,
      error: res.error,
    };
  }

  let parsed: Record<string, unknown> = {};
  try {
    const cleaned = res.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const match = res.text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = {};
      }
    }
  }

  const rawAnswers = ((parsed.answers || parsed) as Record<string, Record<string, unknown>>) || {};
  const normalized: Record<string, NormalizedDecision> = {};
  for (const q of questions) {
    normalized[q.id] = normalizeDecision1Answer(q, rawAnswers[q.id]);
  }

  return {
    ok: true,
    status: 200,
    model: res.model,
    endpointUsed: customEndpoint || DEFAULT_FOUNDRY_ENDPOINT,
    latency_ms: res.latency_ms,
    usage: res.usage,
    answers: normalized,
    rawPayload: {
      model: res.model,
      answers: rawAnswers,
      usage: res.usage,
    },
    rawText: res.text,
    requestPayload: reqPayload,
  };
}

/**
 * Stream a conversation from gpt-6.1-terra via SSE on /openai/v1/responses
 */
export async function streamConversationFromTerra(
  systemPrompt: string,
  userPrompt: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
  customEndpoint?: string
): Promise<{
  ok: boolean;
  fullText: string;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  error?: string;
}> {
  const token = await getEntraToken();
  const base = (customEndpoint || DEFAULT_FOUNDRY_ENDPOINT).replace(/\/+$/, "");

  const res = await fetch(`${base}/openai/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: TERRA_DEPLOYMENT,
      instructions: systemPrompt,
      input: userPrompt,
      max_output_tokens: 1600,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "stream request failed");
    return {
      ok: false,
      fullText: "",
      usage: { input_tokens: 0, output_tokens: 0 },
      model: TERRA_DEPLOYMENT,
      error: `HTTP ${res.status}: ${errText}`,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let fullText = "";
  let usage = { input_tokens: 0, output_tokens: 0 };
  let model = TERRA_DEPLOYMENT;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let dataStr = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("data:")) {
          dataStr += line.slice(5).trim();
        }
      }
      if (!dataStr || dataStr === "[DONE]") continue;
      try {
        const evt = JSON.parse(dataStr);
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          fullText += evt.delta;
          onDelta(evt.delta);
        } else if (evt.type === "response.completed" && evt.response) {
          model = evt.response.model || model;
          if (evt.response.usage) {
            usage = {
              input_tokens: evt.response.usage.input_tokens ?? 0,
              output_tokens: evt.response.usage.output_tokens ?? 0,
            };
          }
        }
      } catch {
        // ignore partial JSON
      }
    }
  }

  return { ok: true, fullText, usage, model };
}

export interface ExtractedSpan {
  field: string;
  text: string;
  value?: unknown;
  start: number;
  end: number;
  probability: number;
}

/**
 * Extract entity mentions and map them to Unicode character offsets [start, end)
 * Uses gpt-6.1-terra + deterministic span locator so all mentions appear with exact offsets.
 */
export async function extractSpansWithTerra(
  content: string,
  fields: Record<string, string>,
  customEndpoint?: string
): Promise<{
  ok: boolean;
  latency_ms: number;
  spans: ExtractedSpan[];
  usage: { input_tokens: number; output_tokens: number };
}> {
  const t0 = performance.now();
  const fieldDesc = Object.entries(fields)
    .map(([k, v]) => `- "${k}": ${v || k}`)
    .join("\n");

  const sys =
    'Extract every exact substring mention from the text for each requested field. Respond ONLY with JSON: {"mentions": {"<field>": ["exact substring 1", "exact substring 2"]}}. Do not include speaker labels at the start of a line (such as "Marco:").';
  const usr = `TEXT:\n${content}\n\nFIELDS:\n${fieldDesc}`;

  const res = await callTerraText(sys, usr, 600, customEndpoint);
  const latency_ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    return { ok: false, latency_ms, spans: [], usage: res.usage };
  }

  let parsed: Record<string, unknown> = {};
  try {
    const cleaned = res.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const m = res.text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = {};
      }
    }
  }

  const mentionsMap = ((parsed.mentions || parsed) as Record<string, unknown>) || {};
  const spans: ExtractedSpan[] = [];

  for (const [field, rawList] of Object.entries(mentionsMap)) {
    if (!(field in fields)) continue;
    const items = Array.isArray(rawList) ? rawList : [];
    for (const item of items) {
      const needle = typeof item === "string" ? item.trim() : typeof item === "object" && item && "text" in item ? String((item as {text: string}).text).trim() : "";
      if (!needle) continue;
      let searchFrom = 0;
      while (searchFrom < content.length) {
        const pos = content.indexOf(needle, searchFrom);
        if (pos < 0) break;
        const end = pos + needle.length;
        // Skip speaker labels at the start of a line ("Marco:")
        const isSpeakerPrefix =
          content[end] === ":" && (pos === 0 || content[pos - 1] === "\n");
        if (!isSpeakerPrefix) {
          spans.push({
            field,
            text: needle,
            start: pos,
            end,
            probability: 0.94,
          });
        }
        searchFrom = end;
      }
    }
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    ok: true,
    latency_ms,
    spans,
    usage: res.usage,
  };
}
