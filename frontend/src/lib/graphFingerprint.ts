import type { GraphSnapshot } from "../types";

/** Fingerprint for reconciliation / display equality — ignores edge animation (cosmetic). */
export function graphSemanticFingerprint(snapshot: GraphSnapshot | null): string {
  if (!snapshot) {
    return "";
  }
  const nodeKey = snapshot.nodes
    .map(
      (node) =>
        `${node.id}:${node.status}:${node.amount ?? ""}:${node.fee ?? ""}:${node.currency ?? ""}`
    )
    .join("|");
  const edgeKey = snapshot.edges.map((edge) => `${edge.id}:${edge.status}`).join("|");
  return `${snapshot.transaction_id}::${snapshot.payment_rail ?? ""}::${nodeKey}::${edgeKey}`;
}
