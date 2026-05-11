import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

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

  return (
    <div className="vf-card p-4">
      <div className="mb-4 text-sm font-semibold">Metrics</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-black/5 bg-white/70 p-3">
          <div className="text-xs uppercase text-slate-400">Tx / sec</div>
          <div className="text-2xl font-semibold text-slate-900">{txPerSec}</div>
          <div className="mt-2 h-16">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <Tooltip wrapperStyle={{ fontSize: 10 }} />
                <Area type="monotone" dataKey="tx_per_sec" stroke="#0ea5a4" fill="#99f6e4" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-black/5 bg-white/70 p-3">
          <div className="text-xs uppercase text-slate-400">Mismatch rate</div>
          <div className="text-2xl font-semibold text-slate-900">{mismatchRate}</div>
          <div className="mt-2 h-16">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <Tooltip wrapperStyle={{ fontSize: 10 }} />
                <Area type="monotone" dataKey="mismatch_rate" stroke="#f97316" fill="#fed7aa" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-black/5 bg-white/70 p-3">
          <div className="text-xs uppercase text-slate-400">Recon latency (ms)</div>
          <div className="text-2xl font-semibold text-slate-900">{latency}</div>
        </div>
        <div className="rounded-xl border border-black/5 bg-white/70 p-3">
          <div className="text-xs uppercase text-slate-400">Active incidents</div>
          <div className="text-2xl font-semibold text-slate-900">{activeIncidents}</div>
        </div>
      </div>
    </div>
  );
};

export default MetricsBar;
