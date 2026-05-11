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
}: DashboardPageProps) => {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
      <TransactionList
        graphs={graphs}
        activeId={activeId}
        incidentByTx={incidentByTx}
        onSelect={onSelect}
      />
      <div className="flex flex-col gap-6">
        <MetricsBar metrics={metrics} series={series} />
        <IncidentPanel incidents={incidents} />
        <DemoControls apiUrl={apiUrl} />
      </div>
    </div>
  );
};

export default DashboardPage;
