import { useEffect, useState } from "react";

import { isMismatchIncident } from "../lib/incidents";
import { flowLabel, incidentLabel } from "../lib/humanize";
import { formatPaymentRail, GraphSnapshot, Incident } from "../types";

interface TransactionListProps {
  graphs: GraphSnapshot[];
  activeId: string | null;
  incidentByTx: Record<string, Incident | undefined>;
  onSelect: (id: string) => void;
  /** Default 12; on the dashboard All tab you can show more */
  maxRows?: number;
}

const typeColor: Record<string, string> = {
  amount_mismatch: "bg-rose-100 text-rose-700",
  fee_mismatch: "bg-rose-100 text-rose-700",
  fee_policy_mismatch: "bg-purple-100 text-purple-800",
  fx_mismatch: "bg-rose-100 text-rose-700",
  bank_ledger_autocorrect: "bg-emerald-100 text-emerald-800",
  missing_hop: "bg-red-100 text-red-700",
  delayed_event: "bg-amber-100 text-amber-700",
  duplicate_event: "bg-orange-100 text-orange-700",
  incident: "bg-slate-100 text-slate-700",
};

const TransactionList = ({
  graphs,
  activeId,
  incidentByTx,
  onSelect,
  maxRows = 12,
}: TransactionListProps) => {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenuId) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-menu-id="${openMenuId}"]`)) {
        return;
      }
      setOpenMenuId(null);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openMenuId]);

  const resolveAmount = (graph: GraphSnapshot) => {
    const node = graph.nodes.find((item) => typeof item.amount === "number");
    return typeof node?.amount === "number" ? node.amount : null;
  };

  const resolveStatus = (graph: GraphSnapshot, incident?: Incident) => {
    if (incident && isMismatchIncident(incident)) {
      return { label: "Action", className: "vf-status vf-status-attention" };
    }
    const complete = graph.nodes.length > 0 && graph.nodes.every((node) => node.status !== "unknown");
    return complete
      ? { label: "Done", className: "vf-status vf-status-complete" }
      : { label: "Live", className: "vf-status vf-status-live" };
  };

  const resolveRisk = (incident?: Incident) => {
    if (!incident || !isMismatchIncident(incident)) {
      return { label: "Normal", className: "vf-risk vf-risk-low" };
    }
    const severity = incident.severity;
    if (severity === "critical" || severity === "high") {
      return { label: "High", className: "vf-risk vf-risk-high" };
    }
    if (severity === "medium") {
      return { label: "Medium", className: "vf-risk vf-risk-medium" };
    }
    return { label: "Low", className: "vf-risk vf-risk-low" };
  };

  return (
    <div className="vf-table-wrap">
      <table className="vf-table">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Flow</th>
            <th>Updated</th>
            <th>Issue</th>
            <th>Risk</th>
            <th>Status</th>
            <th className="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {graphs.slice(0, maxRows).map((graph) => {
            const incident = incidentByTx[graph.transaction_id];
            const type = incident?.type ?? "no_issues";
            const rowActive = activeId === graph.transaction_id;
            const amount = resolveAmount(graph);
            const status = resolveStatus(graph, incident);
            const risk = resolveRisk(incident);
            const issueLabel = incident ? incidentLabel(incident.type) : "—";
            const issueClass = incident
              ? typeColor[type] || typeColor.incident
              : "bg-emerald-100 text-emerald-700";
            return (
              <tr
                key={graph.transaction_id}
                className={rowActive ? "vf-row-active" : undefined}
              >
                <td>
                  <div className="vf-table-title">{graph.transaction_id}</div>
                  <div className="vf-table-sub">Amount {amount?.toFixed(2) ?? "--"}</div>
                </td>
                <td>
                  <div className="vf-table-title">{flowLabel(graph.flow_type)}</div>
                  <div className="vf-table-sub">{graph.path.join(" → ")}</div>
                  <div className="vf-table-sub">{formatPaymentRail(graph.payment_rail)}</div>
                </td>
                <td>
                  <div className="vf-table-title">
                    {new Date(graph.updated_at).toLocaleDateString()}
                  </div>
                  <div className="vf-table-sub">
                    {new Date(graph.updated_at).toLocaleTimeString()}
                  </div>
                </td>
                <td>
                  <span className={`vf-pill ${issueClass}`}>{issueLabel}</span>
                </td>
                <td>
                  <span className={risk.className}>{risk.label}</span>
                </td>
                <td>
                  <span className={status.className}>{status.label}</span>
                </td>
                <td className="text-right">
                  <div className="vf-action" data-menu-id={graph.transaction_id}>
                    <button
                      type="button"
                      className="vf-icon-button"
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === graph.transaction_id}
                      onClick={() =>
                        setOpenMenuId((prev) =>
                          prev === graph.transaction_id ? null : graph.transaction_id
                        )
                      }
                    >
                      <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
                        <circle cx="6" cy="12" r="1.6" fill="currentColor" />
                        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                        <circle cx="18" cy="12" r="1.6" fill="currentColor" />
                      </svg>
                    </button>
                    {openMenuId === graph.transaction_id && (
                      <div className="vf-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuId(null);
                            onSelect(graph.transaction_id);
                          }}
                        >
                          Details
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {graphs.length === 0 && (
        <div className="vf-empty">Empty.</div>
      )}
    </div>
  );
};

export default TransactionList;
