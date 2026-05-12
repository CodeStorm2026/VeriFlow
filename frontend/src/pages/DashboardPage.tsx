import { useEffect, useMemo, useState } from "react";
import DemoControls from "../components/DemoControls";
import IncidentPanel from "../components/IncidentPanel";
import MetricsBar from "../components/MetricsBar";
import MismatchChart from "../components/MismatchChart";
import OpsMetricsCharts from "../components/OpsMetricsCharts";
import SourceHealthBar from "../components/SourceHealthBar";
import TransactionList from "../components/TransactionList";
import { incidentLabel } from "../lib/humanize";
import {
  GraphSnapshot,
  Incident,
  MetricSeries,
  MetricsSnapshot,
} from "../types";

export interface MismatchMinuteBucket {
  minute: string;
  count: number;
}

export type DashboardResolutionEntry = {
  transaction_id: string;
  kind: "mock_correction" | "bank_autocorrect";
  summary: string;
  at_ms: number;
};

type QueueTab = "all" | "problems" | "incomplete" | "resolved";

interface DashboardPageProps {
  graphs: GraphSnapshot[];
  allGraphs: GraphSnapshot[];
  incompleteGraphs: GraphSnapshot[];
  resolutionLog: DashboardResolutionEntry[];
  activeId: string | null;
  incidentByTx: Record<string, Incident | undefined>;
  primaryIncidentByTx: Record<string, Incident | undefined>;
  metrics: MetricsSnapshot | null;
  series: MetricSeries[];
  incidents: Incident[];
  apiUrl: string;
  onSelect: (id: string) => void;
  onManualDemo: () => void;
  onDemoScenarioQueued?: (transactionId: string) => void;
  bannerIncident: Incident | undefined;
  bannerSla:
    | { deadline_ms: number; transaction_id: string; severity?: string }
    | undefined;
  onEscalateNow: () => void;
  mismatchMinuteBuckets: MismatchMinuteBucket[];
  sourceHealth: Record<string, { status: string; age_ms?: number | null }>;
}

const DashboardPage = ({
  graphs,
  allGraphs,
  incompleteGraphs,
  resolutionLog,
  activeId,
  incidentByTx,
  primaryIncidentByTx,
  metrics,
  series,
  incidents,
  apiUrl,
  onSelect,
  onManualDemo,
  onDemoScenarioQueued,
  bannerIncident,
  bannerSla,
  onEscalateNow,
  mismatchMinuteBuckets,
  sourceHealth,
}: DashboardPageProps) => {
  const [queueTab, setQueueTab] = useState<QueueTab>("all");
  const [slaTick, setSlaTick] = useState(0);

  useEffect(() => {
    if (!bannerSla || !bannerIncident) {
      return;
    }
    const id = window.setInterval(() => setSlaTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [bannerSla?.deadline_ms, bannerIncident?.incident_id]);

  const slaSecondsLeft = useMemo(() => {
    if (!bannerSla) {
      return null;
    }
    return Math.max(0, Math.ceil((bannerSla.deadline_ms - Date.now()) / 1000));
  }, [bannerSla, slaTick]);

  const listGraphs = useMemo(() => {
    if (queueTab === "all") {
      return allGraphs;
    }
    if (queueTab === "problems") {
      return graphs;
    }
    if (queueTab === "incomplete") {
      return incompleteGraphs;
    }
    return [];
  }, [queueTab, allGraphs, graphs, incompleteGraphs]);

  const incidentMap =
    queueTab === "problems" ? incidentByTx : primaryIncidentByTx;

  const bannerFallbackTx =
    incompleteGraphs[0]?.transaction_id ?? allGraphs[0]?.transaction_id ?? "";
  const bannerTxId = bannerIncident?.transaction_id ?? activeId ?? bannerFallbackTx;
  const bannerIssue = bannerIncident?.type
    ? incidentLabel(bannerIncident.type)
    : incompleteGraphs.length > 0
      ? "has incomplete hops"
      : "no critical mismatch in focus";
  const bannerMessage = bannerTxId ? `${bannerTxId} · ${bannerIssue}` : "No transactions in the window.";

  const tabClass = (tab: QueueTab) =>
    `rounded-lg px-3 py-1.5 text-xs font-medium ${
      queueTab === tab ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
    }`;

  return (
    <div className="space-y-6">
      <div className="vf-banner">
        <div className="vf-banner-left">
          <span className="vf-banner-chip" aria-hidden="true">
            Signal
          </span>
          <div>
            <div className="vf-banner-title">{bannerMessage}</div>
            <div className="vf-banner-sub">
              Bridge: gateway → exchange → bank. Filter the queue below: all, mismatch-only,
              incomplete, resolution log.
            </div>
            {slaSecondsLeft != null && bannerIncident && (
              <div className="vf-banner-sub mt-1 font-mono text-sm text-amber-800">
                SLA · {slaSecondsLeft}s · {bannerIncident.incident_id}
              </div>
            )}
          </div>
        </div>
        <div className="vf-banner-actions">
          <button
            type="button"
            className="vf-button vf-button-ghost"
            onClick={onEscalateNow}
            disabled={!bannerIncident}
          >
            Escalate
          </button>
          <button
            type="button"
            className="vf-button vf-button-primary"
            onClick={() => bannerTxId && onSelect(bannerTxId)}
            disabled={!bannerTxId}
          >
            Details
          </button>
        </div>
      </div>

      <MetricsBar metrics={metrics} series={series} />

      <OpsMetricsCharts metrics={metrics} series={series} />

      <div className="grid gap-6 lg:grid-cols-2">
        <MismatchChart data={mismatchMinuteBuckets} />
        <SourceHealthBar nodes={sourceHealth} />
      </div>

      <div className="vf-card p-4">
        <div className="vf-table-head">
          <div>
            <div className="text-sm font-semibold">Transaction queue</div>
            <div className="vf-subtle text-xs">
              All: {allGraphs.length} · Problems (mismatch): {graphs.length} · Incomplete:{" "}
              {incompleteGraphs.length} · In resolution log: {resolutionLog.length}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={tabClass("all")} onClick={() => setQueueTab("all")}>
              All
            </button>
            <button
              type="button"
              className={tabClass("problems")}
              onClick={() => setQueueTab("problems")}
            >
              Problems
            </button>
            <button
              type="button"
              className={tabClass("incomplete")}
              onClick={() => setQueueTab("incomplete")}
            >
              Incomplete
            </button>
            <button
              type="button"
              className={tabClass("resolved")}
              onClick={() => setQueueTab("resolved")}
            >
              Resolved
            </button>
          </div>
        </div>

        {queueTab === "resolved" ? (
          <div className="vf-table-wrap mt-3">
            {resolutionLog.length === 0 ? (
              <p className="vf-subtle px-2 py-8 text-center text-sm">
                No entries yet. They appear after a mock correction (payment detail) or a bank
                auto-nudge (bank ledger autocorrect).
              </p>
            ) : (
              <table className="vf-table text-sm">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Payment</th>
                    <th>Type</th>
                    <th>Action</th>
                    <th className="text-right"> </th>
                  </tr>
                </thead>
                <tbody>
                  {resolutionLog.map((row, idx) => (
                    <tr key={`${row.transaction_id}-${row.at_ms}-${idx}`}>
                      <td className="whitespace-nowrap text-slate-500">
                        {new Date(row.at_ms).toLocaleString()}
                      </td>
                      <td className="font-mono text-xs">{row.transaction_id}</td>
                      <td>
                        <span className="vf-pill bg-slate-100 text-slate-800 text-xs">
                          {row.kind === "mock_correction" ? "Mock correction" : "Bank auto-nudge"}
                        </span>
                      </td>
                      <td className="max-w-md text-slate-800">{row.summary}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="vf-button vf-button-ghost py-1 text-xs"
                          onClick={() => onSelect(row.transaction_id)}
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
        ) : listGraphs.length === 0 ? (
          <p className="vf-subtle mt-4 px-2 py-8 text-center text-sm">
            {queueTab === "problems"
              ? "No mismatch in the current window — run a demo scenario with a divergence or inject a fault."
              : queueTab === "incomplete"
                ? "All visible graphs are complete on every node."
                : "No graphs yet — wait for the simulator or create a payment from the demo."}
          </p>
        ) : (
          <TransactionList
            graphs={listGraphs}
            activeId={activeId}
            incidentByTx={incidentMap}
            onSelect={onSelect}
            maxRows={queueTab === "all" ? 24 : 18}
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <IncidentPanel incidents={incidents.slice(0, 30)} />
        <DemoControls
          apiUrl={apiUrl}
          onManualTrigger={onManualDemo}
          onDemoScenarioQueued={onDemoScenarioQueued}
        />
      </div>
    </div>
  );
};

export default DashboardPage;
