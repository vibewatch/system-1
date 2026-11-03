import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import WebSocket from "ws";
import { CLAIM_DEMO, RUNTIME_SCENARIOS, STUDIO_SAMPLES, TRIAGE_FEED, type StudioSample } from "../src/lib/demo-data";
import { parseReplayBundle, type ReplayBundle, type ReplayRecording } from "../src/lib/replay";

const output = resolve(process.env.REPLAY_OUTPUT || "public/replays/showcase.json");
const checkpoint = `${output}.partial`;
const wsUrl = process.env.REPLAY_WS_URL || "ws://localhost:3000/ws";

function record(request: Omit<ReplayRecording, "durationMs" | "events">): Promise<ReplayRecording> {
  return new Promise((accept, reject) => {
    const socket = new WebSocket(wsUrl);
    const events: ReplayRecording["events"] = [];
    let started = 0;
    let finished = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => fail(new Error(`Timed out: ${request.label}`)), 240_000);
    const fail = (error: Error) => {
      clearTimeout(timeout);
      clearTimeout(settle);
      socket.close();
      reject(error);
    };
    const finish = () => {
      clearTimeout(timeout);
      socket.close();
      accept({ ...request, durationMs: events.at(-1)?.offsetMs || 0, events });
    };
    socket.on("open", () => {
      started = performance.now();
      socket.send(JSON.stringify({ action: request.action, payload: request.payload }));
    });
    socket.on("error", fail);
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.event === "error") return fail(new Error(message.data.message || "Server error"));
      events.push({ event: message.event, data: message.data, offsetMs: Math.round(performance.now() - started) });
      const final = { run_compare: "compare_finished", start_runtime: "runtime_done", start_triage: "triage_done", run_agent_form: "agent_done" }[request.action];
      if (message.event === final) finished = true;
      if (finished) {
        clearTimeout(settle);
        // Streaming classifiers may finish after the generation's terminal event.
        settle = setTimeout(finish, request.action === "start_runtime" ? 5000 : 50);
      }
    });
    socket.on("close", () => { if (!finished) fail(new Error(`Socket closed before completion: ${request.label}`)); });
  });
}

function validateResult(recording: ReplayRecording) {
  const results = recording.events;
  if (recording.action === "run_compare") {
    const completed = results.filter((event) => event.event === "compare_model_done");
    if (completed.length !== 2 || completed.some((event) => !event.data.result?.ok ||
        recording.payload.questions.some((question: { id: string }) => !event.data.result.answers?.[question.id]))) throw new Error("A comparison model failed or omitted an answer.");
  } else if (recording.action === "start_triage") {
    const completed = results.filter((event) => event.event === "triage_item_done");
    if (completed.length !== TRIAGE_FEED.messages.length * 2 || completed.some((event) => !event.data.ok)) throw new Error("Incomplete or failed triage results.");
  } else if (recording.action === "start_runtime") {
    const scenario = RUNTIME_SCENARIOS.find((item) => item.id === recording.payload.scenarioId);
    if (scenario?.stages && !["runtime_evaluation_started", "runtime_decision", "runtime_terra_decision"].every((name) =>
      results.filter((event) => event.event === name).length === scenario.stages!.length)) throw new Error("Staged story is missing inference checkpoints; re-record its model calls.");
    if (scenario?.stages && scenario.stages.some((stage, index) => {
      const expected = scenario.inputScope === "checkpoint" ? stage.text : scenario.header + scenario.stages!.slice(0, index + 1).map((item) => item.text).join("\n\n");
      return results.find((item) => item.event === "runtime_evaluation_started" && item.data.index === index)?.data.modelInput !== expected;
    })) throw new Error("The recorded model input no longer matches the scenario's evidence scope.");
    if (scenario?.navigation) {
      const requests = results.filter((item) => item.event === "runtime_evaluation_started");
      if (!requests.length || ["runtime_decision", "runtime_terra_decision"].some((name) => results.filter((item) => item.event === name).length !== requests.length)) throw new Error("Incomplete graph inference results.");
      const progress = results.filter((item) => item.event === "runtime_navigation_state");
      if (!["reached", "review"].includes(progress.at(-1)?.data.status)) throw new Error("Graph run has no terminal outcome.");
      for (const step of progress.filter((item) => item.data.appliedChoice)) {
        const { path, appliedChoice, index } = step.data;
        const source = scenario.navigation.nodes.find((item) => item.id === path.at(-2));
        const response = results.find((item) => item.event === "runtime_decision" && item.data.index === index);
        if (!response || !source?.links.includes(appliedChoice) || path.at(-1) !== appliedChoice || response.data.answers.next_action.key !== appliedChoice || response.data.answers.next_action.value < 0.65) throw new Error("Recorded graph move was not driven by a supported legal Decision-1 choice.");
      }
    }
    const transcript = results.filter((event) => event.event === "runtime_token").at(-1)?.data.transcript;
    if (!transcript || !results.find((event) => event.event === "runtime_done")?.data.ok ||
        !["runtime_decision", "runtime_terra_decision"].every((name) => results.some((event) => event.event === name && event.data.textLen === transcript.length)) ||
        (!scenario?.navigation && !results.some((event) => event.event === "runtime_extract"))) throw new Error("Incomplete conversation or final decisions.");
  } else {
    const gates = results.find((event) => event.event === "agent_gates_done")?.data;
    if (!gates?.decision1?.ok || !gates?.terra?.ok ||
        results.filter((event) => event.event === "agent_field_filled").length !== CLAIM_DEMO.form.length ||
        !results.some((event) => event.event === "agent_field_filled" && event.data.value)) throw new Error("Claims gates or form extraction failed.");
  }
}

async function main() {
  let scenarios: StudioSample[] = [...STUDIO_SAMPLES];
  if (process.argv.includes("--include-custom")) {
    const custom: StudioSample[] = JSON.parse(await readFile("data/custom-usecases.json", "utf8"));
    scenarios = [...scenarios, ...custom.filter((sample) => !scenarios.some((item) => item.id === sample.id))];
  }
  const requests: Omit<ReplayRecording, "durationMs" | "events">[] = [];
  for (const sample of scenarios) {
    const cases = sample.testCases?.length ? sample.testCases : [{ id: `${sample.id}-default`, title: "Primary case", content: sample.content }];
    for (const testCase of cases) requests.push({
      id: `compare-${testCase.id}`, label: `${sample.label} / ${testCase.title}`, action: "run_compare",
      payload: { state: testCase.content, questions: sample.questions, mode: "compare" },
    });
  }
  for (const scenario of RUNTIME_SCENARIOS) requests.push({
    id: `runtime-${scenario.id}`, label: scenario.label, action: "start_runtime",
    payload: { scenarioId: scenario.id, questions: scenario.questions },
  });
  for (const rate of [5, 10, 20]) requests.push({
    id: `triage-${rate}`, label: `Queue triage / ${rate} messages per second`, action: "start_triage", payload: { rate, raceTerra: true },
  });
  requests.push({ id: "claims", label: "Claims gates and form extraction", action: "run_agent_form", payload: { content: CLAIM_DEMO.text } });
  const healthResponse = await fetch(new URL("/api/health", wsUrl.replace(/^ws/, "http")));
  const health = await healthResponse.json();
  if (!health.ok) throw new Error("Azure health probe failed. Authenticate the backend before recording.");
  let bundle: ReplayBundle = {
    version: 1, recordedAt: new Date().toISOString(), endpoint: health.endpoint,
    models: { decision1: health.decisionDeployment, terra: health.terraDeployment }, scenarios, recordings: [],
  };
  try {
    let partial: ReplayBundle;
    try { partial = JSON.parse(await readFile(checkpoint, "utf8")); }
    catch (error) {
      if (!process.argv.includes("--resume")) throw error;
      partial = JSON.parse(await readFile(output, "utf8"));
    }
    if (partial.endpoint === bundle.endpoint && JSON.stringify(partial.models) === JSON.stringify(bundle.models)) {
      bundle.recordings = partial.recordings;
      bundle.recordedAt = partial.recordedAt;
    }
  } catch {}
  await mkdir(dirname(output), { recursive: true });
  for (const [index, request] of requests.entries()) {
    const existing = bundle.recordings.find((recording) => recording.id === request.id && JSON.stringify(recording.payload) === JSON.stringify(request.payload));
    if (existing) {
      try { validateResult(existing); console.log(`[${index + 1}/${requests.length}] Resuming: ${request.label}`); continue; } catch {}
    }
    let completed: ReplayRecording | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        completed = await record(request);
        validateResult(completed);
        break;
      } catch (error) {
        console.error(`[${index + 1}/${requests.length}] Attempt ${attempt} failed:`, (error as Error).message);
        if (attempt === 2) throw error;
        await new Promise((done) => setTimeout(done, 3000));
      }
    }
    bundle.recordings = [...bundle.recordings.filter((recording) => recording.id !== request.id), completed!];
    await writeFile(checkpoint, JSON.stringify(bundle));
    console.log(`[${index + 1}/${requests.length}] Recorded ${request.label}: ${completed!.events.length} events / ${(completed!.durationMs / 1000).toFixed(1)}s`);
  }
  bundle.recordings = requests.map((request) => bundle.recordings.find((recording) => recording.id === request.id)!);
  parseReplayBundle(bundle);
  await writeFile(`${output}.ready`, JSON.stringify(bundle));
  await rename(`${output}.ready`, output);
  await unlink(checkpoint).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  console.log(`Saved ${bundle.recordings.length} complete recordings for ${scenarios.length} solutions to ${output}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
