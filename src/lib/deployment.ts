export const DEFAULT_DECISION_DEPLOYMENT = "Decision-1.1";
export const DEFAULT_DECISION_ENDPOINT = "https://icsuaaije.services.ai.azure.com/models";

export function normalizeFoundryEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "").replace(/\/models$/i, "");
}
