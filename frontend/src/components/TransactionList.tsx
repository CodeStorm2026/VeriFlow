import { GraphSnapshot, Incident } from "../types";

interface TransactionListProps {
  graphs: GraphSnapshot[];
  activeId: string | null;
  incidentByTx: Record<string, Incident | undefined>;
  onSelect: (id: string) => void;
}

const typeColor: Record<string, string> = {
  amount_mismatch: "bg-rose-100 text-rose-700",
  fee_mismatch: "bg-rose-100 text-rose-700",
  fx_mismatch: "bg-rose-100 text-rose-700",
  missing_hop: "bg-red-100 text-red-700",
  delayed_event: "bg-amber-100 text-amber-700",
  duplicate_event: "bg-orange-100 text-orange-700",
  incident: "bg-slate-100 text-slate-700",
};

const TransactionList = ({ graphs, activeId, incidentByTx, onSelect }: TransactionListProps) => {
  return (
    <div className="vf-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Active incidents</div>
        <div className="vf-subtle">{graphs.length} open</div>
      </div>
      <div className="max-h-[520px] overflow-auto rounded-xl border border-black/10 bg-white/70">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Transaction</th>
              <th className="px-3 py-2 text-left">Flow</th>
              <th className="px-3 py-2 text-left">Detected</th>
              <th className="px-3 py-2 text-left">Issue</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {graphs.slice(0, 12).map((graph) => {
              const incident = incidentByTx[graph.transaction_id];
              const type = incident?.type ?? "incident";
              const rowActive = activeId === graph.transaction_id;
              return (
                <tr
                  key={graph.transaction_id}
                  className={`border-t border-black/5 ${
                    rowActive ? "bg-emerald-50/70" : "hover:bg-white"
                  }`}
                >
                  <td className="px-3 py-2 font-semibold text-slate-700">
                    {graph.transaction_id}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{graph.flow_type}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {incident?.timestamp
                      ? new Date(incident.timestamp).toLocaleTimeString()
                      : new Date(graph.updated_at).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`vf-pill ${typeColor[type] || typeColor.incident}`}>
                      {type.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => onSelect(graph.transaction_id)}
                      className="rounded-lg border border-black/10 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600"
                    >
                      Detail
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {graphs.length === 0 && (
          <div className="p-4 text-sm text-slate-500">No active incidents.</div>
        )}
      </div>
    </div>
  );
};

export default TransactionList;
