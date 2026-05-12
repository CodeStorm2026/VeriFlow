/** Short operator-facing labels — avoid raw enum / snake_case in UI. */

const INCIDENT: Record<string, string> = {
  amount_mismatch: "Amount",
  fee_mismatch: "Fee",
  fee_policy_mismatch: "Fee policy",
  fx_mismatch: "FX",
  missing_hop: "Missing hop",
  delayed_event: "Delay",
  duplicate_event: "Duplicate",
  bank_ledger_autocorrect: "Bank auto-nudge",
};

export function incidentLabel(type: string): string {
  return INCIDENT[type] ?? type.replace(/_/g, " ");
}

export function flowLabel(flow: string | undefined): string {
  if (flow === "crypto") return "Bridge";
  if (flow === "standard") return "Fiat";
  return flow?.trim() ? flow : "—";
}
