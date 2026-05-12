import { Incident } from "../types";

const typeColor: Record<string, string> = {
  amount_mismatch: "bg-rose-100 text-rose-700",
  fee_mismatch: "bg-rose-100 text-rose-700",
  fx_mismatch: "bg-rose-100 text-rose-700",
  missing_hop: "bg-red-100 text-red-700",
  delayed_event: "bg-amber-100 text-amber-700",
  duplicate_event: "bg-orange-100 text-orange-700",
  incident: "bg-slate-100 text-slate-700",
};

interface IncidentPanelProps {
  incidents: Incident[];
}

const IncidentPanel = ({ incidents }: IncidentPanelProps) => {
  return (
    <div className="vf-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Mismatch alerts</div>
        <div className="vf-subtle">{incidents.length} open</div>
      </div>
      <div className="max-h-[360px] space-y-3 overflow-auto pr-1">
        {incidents.map((incident) => (
          <div key={incident.incident_id} className="rounded-xl border border-black/5 bg-white/70 p-3">
            <div className="flex items-center justify-between">
              <span className={`vf-pill ${typeColor[incident.type] || typeColor.incident}`}>
                {incident.type.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-slate-400">
                {new Date(incident.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-800">{incident.message}</div>
            <div className="mt-1 text-xs text-slate-500">
              nodes: {incident.affected_nodes.join(" -> ")} | confidence: {incident.confidence}
            </div>
          </div>
        ))}
        {incidents.length === 0 && (
          <div className="text-sm text-slate-500">No mismatches yet.</div>
        )}
      </div>
    </div>
  );
};

export default IncidentPanel;
