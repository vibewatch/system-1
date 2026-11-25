import { test } from "node:test";
import assert from "node:assert/strict";
import { createTracedFetch, type ModelTrace } from "./model-trace";
import { DEFAULT_DECISION_ENDPOINT, normalizeFoundryEndpoint } from "./deployment";
import { DEFAULT_AZURE_CONFIG, CONFIG_STORAGE_KEY, loadAzureConfig } from "./client-foundry";

test("backend uses Decision-1.1 at the resource root with API-key authentication", async (t) => {
  const oldKey = process.env.AZURE_DECISION_API_KEY;
  const oldTrace = process.env.AZURE_TRACE_FILE;
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "decision-trace-"));
  process.env.AZURE_DECISION_API_KEY = "test-api-key";
  process.env.AZURE_TRACE_FILE = join(directory, "calls.jsonl");
  const { callDecision1, getFoundryAuthHeaders } = await import("./foundry");
  t.after(async () => {
    if (oldKey === undefined) delete process.env.AZURE_DECISION_API_KEY;
    else process.env.AZURE_DECISION_API_KEY = oldKey;
    if (oldTrace === undefined) delete process.env.AZURE_TRACE_FILE;
    else process.env.AZURE_TRACE_FILE = oldTrace;
    await rm(directory, { recursive: true });
  });
  assert.deepEqual(await getFoundryAuthHeaders(DEFAULT_DECISION_ENDPOINT), { "api-key": "test-api-key" });
  assert.deepEqual(await getFoundryAuthHeaders("https://different-resource.invalid", async () => "test-entra-token"), {
    Authorization: "Bearer test-entra-token",
  });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, `${normalizeFoundryEndpoint(DEFAULT_DECISION_ENDPOINT)}/providers/microsoft/v1/systemone`);
    assert.equal(new Headers(init.headers).get("api-key"), "test-api-key");
    assert.equal(JSON.parse(String(init.body)).model, "Decision-1.1");
    return Response.json({ model: "microsoft-decision-1.1", answers: { ready: { noul: 0.93 } }, usage: { input_tokens: 23, output_tokens: 1 } });
  });
  const result = await callDecision1("Health probe", [{ id: "ready", label: "Ready", type: "noul", instructions: "Is it a health probe?" }]);
  assert.equal(result.ok, true);
  assert.equal(result.model, "microsoft-decision-1.1");
  assert.equal(result.answers.ready.value, 0.93);
  assert.equal(normalizeFoundryEndpoint(" https://example.services.ai.azure.com/models/ "), "https://example.services.ai.azure.com");
  const trace = await readFile(process.env.AZURE_TRACE_FILE, "utf8");
  assert.equal(JSON.parse(trace).status, 200);
  assert.equal(JSON.parse(trace).request.model, "Decision-1.1");
  assert(!trace.includes("test-api-key"));
});

test("saved legacy deployments migrate without changing custom model choices", (t) => {
  let deployment = "Decision-1";
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: (key: string) => {
      assert.equal(key, CONFIG_STORAGE_KEY);
      return JSON.stringify({ ...DEFAULT_AZURE_CONFIG, decisionDeployment: deployment });
    } },
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  assert.equal(loadAzureConfig().decisionDeployment, "Decision-1.1");
  assert.equal(loadAzureConfig().decisionEndpoint, DEFAULT_DECISION_ENDPOINT);
  deployment = "custom-deployment";
  assert.equal(loadAzureConfig().decisionDeployment, deployment);
});

test("traces retain successful and failed responses, redact credentials and preserve caller body", async (t) => {
  const traces: ModelTrace[] = [];
  const traced = createTracedFetch(async (trace) => { traces.push(trace); });
  t.mock.method(globalThis, "fetch", async () => Response.json({ answers: { safe: { noul: 0.9 } }, apiKey: "secret-value" }, { status: 403 }));
  const response = await traced("https://example.services.ai.azure.com/providers/microsoft/v1/systemone", {
    headers: { Authorization: "Bearer secret-value" },
    body: JSON.stringify({ model: "Decision-1.1", state: "secret-value", clientSecret: "other-secret" }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).answers.safe.noul, 0.9);
  assert.equal(traces[0].status, 403);
  assert(!JSON.stringify(traces).includes("secret-value"));
  assert(!JSON.stringify(traces).includes("other-secret"));
  assert(!JSON.stringify(traces).includes("example.services.ai.azure.com"));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network failure"); });
  await assert.rejects(traced("https://example.invalid", { body: "{}" }), /network failure/);
  assert.match(traces[1].error!, /network failure/);
});

test("stream traces preserve all SSE events without waiting for stream completion", async (t) => {
  let complete!: () => void;
  let recorded!: (trace: ModelTrace) => void;
  const saved = new Promise<ModelTrace>((resolve) => { recorded = resolve; });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"delta":"hello"}\n\n'));
      complete = () => {
        controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed"}\n\n'));
        controller.close();
      };
    },
  });
  t.mock.method(globalThis, "fetch", async () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
  const response = await createTracedFetch(async (trace) => { recorded(trace); })("https://example.invalid", { body: "{}" });
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /hello/);
  complete();
  const trace = await saved;
  assert.match(String(trace.response), /hello/);
  assert.match(String(trace.response), /response.completed/);
  assert.equal(trace.status, 200);
  await reader.cancel();
});

test("interrupted streams retain partial events and the read error", async (t) => {
  let interrupt!: () => void;
  let recorded!: (trace: ModelTrace) => void;
  const saved = new Promise<ModelTrace>((resolve) => { recorded = resolve; });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"delta":"partial"}\n\n'));
      interrupt = () => controller.error(new Error("stream interrupted"));
    },
  });
  t.mock.method(globalThis, "fetch", async () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
  const response = await createTracedFetch(async (trace) => { recorded(trace); })("https://example.invalid", { body: "{}" });
  const reader = response.body!.getReader();
  await reader.read();
  await new Promise((resolve) => setTimeout(resolve, 10));
  interrupt();
  const trace = await saved;
  assert.match(String(trace.response), /partial/);
  assert.match(trace.error!, /stream interrupted/);
  await assert.rejects(reader.read(), /stream interrupted/);
});
