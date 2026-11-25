import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createTracedFetch } from "./model-trace";

export const TRACE_FILE = resolve(process.env.AZURE_TRACE_FILE || "data/traces/model-calls.jsonl");
let pendingWrite = Promise.resolve();

export const tracedFetch = createTracedFetch((trace) => {
  const write = pendingWrite.then(async () => {
    await mkdir(dirname(TRACE_FILE), { recursive: true, mode: 0o700 });
    await appendFile(TRACE_FILE, `${JSON.stringify(trace)}\n`, { mode: 0o600 });
  });
  pendingWrite = write.catch(() => {});
  return write;
});
