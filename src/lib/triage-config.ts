export type TriageMode = "demo" | "equal";

export function getTriageWorkers(mode: unknown) {
  return mode === "equal"
    ? { decision1: 4, terra: 4 }
    : { decision1: 8, terra: 4 };
}
