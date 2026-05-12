import DemoControls from "../components/DemoControls";
import IncidentPanel from "../components/IncidentPanel";
import MetricsBar from "../components/MetricsBar";
import TransactionList from "../components/TransactionList";
import { GraphSnapshot, Incident, MetricSeries, MetricsSnapshot } from "../types";

interface DashboardPageProps {
  graphs: GraphSnapshot[];
  activeId: string | null;
  incidentByTx: Record<string, Incident | undefined>;
  metrics: MetricsSnapshot | null;
  series: MetricSeries[];
  incidents: Incident[];
  apiUrl: string;
  onSelect: (id: string) => void;
  onManualDemo: () => void;
}

const DashboardPage = ({
  graphs,
  activeId,
  incidentByTx,
  metrics,
  series,
  incidents,
  apiUrl,
  onSelect,
  onManualDemo,
}: DashboardPageProps) => {
  const bannerIncident = incidents[0];
  const bannerTxId =
    bannerIncident?.transaction_id ?? activeId ?? graphs[0]?.transaction_id ?? "";
  const bannerIssue = bannerIncident?.type
    ? bannerIncident.type.replace(/_/g, " ")
    : "anomaly detection";
  const bannerMessage = bannerTxId
    ? `Transaction ${bannerTxId} flagged for ${bannerIssue}. Manual resolution required.`
    : "No mismatch alerts yet. Monitoring transaction integrity.";

  return (
    <div className="space-y-6">
      <div className="vf-banner">
        <div className="vf-banner-left">
          <span className="vf-banner-chip" aria-hidden="true">
            Alert
          </span>
          <div>
            <div className="vf-banner-title">{bannerMessage}</div>
            <div className="vf-banner-sub">
              Continuous reconciliation detects mismatches, delays, and missing hops.
            </div>
          </div>
        </div>
        <div className="vf-banner-actions">
          <button type="button" className="vf-button vf-button-ghost">
            Escalate for review
          </button>
          <button
            type="button"
            className="vf-button vf-button-primary"
            onClick={() => bannerTxId && onSelect(bannerTxId)}
            disabled={!bannerTxId}
          >
            View details
          </button>
        </div>
      </div>

      <MetricsBar metrics={metrics} series={series} />

      <div className="vf-card p-4">
        <div className="vf-table-head">
          <div>
            <div className="text-sm font-semibold">Mismatch queue</div>
            <div className="vf-subtle">{graphs.length} items requiring action</div>
          </div>
          <div className="vf-table-actions">
            <button type="button" className="vf-button vf-button-ghost">
              Filter
            </button>
            <button type="button" className="vf-button vf-button-ghost">
              Sort by
            </button>
            <button type="button" className="vf-button vf-button-primary">
              New reversal request
            </button>
            <button type="button" className="vf-button vf-button-ghost">
              Import/Export
            </button>
          </div>
        </div>
        <TransactionList
          graphs={graphs}
          activeId={activeId}
          incidentByTx={incidentByTx}
          onSelect={onSelect}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <IncidentPanel incidents={incidents} />
        <DemoControls apiUrl={apiUrl} onManualTrigger={onManualDemo} />
      </div>
    </div>
  );
};

export default DashboardPage;
