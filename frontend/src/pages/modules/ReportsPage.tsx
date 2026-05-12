import { NavLink } from "react-router-dom";

import MetricsBar from "../../components/MetricsBar";
import MismatchChart from "../../components/MismatchChart";
import OpsMetricsCharts from "../../components/OpsMetricsCharts";
import ModulePageFrame from "../../components/ModulePageFrame";
import { useVeriFlowRuntime } from "../../context/VeriFlowRuntimeContext";
import { incidentLabel } from "../../lib/humanize";

export default function ReportsPage() {
  const { metrics, series, mismatchMinuteBuckets, mismatchIncidents, onOpenTransaction } =
    useVeriFlowRuntime();
  const rows = mismatchIncidents.slice(0, 20);

  return (
    <ModulePageFrame
      eyebrow="Analytics"
      title="Reports"
      subtitle="Mismatch rate, latest signals."
      actions={
        <NavLink to="/" className="vf-button vf-button-primary">
          Dashboard
        </NavLink>
      }
    >
      <MetricsBar metrics={metrics} series={series} />

      <MismatchChart data={mismatchMinuteBuckets} />

      <OpsMetricsCharts metrics={metrics} series={series} />

      <div className="vf-card overflow-hidden p-0">
        <div className="border-b border-black/5 px-5 py-3 text-sm font-semibold text-slate-900">
          Recent
        </div>
        {rows.length === 0 ? (
          <div className="vf-subtle px-5 py-8 text-center text-sm">Empty.</div>
        ) : (
          <table className="vf-table text-sm">
            <thead>
              <tr>
                <th>Time</th>
                <th>Payment</th>
                <th>Signal</th>
                <th>Severity</th>
                <th className="text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inc) => (
                <tr key={inc.incident_id}>
                  <td className="whitespace-nowrap text-slate-600">
                    {new Date(inc.timestamp).toLocaleString()}
                  </td>
                  <td className="font-mono">{inc.transaction_id}</td>
                  <td>{incidentLabel(inc.type)}</td>
                  <td>{inc.severity}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="vf-button vf-button-ghost py-1 text-xs"
                      onClick={() => onOpenTransaction(inc.transaction_id)}
                    >
                      Graph
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="vf-card p-4 text-sm text-slate-600">Exports / long history: not in build.</div>
    </ModulePageFrame>
  );
}
