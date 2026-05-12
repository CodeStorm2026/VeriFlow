import { NavLink } from "react-router-dom";

import ModulePageFrame from "../../components/ModulePageFrame";
import { useVeriFlowRuntime } from "../../context/VeriFlowRuntimeContext";
import { incidentLabel } from "../../lib/humanize";
import { formatPaymentRail } from "../../types";

const severityClass: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-rose-100 text-rose-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};

export default function ReversalsPage() {
  const { mismatchIncidents, recentGraphs, onOpenTransaction } = useVeriFlowRuntime();
  const queue = mismatchIncidents.slice(0, 25);

  return (
    <ModulePageFrame
      eyebrow="Ops"
      title="Reversals"
      subtitle="Mismatch queue. Row → detail / graph."
      actions={
        <>
          <NavLink to="/" className="vf-button vf-button-primary">
            Dashboard
          </NavLink>
          <NavLink to="/reports" className="vf-button vf-button-ghost">
            Reports
          </NavLink>
        </>
      }
    >
      <div className="vf-card overflow-hidden p-0">
        <div className="border-b border-black/5 px-5 py-3">
          <div className="text-sm font-semibold text-slate-900">Signals</div>
        </div>
        {queue.length === 0 ? (
          <div className="vf-subtle px-5 py-10 text-center text-sm">Empty.</div>
        ) : (
          <table className="vf-table">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Type</th>
                <th>Severity</th>
                <th className="text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {queue.map((inc) => (
                <tr key={inc.incident_id}>
                  <td className="font-mono text-sm">{inc.transaction_id}</td>
                  <td className="text-sm">{incidentLabel(inc.type)}</td>
                  <td>
                    <span
                      className={`vf-pill text-xs ${severityClass[inc.severity] ?? "bg-slate-100 text-slate-700"}`}
                    >
                      {inc.severity}
                    </span>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="vf-button vf-button-ghost py-1 text-xs"
                      onClick={() => onOpenTransaction(inc.transaction_id)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="vf-card overflow-hidden p-0">
        <div className="border-b border-black/5 px-5 py-3">
          <div className="text-sm font-semibold text-slate-900">Recent graphs</div>
        </div>
        {recentGraphs.length === 0 ? (
          <div className="vf-subtle px-5 py-8 text-center text-sm">Empty.</div>
        ) : (
          <table className="vf-table text-sm">
            <thead>
              <tr>
                <th>ID</th>
                <th>Rail</th>
                <th>Updated</th>
                <th className="text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {recentGraphs.slice(0, 12).map((g) => (
                <tr key={g.transaction_id}>
                  <td className="font-mono">{g.transaction_id}</td>
                  <td className="text-slate-600">{formatPaymentRail(g.payment_rail)}</td>
                  <td className="text-slate-600">{new Date(g.updated_at).toLocaleTimeString()}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="vf-button vf-button-ghost py-1 text-xs"
                      onClick={() => onOpenTransaction(g.transaction_id)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="vf-card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Next</h2>
        <p className="vf-subtle mt-2 text-sm">
          PSP hooks, funds controls, ISO rails, SIEM export — CODESTORM.
        </p>
      </div>
    </ModulePageFrame>
  );
}
