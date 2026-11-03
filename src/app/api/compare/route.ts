import { NextRequest, NextResponse } from "next/server";
import { callDecision1, callGptTerraDecision } from "@/lib/foundry";
import type { DecisionQuestion } from "@/lib/demo-data";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const state = body.state ?? body.content ?? "";
    const questions: DecisionQuestion[] = Array.isArray(body.questions) ? body.questions : [];

    if (!questions.length) {
      return NextResponse.json({ error: "At least one question is required" }, { status: 400 });
    }

    const [decision1, terra] = await Promise.all([
      callDecision1(state, questions, body.endpoint),
      callGptTerraDecision(state, questions, body.endpoint),
    ]);

    let agreed = 0;
    for (const q of questions) {
      const a1 = decision1.answers[q.id];
      const a2 = terra.answers[q.id];
      if (a1 && a2 && a1.label === a2.label) {
        agreed++;
      }
    }

    const speedup =
      decision1.ok && terra.ok && decision1.latency_ms > 0
        ? Number((terra.latency_ms / decision1.latency_ms).toFixed(2))
        : null;

    return NextResponse.json({
      ok: decision1.ok || terra.ok,
      decision1,
      terra,
      comparison: {
        speedup,
        agreed,
        totalQuestions: questions.length,
        tokenRatio:
          decision1.usage.output_tokens > 0
            ? Number((terra.usage.output_tokens / decision1.usage.output_tokens).toFixed(1))
            : null,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
