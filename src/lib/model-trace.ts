import { redactTraceValue } from "./replay";

export interface ModelTrace {
  id: string;
  startedAt: string;
  durationMs: number;
  url: string;
  request: unknown;
  status?: number;
  response?: unknown;
  error?: string;
}

export function createTracedFetch(save: (trace: ModelTrace) => Promise<void>) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    const start = performance.now();
    const trace: ModelTrace = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      durationMs: 0,
      url,
      request: init.body,
    };
    if (typeof init.body === "string") {
      try { trace.request = JSON.parse(init.body); } catch {}
    }
    const secrets = Array.from(new Headers(init.headers).entries())
      .filter(([key]) => /authorization|api-key/i.test(key))
      .map(([, value]) => String(value).replace(/^Bearer\s+/i, ""));
    const persist = async () => {
      trace.durationMs = Math.round(performance.now() - start);
      let serialized = JSON.stringify(trace);
      for (const secret of secrets) {
        if (secret) serialized = serialized.split(secret).join("[redacted]");
      }
      await save(redactTraceValue(JSON.parse(serialized)) as ModelTrace);
    };
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      trace.error = String(error);
      await persist();
      throw error;
    }
    trace.status = response.status;
    const capture = async () => {
      let text = "";
      const decoder = new TextDecoder();
      try {
        const reader = response.clone().body?.getReader();
        if (reader) {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
        }
      } catch (error) {
        trace.error = String(error);
      }
      try { trace.response = JSON.parse(text); }
      catch { trace.response = text; }
      await persist();
    };
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      void capture().catch((error) => console.error("Model trace persistence failed", error));
    } else {
      await capture();
    }
    return response;
  };
}
