import type { Incident } from "../types";

/** Incident types treated as amount / policy / FX signal (reversal & reporting scope). */
export const MISMATCH_TYPES = new Set<string>([
  "amount_mismatch",
  "fee_mismatch",
  "fee_policy_mismatch",
  "fx_mismatch",
]);

export function isMismatchIncident(incident: Pick<Incident, "type">): boolean {
  return MISMATCH_TYPES.has(incident.type);
}
