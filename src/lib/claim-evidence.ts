import type { ClaimCase, ClaimField } from "./claims";

export interface ClaimSourceLink {
  id: string;
  label: string;
  kind: "field" | "gate";
  review: boolean;
  ranges: { start: number; end: number }[];
}

export function claimSourceLinks(content: string, fields: ClaimField[], reference?: ClaimCase, policyAvailable = false): ClaimSourceLink[] {
  const links: ClaimSourceLink[] = fields.flatMap((field) => {
    if (!field.value || !field.quote || field.status === "missing" || field.start < 0
        || field.end > content.length || content.slice(field.start, field.end) !== field.quote) return [];
    const valueOffset = field.quote.indexOf(field.value);
    const start = valueOffset >= 0 ? field.start + valueOffset : field.start;
    const end = valueOffset >= 0 ? start + field.value.length : field.end;
    return [{ id: `field:${field.name}`, label: field.label, kind: "field" as const,
      review: field.status === "review", ranges: [{ start, end }] }];
  });
  if (policyAvailable && reference?.content === content) {
    for (const [id, quotes] of Object.entries(reference.evidence)) {
      const ranges = quotes.flatMap((quote) => {
        const start = quote ? content.indexOf(quote) : -1;
        return start < 0 ? [] : [{ start, end: start + quote.length }];
      });
      if (ranges.length) links.push({ id: `gate:${id}`, label: id, kind: "gate",
        review: ["adjuster_review", "request_documents", "at_or_over_limit", "injury_reported", "shared_or_unclear", "No"].includes(reference.expected[id]),
        ranges });
    }
  }
  return links;
}

export function claimSourceSegments(content: string, links: ClaimSourceLink[]) {
  const ranges = links.flatMap((link) => link.ranges.map((range) => ({ ...range, id: link.id })))
    .filter((range) => range.start >= 0 && range.end <= content.length && range.end > range.start);
  const boundaries = [...new Set([0, content.length, ...ranges.flatMap((range) => [range.start, range.end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    return { start, end, text: content.slice(start, end),
      linkIds: [...new Set(ranges.filter((range) => range.start <= start && range.end >= end).map((range) => range.id))] };
  });
}

export function claimAnswerLabel(value: string | number | null | undefined): string {
  const labels: Record<string, string> = {
    fast_track_candidate: "Fast-track candidate", request_documents: "Request documents", adjuster_review: "Adjuster review",
    under_limit: "Below £5,000", at_or_over_limit: "£5,000 or more", not_stated: "Not stated",
    no_injury: "No injury", injury_reported: "Injury reported", third_party_fault: "Third-party fault",
    policyholder_fault: "Claimant fault", shared_or_unclear: "Fault unclear", yes: "Yes", no: "No",
  };
  return value == null ? "No answer" : labels[String(value)] || String(value);
}
