import { CSSProperties } from "react";

import { MetricSeries, MetricsSnapshot } from "../types";

interface MetricsBarProps {
  metrics: MetricsSnapshot | null;
  series: MetricSeries[];
}

const MetricsBar = ({ metrics, series }: MetricsBarProps) => {
  const txPerSec = metrics?.tx_per_sec ?? 0;
  const mismatchRate = metrics?.mismatch_rate ?? 0;
  const latency = metrics?.reconciliation_latency_ms ?? 0;
  const activeIncidents = metrics?.active_incidents ?? 0;
  const lastUpdate = series[series.length - 1]?.ts;

  const normalize = (value: number, max: number) => {
    if (max <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  };

  const mismatchPercent = mismatchRate <= 1 ? Math.round(mismatchRate * 100) : mismatchRate;

  const ingestSummary =
    metrics?.node_events && Object.keys(metrics.node_events).length > 0
      ? Object.entries(metrics.node_events)
          .map(([k, v]) => `${k.replace("_", " ")} ${v}`)
          .join(" · ")
      : null;

  const cards = [
    {
      label: "Tx / sec",
      value: txPerSec.toFixed(1),
      meta: lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : "—",
      progress: normalize(txPerSec, 120),
      tone: "var(--vf-accent)",
    },
    {
      label: "Mismatch rate",
      value: `${mismatchPercent}%`,
      meta: "share",
      progress: normalize(mismatchPercent, 25),
      tone: "var(--vf-warning)",
    },
    {
      label: "Latency (ms)",
      value: latency.toFixed(0),
      meta: "p95-ish",
      progress: normalize(latency, 1200),
      tone: "#111827",
    },
    {
      label: "Incidents",
      value: activeIncidents.toString(),
      meta: "open",
      progress: normalize(activeIncidents, 20),
      tone: "var(--vf-danger)",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="vf-stat-grid">
        {cards.map((card) => (
          <div key={card.label} className="vf-stat">
            <div className="vf-stat-header">
              <div className="vf-stat-label">{card.label}</div>
              <div className="vf-stat-value">{card.value}</div>
            </div>
            <div className="vf-stat-meta">{card.meta}</div>
            <div
              className="vf-stat-bar"
              style={
                {
                  "--progress": `${card.progress}%`,
                  "--bar-color": card.tone,
                } as CSSProperties
              }
            />
          </div>
        ))}
      </div>
      {ingestSummary ? (
        <div className="vf-subtle rounded-lg border border-black/5 px-2 py-1.5 text-[11px]">
          <span className="font-medium text-slate-600">Ingest · </span>
          {ingestSummary}
          <span className="ml-2 font-mono text-slate-500">
            win {metrics?.events_in_window ?? 0} ev / {metrics?.mismatch_events_in_window ?? 0} mismatch
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default MetricsBar;
