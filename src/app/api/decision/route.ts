import { NextRequest, NextResponse } from "next/server";
import { callDecision1, callGptTerraDecision } from "@/lib/foundry";
import type { DecisionQuestion } from "@/lib/demo-data";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const state = body.state ?? body.content ?? "";
    const questions: DecisionQuestion[] = Array.isArray(body.questions) ? body.questions : [];
    const tier = body.tier || "decision1";

    if (!questions.length) {
      return NextResponse.json({ error: "At least one question is required" }, { status: 400 });
    }

    const result =
      tier === "terra"
        ? await callGptTerraDecision(state, questions, body.endpoint)
        : await callDecision1(state, questions, body.endpoint);

    return NextResponse.json(result, { status: result.ok ? 200 : result.status || 500 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
