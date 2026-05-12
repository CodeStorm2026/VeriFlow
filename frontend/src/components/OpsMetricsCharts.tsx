import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MetricSeries, MetricsSnapshot } from "../types";

interface OpsMetricsChartsProps {
  metrics: MetricsSnapshot | null;
  series: MetricSeries[];
}

const tickTime = (ts: string) => {
  const d = new Date(ts);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : ts;
};

export default function OpsMetricsCharts({ metrics, series }: OpsMetricsChartsProps) {
  const throughput = series.map((row) => ({
    t: tickTime(row.ts),
    v: row.tx_per_sec,
  }));
  const latency = series.map((row) => ({
    t: tickTime(row.ts),
    ms: row.reconciliation_latency_ms,
  }));
  const mismatch = series.map((row) => ({
    t: tickTime(row.ts),
    pct: Math.round((row.mismatch_rate <= 1 ? row.mismatch_rate : row.mismatch_rate / 100) * 1000) / 10,
  }));
  const incidents = series.map((row) => ({
    t: tickTime(row.ts),
    n: row.active_incidents ?? 0,
  }));

  const nodeBars = Object.entries(metrics?.node_events ?? {}).map(([name, count]) => ({
    name: name.replace("_", " "),
    count,
  }));

  const empty = (
    <div className="flex min-h-[120px] items-center justify-center text-xs text-slate-500">
      No series yet
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="vf-card p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Throughput (rolling)
        </div>
        {throughput.length === 0 ? (
          empty
        ) : (
          <div className="h-[140px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={throughput} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="t" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis width={32} tick={{ fontSize: 9 }} />
                <Tooltip />
                <Line type="monotone" dataKey="v" name="tx/s" stroke="var(--vf-accent, #0d9488)" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="vf-card p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Recon latency (ms)
        </div>
        {latency.length === 0 ? (
          empty
        ) : (
          <div className="h-[140px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latency} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="t" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis width={36} tick={{ fontSize: 9 }} />
                <Tooltip />
                <Line type="monotone" dataKey="ms" name="ms" stroke="#111827" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="vf-card p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Mismatch % (rolling)
        </div>
        {mismatch.length === 0 ? (
          empty
        ) : (
          <div className="h-[140px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mismatch} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="t" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis width={28} tick={{ fontSize: 9 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="pct"
                  name="%"
                  stroke="var(--vf-danger, #dc2626)"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="vf-card p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Open incidents (series)
        </div>
        {incidents.length === 0 ? (
          empty
        ) : (
          <div className="h-[140px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={incidents} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="t" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} width={24} tick={{ fontSize: 9 }} />
                <Tooltip />
                <Line type="stepAfter" dataKey="n" name="open" stroke="#7c3aed" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="vf-card p-4 lg:col-span-2">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Events by node (current window)
          </div>
          <div className="font-mono text-xs text-slate-600">
            window {metrics?.events_in_window ?? "—"} · mismatches {metrics?.mismatch_events_in_window ?? "—"}
          </div>
        </div>
        {nodeBars.length === 0 ? (
          <div className="vf-subtle py-6 text-center text-sm">No ingest yet.</div>
        ) : (
          <div className="h-[160px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={nodeBars} margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={48} />
                <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--vf-accent, #0d9488)" radius={[4, 4, 0, 0]} name="events" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
