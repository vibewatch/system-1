import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import type { StudioSample } from "@/lib/demo-data";

const DATA_DIR = path.join(process.cwd(), "data");
const CUSTOM_FILE = path.join(DATA_DIR, "custom-usecases.json");

async function readCustomUseCases(): Promise<StudioSample[]> {
  try {
    const raw = await fs.readFile(CUSTOM_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCustomUseCases(items: StudioSample[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CUSTOM_FILE, JSON.stringify(items, null, 2), "utf8");
}

export async function GET() {
  const custom = await readCustomUseCases();
  return NextResponse.json({ ok: true, customUseCases: custom });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const uc = body.useCase as StudioSample;
    if (
      !uc ||
      !uc.id ||
      !uc.label ||
      !uc.content ||
      !Array.isArray(uc.questions)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid use case payload: id, label, content, and questions[] required.",
        },
        { status: 400 }
      );
    }

    const sanitized: StudioSample = {
      id: String(uc.id)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-"),
      label: String(uc.label).trim(),
      category: String(uc.category || "Custom Decision Gate").trim(),
      industry: String(
        uc.industry || "AI Safety & Agent Guardrails"
      ).trim(),
      origin: uc.origin || "custom",
      description: String(
        uc.description || "User-defined Microsoft-Decision-1 solution."
      ).trim(),
      codeRule: uc.codeRule ? String(uc.codeRule).trim() : undefined,
      content: String(uc.content),
      expected: uc.expected || undefined,
      testCases: uc.testCases || undefined,
      questions: uc.questions,
    };

    const existing = await readCustomUseCases();
    const idx = existing.findIndex((x) => x.id === sanitized.id);
    if (idx >= 0) {
      existing[idx] = sanitized;
    } else {
      existing.unshift(sanitized);
    }
    await writeCustomUseCases(existing);

    return NextResponse.json({
      ok: true,
      useCase: sanitized,
      customUseCases: existing,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to save use case" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing id" },
        { status: 400 }
      );
    }
    const existing = await readCustomUseCases();
    const filtered = existing.filter((x) => x.id !== id);
    await writeCustomUseCases(filtered);
    return NextResponse.json({ ok: true, customUseCases: filtered });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to delete use case" },
      { status: 500 }
    );
  }
}
