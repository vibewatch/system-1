import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { STUDIO_SAMPLES, RUNTIME_SCENARIOS, TRIAGE_FEED } from "./demo-data";
import { ReplayDispatcher, parseReplayBundle, recordingMatches, type ReplayBundle } from "./replay";

const fixture = (): ReplayBundle => ({
  version: 1, recordedAt: "2026-11-03T00:00:00Z", endpoint: "https://example.invalid",
  models: { decision1: "Decision-1", terra: "gpt-6.1-terra" }, scenarios: [STUDIO_SAMPLES[0]],
  recordings: [{
    id: "comparison", label: "Recorded comparison", action: "run_compare", durationMs: 120,
    payload: { state: "input", questions: [{ id: "safe", type: "noul", instructions: "Is it safe?" }] },
    events: [
      { event: "compare_started", data: {}, offsetMs: 0 },
      { event: "compare_model_done", data: { tier: "decision1", result: { ok: true, latency_ms: 22, answers: { safe: { label: "Yes" } } } }, offsetMs: 40 },
      { event: "compare_model_done", data: { tier: "terra", result: { ok: true, latency_ms: 82, answers: { safe: { label: "No" } } } }, offsetMs: 90 },
      { event: "compare_finished", data: {}, offsetMs: 120 },
    ],
  }],
});

test("matches semantic object order but rejects changed inputs and questions", () => {
  const recording = fixture().recordings[0];
  assert(recordingMatches(recording, "run_compare", { questions: [{ instructions: "Is it safe?", type: "noul", id: "safe" }], state: "input" }));
  assert(!recordingMatches(recording, "run_compare", { ...recording.payload, state: "new input" }));
  assert(!recordingMatches(recording, "run_compare", { ...recording.payload, questions: [] }));
});

test("pause, resume and speed change preserve event order and recorded latency", async () => {
  const events: any[] = [];
  const dispatcher = new ReplayDispatcher(fixture(), (event) => events.push(event));
  dispatcher.dispatch("run_compare", fixture().recordings[0].payload);
  dispatcher.pause();
  await sleep(70);
  assert.deepEqual(events.map((event) => event.event), ["compare_started"]);
  dispatcher.setSpeed(4);
  dispatcher.resume();
  await sleep(80);
  assert.deepEqual(events.map((event) => event.event), ["compare_started", "compare_model_done", "compare_model_done", "compare_finished"]);
  assert.equal(events[1].data.result.latency_ms, 22);
  assert.equal(events[2].data.result.latency_ms, 82);
  dispatcher.stop();
});

test("stop and restart do not leak earlier scheduled events", async () => {
  const events: string[] = [];
  const dispatcher = new ReplayDispatcher(fixture(), (event) => events.push(event.event));
  dispatcher.dispatch("run_compare", fixture().recordings[0].payload);
  dispatcher.stop();
  await sleep(160);
  assert.deepEqual(events, ["compare_started", "compare_finished"]);
  dispatcher.setSpeed(4);
  dispatcher.dispatch("run_compare", fixture().recordings[0].payload);
  await sleep(80);
  assert.equal(events.filter((event) => event === "compare_model_done").length, 2);
  dispatcher.stop();
});

test("unrecorded inputs fail explicitly without fabricated answers", async () => {
  const events: any[] = [];
  const dispatcher = new ReplayDispatcher(fixture(), (event) => events.push(event));
  assert.equal(dispatcher.dispatch("run_compare", { state: "unknown", questions: [] }), false);
  assert.equal(events[0].event, "error");
  await assert.rejects(dispatcher.comparePair("unknown", []), /No recording matches/);
  dispatcher.stop();
});

test("editing a running comparison cancels its old answers before rejecting the new input", async () => {
  const events: any[] = [];
  const dispatcher = new ReplayDispatcher(fixture(), (event) => events.push(event));
  dispatcher.dispatch("run_compare", fixture().recordings[0].payload);
  assert.equal(dispatcher.dispatch("run_compare", { state: "edited", questions: [] }), false);
  await sleep(160);
  assert.deepEqual(events.map((event) => event.event), ["compare_started", "compare_finished", "error"]);
  assert.equal(events[1].data.cancelled, true);
});

test("rejects invalid timelines and unsupported recording versions", () => {
  const bundle = fixture();
  assert.throws(() => parseReplayBundle({ ...bundle, version: 2 }));
  bundle.recordings[0].events[1].offsetMs = -1;
  assert.throws(() => parseReplayBundle(bundle), /Invalid event timeline/);
  const incomplete = fixture();
  incomplete.recordings[0].events.pop();
  assert.throws(() => parseReplayBundle(incomplete), /missing final event/);
});

test("imported log markup cannot run HTML but retains bold labels", async () => {
  const bundle = fixture();
  bundle.recordings[0].events = [{ event: "agent_step", offsetMs: 0, data: { text: '<b>Result</b><img src=x onerror=alert(1)>' } }];
  const events: any[] = [];
  const dispatcher = new ReplayDispatcher(bundle, (event) => events.push(event));
  dispatcher.dispatch("run_compare", bundle.recordings[0].payload);
  assert.equal(events[0].data.text, "<b>Result</b>&lt;img src=x onerror=alert(1)&gt;");
  dispatcher.stop();
});

test("included recording covers every built-in case, stream, rate and claims form", async () => {
  const bundle = parseReplayBundle(JSON.parse(await readFile("public/replays/showcase.json", "utf8")));
  for (const sample of STUDIO_SAMPLES) {
    for (const testCase of sample.testCases?.length ? sample.testCases : [{ content: sample.content }]) {
      const recording = bundle.recordings.find((item) => recordingMatches(item, "run_compare", { state: testCase.content, questions: sample.questions }));
      assert(recording, `Missing ${sample.id}`);
      assert.equal(recording.events.filter((event) => event.event === "compare_model_done" && event.data.result?.ok).length, 2);
    }
  }
  for (const scenario of RUNTIME_SCENARIOS) {
    const recording = bundle.recordings.find((item) => recordingMatches(item, "start_runtime", { scenarioId: scenario.id, questions: scenario.questions }));
    assert(recording, `Missing runtime ${scenario.id}`);
    assert(recording.events.some((event) => event.event === "runtime_token"));
  }
  for (const rate of [5, 10, 20]) {
    const recording = bundle.recordings.find((item) => recordingMatches(item, "start_triage", { rate }));
    assert(recording, `Missing triage ${rate}`);
    assert.equal(recording.events.filter((event) => event.event === "triage_item_done" && event.data.ok).length, TRIAGE_FEED.messages.length * 2);
  }
  assert(bundle.recordings.some((item) => item.action === "run_agent_form" && item.events.some((event) => event.event === "agent_done")));
});
