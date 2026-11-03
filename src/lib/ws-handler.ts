import type { WebSocket } from "ws";
import {
  RUNTIME_SCENARIOS,
  RUNTIME_SYSTEM_PROMPT,
  SHARED_ENTITY_FIELDS,
  TRIAGE_FEED,
  CLAIM_DEMO,
  type DecisionQuestion,
} from "./demo-data";
import {
  DEFAULT_FOUNDRY_ENDPOINT,
  DECISION_DEPLOYMENT,
  TERRA_DEPLOYMENT,
  callDecision1,
  callGptTerraDecision,
  callTerraText,
  streamConversationFromTerra,
  extractSpansWithTerra,
  type ExtractedSpan,
} from "./foundry";

function send(ws: WebSocket, event: string, data: unknown) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ event, data, ts: Date.now() }));
  }
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Fast instant regex-assisted span detector for immediate visual feedback while LLM extraction is in-flight,
 * plus exact Northbrew product/part/competitor matcher for Triage.
 */
export function fastInstantSpans(text: string, extraField?: string, extraValues?: string[]): ExtractedSpan[] {
  const spans: ExtractedSpan[] = [];
  const addMatches = (regex: RegExp, field: string, prob = 0.96) => {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (text[end] === ":" && (start === 0 || text[start - 1] === "\n")) continue;
      spans.push({ field, text: m[0], start, end, probability: prob });
    }
  };

  addMatches(/(?:[$€£]\s?\d[\d,.]*(?:\s?(?:k|million|billion))?|\d[\d,.]*\s?(?:euros|dollars|pounds|GBP|EUR|USD))/gi, "money amount");
  addMatches(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "email address");
  addMatches(/(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3,4}[\s-]\d{3,4}(?:[\s-]\d{2,4})?\b/g, "phone number");
  addMatches(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|tomorrow|today|next\s+\w+|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?)\b/gi, "date");

  if (extraField && extraValues) {
    for (const val of extraValues) {
      if (!val) continue;
      const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      addMatches(new RegExp(`\\b${escaped}\\b`, "gi"), extraField, 0.95);
    }
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return spans;
}

export function extractTriageSpans(text: string): ExtractedSpan[] {
  const products = [
    "Barista Pro 3s",
    "Barista Pro 3",
    "Barista Mini",
    "MilkMate",
    "GrindMaster 2",
    "Cold Brew Tower",
    "descaling kit",
  ];
  const parts = [
    "steam wand",
    "drip tray",
    "portafilter handle",
    "portafilter",
    "water tank",
    "grind size dial",
    "glass carafe",
    "pressure gauge",
    "hopper lid",
    "milk jug",
    "display",
    "grinder",
    "burrs",
    "pump",
    "tank",
    "lid",
  ];
  const competitors = [
    "De'Longhi",
    "Breville",
    "Nespresso",
    "Keurig",
    "Jura",
    "Philips",
    "Smeg",
    "Moccamaster",
  ];

  const spans: ExtractedSpan[] = [];
  const scanList = (items: string[], field: string) => {
    for (const item of items) {
      const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(`\\b${escaped}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = rx.exec(text)) !== null) {
        spans.push({
          field,
          text: m[0],
          start: m.index,
          end: m.index + m[0].length,
          probability: 0.98,
        });
      }
    }
  };

  scanList(products, "product");
  scanList(parts, "part");
  scanList(competitors, "competitor");

  // Deduplicate overlapping spans (prefer longer match)
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const filtered: ExtractedSpan[] = [];
  let curEnd = 0;
  for (const s of spans) {
    if (s.start >= curEnd) {
      filtered.push(s);
      curEnd = s.end;
    }
  }
  return filtered;
}

interface ClientSession {
  runtimeAbort?: AbortController;
  triageTimer?: ReturnType<typeof setInterval>;
  triageAborted?: boolean;
}

export function attachWebSocketClient(ws: WebSocket) {
  const session: ClientSession = {};

  ws.on("close", () => {
    session.runtimeAbort?.abort();
    if (session.triageTimer) clearInterval(session.triageTimer);
    session.triageAborted = true;
  });

  ws.on("message", async (raw) => {
    let msg: { action: string; payload?: Record<string, unknown> };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    const { action, payload = {} } = msg;

    if (action === "health_check") {
      const t0 = performance.now();
      const probe = await callDecision1("Health probe", [
        { id: "ok", label: "OK", type: "noul", instructions: "Is this a health probe?" },
      ]);
      send(ws, "health_status", {
        ok: probe.ok,
        endpoint: DEFAULT_FOUNDRY_ENDPOINT,
        activeDecisionEndpoint: probe.endpointUsed,
        decisionDeployment: DECISION_DEPLOYMENT,
        terraDeployment: TERRA_DEPLOYMENT,
        round_trip_ms: Math.round(performance.now() - t0),
        decision_latency_ms: probe.latency_ms,
      });
      return;
    }

    if (action === "stop_runtime") {
      session.runtimeAbort?.abort();
      send(ws, "runtime_stopped", {});
      return;
    }

    if (action === "start_runtime") {
      session.runtimeAbort?.abort();
      const ctrl = new AbortController();
      session.runtimeAbort = ctrl;

      const scenarioId = String(payload.scenarioId || "dealer");
      const sc = RUNTIME_SCENARIOS.find((s) => s.id === scenarioId) || RUNTIME_SCENARIOS[0];
      const activeQuestions: DecisionQuestion[] =
        Array.isArray(payload.questions) && payload.questions.length > 0
          ? (payload.questions as DecisionQuestion[])
          : sc.questions;
      const pick = Object.fromEntries(
        Object.entries(sc.fill).map(([k, v]) => [k, pickOne(v)])
      );
      const ending = pickOne(sc.endings);
      const prompt = sc.prompt.replace(/\{(\w+)\}/g, (m, k) =>
        k === "ending" ? ending.text : pick[k] ?? m
      );

      send(ws, "runtime_started", {
        scenarioId: sc.id,
        pick,
        ending,
        questions: activeQuestions,
        headerLen: sc.header.length,
      });

      let transcript = "";
      let decBusy = false;
      let decDoneText = "";
      let terraBusy = false;
      let terraDoneText = "";
      let exBusy = false;
      let exDoneText = "";

      const fields = { ...SHARED_ENTITY_FIELDS, ...sc.extra };

      const triggerDecision1 = async (force = false) => {
        if (ctrl.signal.aborted) return;
        if (decBusy || (!force && transcript.length < 30) || transcript === decDoneText) return;
        decBusy = true;
        const snapshot = transcript;
        const stateText = sc.header + snapshot;
        const res = await callDecision1(stateText, activeQuestions);
        decBusy = false;
        if (ctrl.signal.aborted) return;
        decDoneText = snapshot;
        if (res.ok) {
          send(ws, "runtime_decision", {
            tier: "decision1",
            model: res.model,
            latency_ms: res.latency_ms,
            chars: stateText.length,
            textLen: snapshot.length,
            answers: res.answers,
            usage: res.usage,
          });
        }
        if (transcript !== snapshot && !ctrl.signal.aborted) {
          triggerDecision1();
        }
      };

      const triggerTerraDecision = async (force = false) => {
        if (ctrl.signal.aborted) return;
        if (terraBusy || (!force && transcript.length < 60) || transcript === terraDoneText) return;
        terraBusy = true;
        const snapshot = transcript;
        const stateText = sc.header + snapshot;
        const res = await callGptTerraDecision(stateText, activeQuestions);
        terraBusy = false;
        if (ctrl.signal.aborted) return;
        terraDoneText = snapshot;
        if (res.ok) {
          send(ws, "runtime_terra_decision", {
            tier: "terra",
            model: res.model,
            latency_ms: res.latency_ms,
            chars: stateText.length,
            textLen: snapshot.length,
            answers: res.answers,
            usage: res.usage,
          });
        }
        if (transcript !== snapshot && !ctrl.signal.aborted) {
          triggerTerraDecision();
        }
      };

      let latestLlmSpans: ExtractedSpan[] = [];

      const mergeSpans = (textSnapshot: string, llmSpans: ExtractedSpan[]): ExtractedSpan[] => {
        const instant = fastInstantSpans(textSnapshot);
        const all = [...llmSpans, ...instant].filter(
          (s) => s.start >= 0 && s.end > s.start && s.end <= textSnapshot.length
        );
        all.sort((a, b) => a.start - b.start || b.end - a.end);
        const out: ExtractedSpan[] = [];
        let cur = 0;
        for (const s of all) {
          if (s.start >= cur) {
            out.push(s);
            cur = s.end;
          }
        }
        return out;
      };

      const triggerExtract = async (force = false) => {
        if (ctrl.signal.aborted) return;
        if (exBusy || (!force && transcript.length < 45) || transcript === exDoneText) return;
        exBusy = true;
        const snapshot = transcript;
        const res = await extractSpansWithTerra(snapshot, fields);
        exBusy = false;
        if (ctrl.signal.aborted) return;
        exDoneText = snapshot;
        if (res.ok) {
          latestLlmSpans = res.spans;
          send(ws, "runtime_extract", {
            latency_ms: res.latency_ms,
            spans: mergeSpans(transcript, latestLlmSpans),
            usage: res.usage,
          });
        }
        if (transcript !== snapshot && !ctrl.signal.aborted) {
          triggerExtract();
        }
      };

      const t0 = performance.now();
      let wordCountAtLastDec = 0;

      const streamRes = await streamConversationFromTerra(
        RUNTIME_SYSTEM_PROMPT,
        prompt,
        (delta) => {
          transcript += delta;
          const words = (transcript.match(/\S+/g) || []).length;
          send(ws, "runtime_token", {
            delta,
            transcript,
            words,
            spans: mergeSpans(transcript, latestLlmSpans),
            elapsed_ms: Math.round(performance.now() - t0),
          });

          // Trigger Microsoft-Decision-1 on every new word boundary
          if (words > wordCountAtLastDec) {
            wordCountAtLastDec = words;
            triggerDecision1();
            triggerTerraDecision();
            triggerExtract();
          }
        },
        ctrl.signal
      );

      if (!ctrl.signal.aborted) {
        // Final evaluation pass on complete transcript
        await Promise.all([
          triggerDecision1(true),
          triggerTerraDecision(true),
          triggerExtract(true),
        ]);
        send(ws, "runtime_done", {
          ok: streamRes.ok,
          usage: streamRes.usage,
          model: streamRes.model,
          elapsed_ms: Math.round(performance.now() - t0),
          error: streamRes.error,
        });
      }
      return;
    }

    if (action === "run_compare") {
      const state = payload.state ?? "";
      const questions = (payload.questions as DecisionQuestion[]) || [];
      const mode = String(payload.mode || "compare");
      const tiers =
        mode === "decision1"
          ? (["decision1"] as const)
          : mode === "terra"
          ? (["terra"] as const)
          : (["decision1", "terra"] as const);

      send(ws, "compare_started", { tiers, questionCount: questions.length });

      const results: Record<string, Awaited<ReturnType<typeof callDecision1>>> = {};

      await Promise.all(
        tiers.map(async (tier) => {
          const res =
            tier === "decision1"
              ? await callDecision1(state, questions)
              : await callGptTerraDecision(state, questions);
          results[tier] = res;
          send(ws, "compare_model_done", { tier, result: res });
        })
      );

      const d1 = results.decision1;
      const tr = results.terra;
      let agreed = 0;
      if (d1 && tr && d1.ok && tr.ok) {
        for (const q of questions) {
          if (d1.answers[q.id]?.label === tr.answers[q.id]?.label) {
            agreed++;
          }
        }
      }
      const speedup =
        d1?.ok && tr?.ok && d1.latency_ms > 0
          ? Number((tr.latency_ms / d1.latency_ms).toFixed(1))
          : null;

      send(ws, "compare_finished", {
        speedup,
        agreed,
        totalQuestions: questions.length,
      });
      return;
    }

    if (action === "stop_triage") {
      if (session.triageTimer) clearInterval(session.triageTimer);
      session.triageAborted = true;
      send(ws, "triage_stopped", {});
      return;
    }

    if (action === "start_triage") {
      if (session.triageTimer) clearInterval(session.triageTimer);
      session.triageAborted = false;

      const rate = Math.max(1, Math.min(30, Number(payload.rate) || 10));
      const raceTerra = payload.raceTerra !== false;
      const messages = TRIAGE_FEED.messages;
      const questions = TRIAGE_FEED.questions;
      const total = messages.length;

      const arrivalTimes = new Map<number, number>();
      const d1Queue: number[] = [];
      const terraQueue: number[] = [];
      let d1Inflight = 0;
      let terraInflight = 0;
      let d1Done = 0;
      let terraDone = 0;
      let arrived = 0;

      const D1_CONCURRENCY = 8;
      const TERRA_CONCURRENCY = 4;

      const checkAllDone = () => {
        if (session.triageAborted) return;
        if (arrived >= total && d1Done >= total && (!raceTerra || terraDone >= total)) {
          send(ws, "triage_done", { total });
        }
      };

      const pumpD1 = () => {
        while (!session.triageAborted && d1Inflight < D1_CONCURRENCY && d1Queue.length > 0) {
          const idx = d1Queue.shift()!;
          d1Inflight++;
          const msgText = messages[idx];
          callDecision1(msgText, questions)
            .then((res) => {
              if (session.triageAborted) return;
              const wait_ms = Math.round(performance.now() - (arrivalTimes.get(idx) || performance.now()));
              const spans = extractTriageSpans(msgText);
              d1Done++;
              send(ws, "triage_item_done", {
                lane: "decision1",
                index: idx,
                ok: res.ok,
                wait_ms,
                latency_ms: res.latency_ms,
                answers: res.answers,
                spans,
                usage: res.usage,
              });
            })
            .finally(() => {
              d1Inflight--;
              pumpD1();
              checkAllDone();
            });
        }
      };

      const pumpTerra = () => {
        if (!raceTerra) return;
        while (!session.triageAborted && terraInflight < TERRA_CONCURRENCY && terraQueue.length > 0) {
          const idx = terraQueue.shift()!;
          terraInflight++;
          const msgText = messages[idx];
          callGptTerraDecision(msgText, questions)
            .then((res) => {
              if (session.triageAborted) return;
              const wait_ms = Math.round(performance.now() - (arrivalTimes.get(idx) || performance.now()));
              terraDone++;
              send(ws, "triage_item_done", {
                lane: "terra",
                index: idx,
                ok: res.ok,
                wait_ms,
                latency_ms: res.latency_ms,
                answers: res.answers,
                usage: res.usage,
              });
            })
            .finally(() => {
              terraInflight--;
              pumpTerra();
              checkAllDone();
            });
        }
      };

      const arriveNext = () => {
        if (session.triageAborted || arrived >= total) {
          if (session.triageTimer) clearInterval(session.triageTimer);
          return;
        }
        const idx = arrived++;
        arrivalTimes.set(idx, performance.now());
        send(ws, "triage_arrival", {
          index: idx,
          text: messages[idx],
          arrivedCount: arrived,
          total,
        });
        d1Queue.push(idx);
        if (raceTerra) terraQueue.push(idx);
        pumpD1();
        pumpTerra();
      };

      send(ws, "triage_started", { total, rate, raceTerra });
      arriveNext();
      session.triageTimer = setInterval(arriveNext, Math.round(1000 / rate));
      return;
    }

    if (action === "run_agent_form") {
      const content = String(payload.content || CLAIM_DEMO.text);
      const t0 = performance.now();
      const elapsed = () => Math.round(performance.now() - t0);

      send(ws, "agent_step", {
        icon: "→",
        text: `Received claim email from <b>${CLAIM_DEMO.from.replace(/\s*<.*>/, "")}</b>`,
        status: "info",
        elapsed_ms: elapsed(),
      });

      send(ws, "agent_step", {
        icon: "⚡",
        text: `Evaluating ${CLAIM_DEMO.gates.length} policy & eligibility gates with <b>Microsoft-Decision-1</b> vs <b>gpt-6.1-terra</b>…`,
        status: "running",
        elapsed_ms: elapsed(),
      });

      const [d1Gates, terraGates] = await Promise.all([
        callDecision1(content, CLAIM_DEMO.gates),
        callGptTerraDecision(content, CLAIM_DEMO.gates),
      ]);

      send(ws, "agent_gates_done", {
        decision1: d1Gates,
        terra: terraGates,
        elapsed_ms: elapsed(),
      });

      send(ws, "agent_step", {
        icon: "✓",
        text: `<b>Microsoft-Decision-1</b> evaluated ${CLAIM_DEMO.gates.length} policy gates in <b>${d1Gates.latency_ms} ms</b> (vs <b>gpt-6.1-terra</b> in <b>${terraGates.latency_ms} ms</b>)`,
        status: "ok",
        elapsed_ms: elapsed(),
      });

      // Extract structured form fields using gpt-6.1-terra
      const fieldSpecs = CLAIM_DEMO.form.map((f) => `- "${f.name}": ${f.definition}`).join("\n");
      const sys = `You extract motor insurance claim form fields from an email. Return ONLY valid JSON:
{
  "fields": {
    "<field_name>": {
      "value": "<extracted string or null if absent>",
      "raw_quote": "<exact substring in the email or null>",
      "confidence": <number 0.0 to 1.0>,
      "alternatives": ["<optional candidate 1>", "<optional candidate 2>"]
    }
  }
}
Important: If there are two phone numbers in the email (e.g. other driver's phone vs policyholder's phone at the bottom), include both in "alternatives" for "policyholder phone" with confidence 0.55 so the human agent can review it. If police report number is not provided, set value to null.`;

      const exRes = await callTerraText(sys, `EMAIL:\n${content}\n\nFIELDS:\n${fieldSpecs}`, 900);
      let parsedFields: Record<
        string,
        { value: string | null; raw_quote?: string | null; confidence?: number; alternatives?: string[] }
      > = {};
      if (exRes.ok) {
        try {
          const cleaned = exRes.text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
          const obj = JSON.parse(cleaned);
          parsedFields = obj.fields || obj;
        } catch {
          const m = exRes.text.match(/\{[\s\S]*\}/);
          if (m) {
            try {
              const obj = JSON.parse(m[0]);
              parsedFields = obj.fields || obj;
            } catch {
              parsedFields = {};
            }
          }
        }
      }

      let okCount = 0;
      let reviewCount = 0;
      let missCount = 0;

      for (let i = 0; i < CLAIM_DEMO.form.length; i++) {
        const f = CLAIM_DEMO.form[i];
        const ext = parsedFields[f.name] || { value: null, confidence: 0 };
        const val = ext.value ? String(ext.value).trim() : "";
        const conf = typeof ext.confidence === "number" ? ext.confidence : val ? 0.92 : 0;
        const alts = Array.isArray(ext.alternatives) ? ext.alternatives.filter(Boolean) : [];
        const st: "ok" | "review" | "miss" = !val
          ? "miss"
          : conf < 0.65 || alts.length > 1
          ? "review"
          : "ok";

        if (st === "ok") okCount++;
        else if (st === "review") reviewCount++;
        else missCount++;

        const spans: Array<{ start: number; end: number; text: string }> = [];
        const needle = (ext.raw_quote || val).trim();
        if (needle && content.includes(needle)) {
          const start = content.indexOf(needle);
          spans.push({ start, end: start + needle.length, text: needle });
        }

        send(ws, "agent_field_filled", {
          index: i,
          name: f.name,
          label: f.label,
          value: val,
          raw: ext.raw_quote || val,
          confidence: conf,
          status: st,
          alternatives: alts,
          spans,
        });

        if (st === "review") {
          send(ws, "agent_step", {
            icon: "?",
            text: `<b>${f.label}</b>: ${alts.length > 1 ? `${alts.length} candidates found` : "low confidence"}, flagged for review`,
            status: "review",
            elapsed_ms: elapsed(),
          });
        } else if (st === "miss") {
          send(ws, "agent_step", {
            icon: "×",
            text: `<b>${f.label}</b>: missing from email`,
            status: "miss",
            elapsed_ms: elapsed(),
          });
        }
      }

      const fastTrackAns = d1Gates.answers["fast_track"];
      send(ws, "agent_step", {
        icon: fastTrackAns?.label === "Yes" ? "✓" : "→",
        text:
          fastTrackAns?.label === "Yes"
            ? `<b>Microsoft-Decision-1 Gate</b>: Fast-track eligible (${fastTrackAns.detail})`
            : `<b>Microsoft-Decision-1 Gate</b>: Requires manual adjuster review (${fastTrackAns?.detail || "–"})`,
        status: fastTrackAns?.label === "Yes" ? "ok" : "review",
        elapsed_ms: elapsed(),
      });

      send(ws, "agent_done", {
        okCount,
        reviewCount,
        missCount,
        totalFields: CLAIM_DEMO.form.length,
        elapsed_ms: elapsed(),
      });
    }
  });
}
