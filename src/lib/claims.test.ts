import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_CASES, CLAIM_FIELDS, CLAIM_QUESTIONS, claimOutcome, claimRequest, parseClaimFields, type ClaimCase } from "./claims";
import { runClaimWorkflow } from "./claim-workflow";
import { recordingMatches } from "./replay";
import type { DecisionRunResult } from "./foundry";
import { BrowserFoundryDispatcher, DEFAULT_AZURE_CONFIG } from "./client-foundry";
import { claimSourceLinks, claimSourceSegments } from "./claim-evidence";

function result(expected: Record<string, string>): DecisionRunResult {
  return { ok: true, status: 200, model: "test", endpointUsed: "", latency_ms: 100,
    usage: { input_tokens: 100, output_tokens: 0 }, rawPayload: null, requestPayload: null,
    answers: Object.fromEntries(CLAIM_QUESTIONS.map((question) => {
      const key = expected[question.id].toLowerCase();
      return [question.id, { id: question.id, type: question.type, key, label: expected[question.id],
        value: key === "no" ? 0 : 1, confidence: 1, cls: question.type === "choice" ? "choice" : key,
        detail: "", raw: null }];
    })) as DecisionRunResult["answers"] };
}

function extraction(example: ClaimCase) {
  const values = ["Casey Morgan", "CM-2048", "07700 900123", "2 November 2026", "18:40",
    "the junction of Oak Street and Park Road", "Toyota Corolla", "AB12 CDE", "The rear bumper and boot lid were damaged.",
    example.content.match(/repair estimate is (GBP [\d,]+)/)![1], "Alex Reed", "Example Mutual",
    example.expected.police_reference === "Yes" ? "POL-2026-2048" : null];
  return JSON.stringify({ fields: Object.fromEntries(CLAIM_FIELDS.map((field, index) =>
    [field.name, { value: values[index], quote: values[index], confidence: 0.99 }])) });
}

for (const example of CLAIM_CASES) {
  test(`Claims policy applies safely: ${example.id}`, () => {
    for (const quotes of Object.values(example.evidence)) for (const quote of quotes) assert(example.content.includes(quote), "Reference quotes must exist verbatim");
    const outcome = claimOutcome(result(example.expected), parseClaimFields(extraction(example), example.content));
    assert.equal(outcome.status, example.expected.claim_route);
    if (outcome.status !== "fast_track_candidate") assert(!outcome.reply.includes("suitable for fast-track"));
    assert(!outcome.reply.includes("Casey Morgan"), "Replies must not substitute default customer details");
  });
}

test("positive route cannot override injury, unknown facts or an extracted >=5000 estimate", () => {
  for (const id of ["injury", "over-limit", "exact-limit"]) {
    const example = CLAIM_CASES.find((item) => item.id === id)!;
    const decision = result({ ...example.expected, claim_route: "fast_track_candidate" });
    if (id !== "injury") decision.answers.repair_band.key = "under_limit";
    assert.equal(claimOutcome(decision, parseClaimFields(extraction(example), example.content)).status, "adjuster_review");
  }
  const example = CLAIM_CASES[0];
  const fields = parseClaimFields(extraction(example), example.content);
  const unknown = result({ ...example.expected, injury_status: "not_stated" });
  assert.equal(claimOutcome(unknown, fields).status, "adjuster_review");
  const incomplete = result(example.expected);
  delete incomplete.answers.liability;
  assert.equal(claimOutcome(incomplete, fields).status, "workflow_error");
});

test("contradictory positive route and missing report cannot authorize fast-track", () => {
  const example = CLAIM_CASES.find((item) => item.id === "missing-report")!;
  const outcome = claimOutcome(result({ ...example.expected, claim_route: "fast_track_candidate" }), parseClaimFields(extraction(example), example.content));
  assert.equal(outcome.status, "adjuster_review");
  assert.match(outcome.reason, /conflicts/);
});

test("absent values, malformed extraction and unsupported quotes are distinguished", () => {
  const example = CLAIM_CASES[0];
  assert.throws(() => parseClaimFields("not JSON", example.content));
  assert.throws(() => parseClaimFields('{"fields":{}}', example.content), /omitted/);
  const raw = JSON.parse(extraction(example));
  raw.fields.phone.quote = "not in the email";
  raw.fields.policyholder.value = "Invented name";
  const parsed = parseClaimFields(JSON.stringify(raw), example.content);
  assert.equal(parsed.find((field) => field.name === "phone")?.status, "review");
  assert.equal(parsed.find((field) => field.name === "policyholder")?.status, "review");
  assert.equal(claimOutcome(result(example.expected), parsed).status, "adjuster_review");
  assert.equal(claimOutcome(result(example.expected), [], "HTTP failure").status, "workflow_error");
  const missing = CLAIM_CASES.find((item) => item.id === "missing-report")!;
  assert.equal(parseClaimFields(extraction(missing), missing.content).find((field) => field.name === "police_reference")?.status, "missing");
});

function dependencies(events: { event: string; data: Record<string, any> }[], example = CLAIM_CASES[0]) {
  return {
    decisionName: "Decision-1.1", baselineName: "comparison",
    evaluateDecision: async () => result(example.expected),
    evaluateBaseline: async () => result(example.expected),
    extract: async () => ({ ok: true, text: extraction(example), latency_ms: 200 }),
    emit: (event: string, data: Record<string, unknown>) => events.push({ event, data }),
  };
}

test("gate results arrive independently, with a terminal outcome only after extraction and both gates", async () => {
  const events: { event: string; data: Record<string, any> }[] = [];
  let finishBaseline!: (value: DecisionRunResult) => void;
  const baseline = new Promise<DecisionRunResult>((resolve) => { finishBaseline = resolve; });
  const workflow = runClaimWorkflow(claimRequest(CLAIM_CASES[0].content, "complete", "current-run"), {
    ...dependencies(events), evaluateBaseline: () => baseline,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert(events.some((item) => item.event === "claim_gate_result" && item.data.tier === "decision1"));
  assert(!events.some((item) => item.event === "agent_done"));
  finishBaseline(result(CLAIM_CASES[0].expected));
  await workflow;
  assert.equal(events.at(-1)?.data.outcome.status, "fast_track_candidate");
  assert(events.every((item) => item.data.runId === "current-run"));
});

test("request and extraction exceptions produce explicit failure, never fictitious missing fields", async () => {
  const events: { event: string; data: Record<string, any> }[] = [];
  await runClaimWorkflow(claimRequest(CLAIM_CASES[0].content, "complete"), {
    ...dependencies(events),
    evaluateDecision: async () => { throw new Error("decision unavailable"); },
    extract: async () => { throw new Error("extraction unavailable"); },
  });
  assert.equal(events.find((item) => item.event === "claim_gate_result" && item.data.tier === "decision1")?.data.result.ok, false);
  assert.deepEqual(events.find((item) => item.event === "claim_extraction_result")?.data.fields, []);
  assert.match(events.find((item) => item.event === "claim_extraction_result")?.data.error, /unavailable/);
  assert.equal(events.at(-1)?.data.outcome.status, "workflow_error");
});

test("a failed comparison does not fabricate a paired winner or override valid Decision evidence", async () => {
  const events: { event: string; data: Record<string, any> }[] = [];
  await runClaimWorkflow(claimRequest(CLAIM_CASES[0].content, "complete"), {
    ...dependencies(events), evaluateBaseline: async () => { throw new Error("comparison unavailable"); },
  });
  assert.equal(events.at(-1)?.data.comparisonFailed, true);
  assert.equal(events.at(-1)?.data.outcome.status, "fast_track_candidate");
});

test("changed policy/schema prevents calls, and stale workflows emit no events", async () => {
  const events: { event: string; data: Record<string, any> }[] = [];
  let called = false;
  const deps = { ...dependencies(events), evaluateDecision: async () => { called = true; return result(CLAIM_CASES[0].expected); } };
  await runClaimWorkflow({ ...claimRequest(CLAIM_CASES[0].content, "complete"), schemaVersion: 1 }, deps);
  assert.equal(called, false);
  assert.equal(events.at(-1)?.data.outcome.status, "workflow_error");
  events.length = 0;
  await runClaimWorkflow(claimRequest(CLAIM_CASES[0].content, "complete"), { ...deps, isCurrent: () => false });
  assert.equal(events.length, 0);
});

test("Claims replay requires the same case, policy and questions, not just the email", () => {
  const payload = claimRequest(CLAIM_CASES[0].content, "complete");
  const recording = { id: "claims-complete", label: "Claims", action: "run_agent_form" as const, payload, durationMs: 0, events: [] };
  assert(recordingMatches(recording, "run_agent_form", { ...payload, runId: "new-run" }));
  for (const change of [{ policy: "changed" }, { questions: [] }, { caseId: "other" }, { schemaVersion: 1 }, { content: "edited" }]) {
    assert(!recordingMatches(recording, "run_agent_form", { ...payload, ...change }));
  }
});

test("browser transport uses the same explicit failure outcome and honors cancellation", async () => {
  const events: { event: string; data: Record<string, any> }[] = [];
  const dispatcher = new BrowserFoundryDispatcher({ ...DEFAULT_AZURE_CONFIG, accessToken: "" }, (message) => events.push(message));
  await dispatcher.dispatch("run_agent_form", claimRequest(CLAIM_CASES[0].content, "complete", "failed-browser"));
  assert.equal(events.at(-1)?.data.outcome.status, "workflow_error");
  assert.equal(events.filter((item) => item.event === "claim_gate_result" && item.data.result.ok === false).length, 2);
  assert.equal(events.find((item) => item.event === "claim_extraction_result")?.data.fields.length, 0);
  events.length = 0;
  const pending = dispatcher.dispatch("run_agent_form", claimRequest(CLAIM_CASES[0].content, "complete", "cancelled-browser"));
  dispatcher.stopAll();
  await pending;
  assert.equal(events.at(-1)?.data.cancelled, true);
  assert.equal(events.at(-1)?.data.runId, "cancelled-browser");
  assert(!events.some((item) => item.data.outcome));
});

test("inline segments preserve every character and all overlapping field/policy links", () => {
  const example = CLAIM_CASES[0];
  const fields = parseClaimFields(extraction(example), example.content);
  const links = claimSourceLinks(example.content, fields, example, true);
  const segments = claimSourceSegments(example.content, links);
  assert.equal(segments.map((segment) => segment.text).join(""), example.content);
  const amount = segments.find((segment) => segment.text === "GBP 2,340")!;
  assert(amount.linkIds.includes("field:estimate"));
  assert(amount.linkIds.includes("gate:repair_band"));
  assert(amount.linkIds.includes("gate:claim_route"));
  assert.equal(links.filter((link) => link.kind === "field").length, 13);
  assert.equal(links.find((link) => link.id === "gate:claim_route")?.ranges.length, 4);
  const phone = fields.find((field) => field.name === "phone")!;
  const quote = `My phone is ${phone.value}.`;
  const start = example.content.indexOf(quote);
  const narrowed = claimSourceLinks(example.content, [{ ...phone, quote, start, end: start + quote.length }])[0].ranges[0];
  assert.equal(example.content.slice(narrowed.start, narrowed.end), phone.value, "Prefer the field value inside its validated source quote");
});

test("missing fields and stale quotes never manufacture inline source evidence", () => {
  const example = CLAIM_CASES.find((item) => item.id === "missing-report")!;
  const fields = parseClaimFields(extraction(example), example.content);
  const links = claimSourceLinks(example.content, fields, example, true);
  assert(!links.some((link) => link.id === "field:police_reference"));
  assert(links.some((link) => link.id === "gate:police_reference"), "The stated missing-report sentence is real policy evidence");
  const stale = fields.map((field) => ({ ...field, quote: "not present in this email" }));
  assert.equal(claimSourceLinks(example.content, stale).length, 0);
  assert(!claimSourceLinks(`${example.content}\nEdited`, fields, example, true).some((link) => link.kind === "gate"));
});

test("policy evidence is not presented before a gate result or invented for custom inputs", () => {
  const example = CLAIM_CASES[0];
  assert.equal(claimSourceLinks(example.content, [], example, false).length, 0);
  assert.equal(claimSourceLinks("Custom customer email", [], undefined, true).length, 0);
  assert.equal(claimSourceSegments("Custom customer email", [])[0].text, "Custom customer email");
});
