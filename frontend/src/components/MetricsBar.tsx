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

  const cards = [
    {
      label: "Tx / sec",
      value: txPerSec.toFixed(1),
      meta: lastUpdate ? `Updated ${new Date(lastUpdate).toLocaleTimeString()}` : "Live feed",
      progress: normalize(txPerSec, 120),
      tone: "var(--vf-accent)",
    },
    {
      label: "Mismatch rate",
      value: `${mismatchPercent}%`,
      meta: "Risk exposure",
      progress: normalize(mismatchPercent, 25),
      tone: "var(--vf-warning)",
    },
    {
      label: "Recon latency (ms)",
      value: latency.toFixed(0),
      meta: "Cross-system lag",
      progress: normalize(latency, 1200),
      tone: "#111827",
    },
    {
      label: "Active incidents",
      value: activeIncidents.toString(),
      meta: "Open investigations",
      progress: normalize(activeIncidents, 20),
      tone: "var(--vf-danger)",
    },
  ];

  return (
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
            style={{
              "--progress": `${card.progress}%`,
              "--bar-color": card.tone,
            } as CSSProperties}
          />
        </div>
      ))}
    </div>
  );
};

export default MetricsBar;
