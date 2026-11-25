import type { DecisionQuestion } from "./demo-data";
import type { DecisionRunResult } from "./foundry";

export const CLAIM_POLICY = `Synthetic demonstration policy, not a coverage or settlement determination:
Fast-track processing requires ALL of: an explicitly stated repair estimate strictly below GBP 5,000; an explicit statement that nobody was injured; and clear third-party fault.
Any injury, an estimate of GBP 5,000 or more, an unstated estimate/injury status, or shared/unclear fault requires an adjuster.
If fast-track requirements are met but no police report reference is provided, request missing documents.
Only when requirements are met and a police report reference is supplied is the claim a fast-track candidate. Candidate does not mean approved or paid.`;

export const CLAIM_QUESTIONS: DecisionQuestion[] = [
  { id: "claim_route", label: "Processing route", type: "choice", instructions: `Apply this policy in priority order: ${CLAIM_POLICY}`,
    criteria: { fast_track_candidate: "All fast-track requirements met and police reference supplied", request_documents: "All fast-track requirements met, but police reference missing", adjuster_review: "Injury, estimate >= GBP 5,000, an unstated required fact, or shared/unclear fault" } },
  { id: "repair_band", label: "Repair estimate", type: "choice",
    instructions: "Classify the explicitly stated repair estimate. Exactly GBP 5,000 is at_or_over_limit. Do not invent an estimate.",
    criteria: { under_limit: "Explicit estimate strictly below GBP 5,000", at_or_over_limit: "Estimate >= GBP 5,000", not_stated: "No estimate stated" } },
  { id: "injury_status", label: "Injury evidence", type: "choice",
    instructions: "Classify only the customer's explicit injury statement; silence is not evidence of no injury.",
    criteria: { no_injury: "Explicit statement that nobody was injured", injury_reported: "At least one injury reported", not_stated: "No explicit injury status" } },
  { id: "liability", label: "Fault evidence", type: "choice",
    instructions: "A third party rear-ending the stationary claimant indicates third-party fault. Shared, conflicting or insufficient accounts are unclear; do not invent a liability finding.",
    criteria: { third_party_fault: "Other driver hit the stationary claimant", policyholder_fault: "Claimant explicitly caused the collision", shared_or_unclear: "Shared, conflicting or insufficient fault evidence" } },
  { id: "police_reference", label: "Police report reference supplied?", type: "noul",
    instructions: "Is an actual police report reference supplied? A promise to send one later does not count." },
];

export const CLAIM_FIELDS = [
  { name: "policyholder", label: "Policyholder", definition: "Claimant's stated name" },
  { name: "policy_number", label: "Policy number", definition: "Claimant's policy number" },
  { name: "phone", label: "Claimant phone", definition: "Claimant's phone, not the other driver's phone; use explicit attribution" },
  { name: "date", label: "Incident date", definition: "Date the collision happened" },
  { name: "time", label: "Incident time", definition: "Time the collision happened" },
  { name: "location", label: "Incident location", definition: "Location of the collision" },
  { name: "vehicle", label: "Claimant vehicle", definition: "Make and model of the claimant's vehicle" },
  { name: "registration", label: "Registration", definition: "Claimant's registration plate" },
  { name: "damage", label: "Damage", definition: "Damage stated by the claimant" },
  { name: "estimate", label: "Repair estimate", definition: "Explicit repair estimate and currency" },
  { name: "other_driver", label: "Other driver", definition: "Other driver's stated name" },
  { name: "other_insurer", label: "Other insurer", definition: "Other driver's insurer" },
  { name: "police_reference", label: "Police reference", definition: "Actual police report reference, or null if not supplied" },
];

export interface ClaimCase {
  id: string;
  label: string;
  content: string;
  expected: Record<string, string>;
  evidence: Record<string, string[]>;
}

function claimCase(id: string, label: string, estimate: string, injury: string, liability: string, report: string,
  expected: Record<string, string>): ClaimCase {
  const content = `Synthetic claim email:
My name is Casey Morgan. My policy number is CM-2048. My phone is 07700 900123.
The collision happened on 2 November 2026 at 18:40 at the junction of Oak Street and Park Road.
My vehicle is a Toyota Corolla, registration AB12 CDE. The rear bumper and boot lid were damaged.
${liability}
${injury}
The garage's repair estimate is ${estimate}.
The other driver is Alex Reed, whose insurer is Example Mutual.
${report}`;
  return { id, label, content, expected, evidence: {
    claim_route: [liability, injury, `The garage's repair estimate is ${estimate}.`, report],
    repair_band: [`The garage's repair estimate is ${estimate}.`],
    injury_status: [injury], liability: [liability], police_reference: [report],
  } };
}

const noInjury = "Nobody was injured.";
const thirdParty = "I was stationary at a red light when the other driver rear-ended my car.";
const reportProvided = "The police report reference is POL-2026-2048.";
const completeExpected = { claim_route: "fast_track_candidate", repair_band: "under_limit",
  injury_status: "no_injury", liability: "third_party_fault", police_reference: "Yes" };

export const CLAIM_CASES: ClaimCase[] = [
  claimCase("complete", "Complete low-value claim", "GBP 2,340", noInjury, thirdParty, reportProvided, completeExpected),
  claimCase("injury", "Injury requires an adjuster", "GBP 2,340", "A passenger was injured and taken to hospital.", thirdParty, reportProvided,
    { ...completeExpected, claim_route: "adjuster_review", injury_status: "injury_reported" }),
  claimCase("over-limit", "High repair estimate", "GBP 8,200", noInjury, thirdParty, reportProvided,
    { ...completeExpected, claim_route: "adjuster_review", repair_band: "at_or_over_limit" }),
  claimCase("missing-report", "Police reference still missing", "GBP 2,340", noInjury, thirdParty, "The police will send the report reference later; I do not have it yet.",
    { ...completeExpected, claim_route: "request_documents", police_reference: "No" }),
  claimCase("unclear-fault", "Conflicting accounts of fault", "GBP 2,340", noInjury, "Both vehicles were moving. Each driver says the other entered their lane; fault is unresolved.", reportProvided,
    { ...completeExpected, claim_route: "adjuster_review", liability: "shared_or_unclear" }),
  claimCase("exact-limit", "Exactly GBP 5,000 is not below the limit", "GBP 5,000", noInjury, thirdParty, reportProvided,
    { ...completeExpected, claim_route: "adjuster_review", repair_band: "at_or_over_limit" }),
];

export interface ClaimField {
  name: string;
  label: string;
  value: string;
  confidence: number;
  status: "filled" | "review" | "missing";
  quote: string;
  start: number;
  end: number;
}

export function parseClaimFields(text: string, content: string): ClaimField[] {
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim());
  if (!parsed.fields || typeof parsed.fields !== "object" || Array.isArray(parsed.fields)) throw new Error("Extraction did not return a fields object.");
  return CLAIM_FIELDS.map((spec) => {
    const field = parsed.fields[spec.name];
    if (!field || !Object.prototype.hasOwnProperty.call(field, "value")) throw new Error(`Extraction omitted ${spec.name}.`);
    if (field.value !== null && typeof field.value !== "string") throw new Error(`Invalid value for ${spec.name}.`);
    const value = typeof field.value === "string" ? field.value.trim() : "";
    const quote = typeof field.quote === "string" ? field.quote : "";
    const start = quote ? content.indexOf(quote) : -1;
    const confidence = typeof field.confidence === "number" ? Math.max(0, Math.min(1, field.confidence)) : 0;
    return { name: spec.name, label: spec.label, value, confidence, quote: start >= 0 ? quote : "",
      start, end: start >= 0 ? start + quote.length : -1,
      status: !value ? "missing" : start < 0 || confidence < 0.7
        || !quote.toLowerCase().replace(/\s/g, "").includes(value.toLowerCase().replace(/\s/g, "")) ? "review" : "filled" };
  });
}

export const CLAIM_EXTRACTION_PROMPT = `Extract the following claim fields. Return JSON only:
{"fields":{"field_name":{"value":"string or null","quote":"exact substring or null","confidence":0.0}}}.
Return every requested field. Use null for genuinely unstated values. Never substitute another person's phone.
Preserve source wording and formatting in values. Quotes must be exact substrings containing the value.
Do not invent facts, references or alternatives.
${CLAIM_FIELDS.map((field) => `${field.name}: ${field.definition}`).join("\n")}`;

export type ClaimOutcomeStatus = "fast_track_candidate" | "request_documents" | "adjuster_review" | "workflow_error";
export interface ClaimOutcome { status: ClaimOutcomeStatus; title: string; reason: string; reply: string }

export function claimOutcome(decision: DecisionRunResult | null, fields: ClaimField[], extractionError?: string): ClaimOutcome {
  let status: ClaimOutcomeStatus;
  let reason: string;
  const answers = decision?.answers;
  const key = (id: string) => answers?.[id]?.key;
  const route = key("claim_route");
  const repair = key("repair_band");
  const injury = key("injury_status");
  const liability = key("liability");
  const police = key("police_reference");
  const estimateText = fields.find((field) => field.name === "estimate")?.value || "";
  const estimateMatch = estimateText.match(/(?:GBP|£)\s*([\d,]+(?:\.\d+)?)/i);
  const estimate = estimateMatch ? Number(estimateMatch[1].replace(/,/g, "")) : NaN;
  if (!decision?.ok || !["fast_track_candidate", "request_documents", "adjuster_review"].includes(String(route))
      || !["under_limit", "at_or_over_limit", "not_stated"].includes(String(repair))
      || !["no_injury", "injury_reported", "not_stated"].includes(String(injury))
      || !["third_party_fault", "policyholder_fault", "shared_or_unclear"].includes(String(liability))
      || !["yes", "no"].includes(String(police))) {
    status = "workflow_error"; reason = "Decision evidence is unavailable or incomplete. No automated processing is authorized.";
  } else if (extractionError || fields.length !== CLAIM_FIELDS.length) {
    status = "workflow_error"; reason = "Form extraction failed. An agent must check the original email.";
  } else if (repair !== "under_limit" || injury !== "no_injury" || liability !== "third_party_fault") {
    status = "adjuster_review"; reason = "The explicit fast-track requirements are not all met; an adjuster must review the claim.";
  } else if (route !== (police === "yes" ? "fast_track_candidate" : "request_documents")) {
    status = "adjuster_review"; reason = "The model's route conflicts with the underlying policy checks. Escalate rather than proceed automatically.";
  } else if (!Number.isFinite(estimate) || estimate >= 5000 || estimate < 0
      || fields.some((field) => field.name !== "police_reference" && field.status !== "filled")) {
    status = "adjuster_review"; reason = "A form field is missing or unsupported by a reliable source quote. Human verification is required.";
  } else if (police === "no" || fields.find((field) => field.name === "police_reference")?.status !== "filled") {
    status = "request_documents"; reason = "The low-value/no-injury conditions are met, but the police reference needs to be supplied or verified.";
  } else {
    status = "fast_track_candidate"; reason = "The demonstration policy checks and source-backed fields are complete. This is a processing candidate, not approval or settlement.";
  }
  const titles: Record<ClaimOutcomeStatus, string> = {
    fast_track_candidate: "Fast-track processing candidate", request_documents: "Request missing documents",
    adjuster_review: "Adjuster review required", workflow_error: "Processing unavailable",
  };
  const reply = status === "fast_track_candidate"
    ? "Thank you for reporting the incident. Your information appears suitable for fast-track processing under this demonstration policy. Coverage and any settlement remain subject to the insurer's review."
    : status === "request_documents"
      ? "Thank you for reporting the incident. Please provide or confirm the police report reference so an agent can continue reviewing your claim. No settlement has been approved."
      : status === "adjuster_review"
        ? "Thank you for reporting the incident. An adjuster needs to review the circumstances or verify the supplied information. We cannot confirm fast-track processing or settlement at this stage."
        : "Thank you for reporting the incident. Automated processing could not be completed. An agent must review your original email before making any processing decision.";
  return { status, title: titles[status], reason, reply };
}

export function claimRequest(content: string, caseId: string, runId?: string) {
  return { content, caseId, policy: CLAIM_POLICY, questions: CLAIM_QUESTIONS, schemaVersion: 2, ...(runId ? { runId } : {}) };
}
