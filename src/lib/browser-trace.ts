"use client";

import { createTracedFetch, type ModelTrace } from "./model-trace";

function openTraces(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("foundry-model-traces", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("traces", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const tracedBrowserFetch = createTracedFetch(async (trace: ModelTrace) => {
  const db = await openTraces();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("traces", "readwrite");
      transaction.objectStore("traces").put(trace);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
});

export async function exportBrowserTraces(): Promise<void> {
  const db = await openTraces();
  try {
    const traces = await new Promise<ModelTrace[]>((resolve, reject) => {
      const request = db.transaction("traces").objectStore("traces").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    traces.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const url = URL.createObjectURL(new Blob([traces.map((trace) => JSON.stringify(trace)).join("\n")], { type: "application/x-ndjson" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "foundry-model-traces.jsonl";
    link.click();
    URL.revokeObjectURL(url);
  } finally { db.close(); }
}
