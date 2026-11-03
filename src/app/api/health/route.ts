import { NextResponse } from "next/server";
import {
  DEFAULT_FOUNDRY_ENDPOINT,
  DECISION_DEPLOYMENT,
  TERRA_DEPLOYMENT,
  getEntraToken,
  callDecision1,
} from "@/lib/foundry";

export async function GET() {
  const t0 = performance.now();
  try {
    await getEntraToken();
    const probe = await callDecision1("System health check.", [
      {
        id: "ready",
        label: "Ready",
        type: "noul",
        instructions: "Is this a system health check?",
      },
    ]);
    const round_trip_ms = Math.round(performance.now() - t0);
    return NextResponse.json({
      ok: probe.ok,
      endpoint: DEFAULT_FOUNDRY_ENDPOINT,
      activeDecisionEndpoint: probe.endpointUsed,
      decisionDeployment: DECISION_DEPLOYMENT,
      terraDeployment: TERRA_DEPLOYMENT,
      auth: "Microsoft Entra ID (DefaultAzureCredential / Azure CLI)",
      round_trip_ms,
      decision_latency_ms: probe.latency_ms,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        endpoint: DEFAULT_FOUNDRY_ENDPOINT,
        error: String(err),
        round_trip_ms: Math.round(performance.now() - t0),
      },
      { status: 500 }
    );
  }
}
