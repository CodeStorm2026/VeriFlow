import { useMemo } from "react";
import { NavLink } from "react-router-dom";

import MetricsBar from "../../components/MetricsBar";
import MismatchChart from "../../components/MismatchChart";
import ModulePageFrame from "../../components/ModulePageFrame";
import OpsMetricsCharts from "../../components/OpsMetricsCharts";
import SourceHealthBar from "../../components/SourceHealthBar";
import { useVeriFlowRuntime } from "../../context/VeriFlowRuntimeContext";
import { flowLabel } from "../../lib/humanize";
import { MODULE_PATHS } from "../../nav/routesConfig";
import type { GraphSnapshot } from "../../types";
import { formatPaymentRail } from "../../types";

function isCryptoGraph(g: GraphSnapshot): boolean {
  return g.flow_type === "crypto" || g.payment_rail === "crypto_settlement";
}

function merchantPrincipal(g: GraphSnapshot): number | undefined {
  const n = g.nodes.find((x) => x.id === "merchant");
  return typeof n?.amount === "number" ? n.amount : undefined;
}

export default function SettlementPage() {
  const {
    sourceHealth,
    metrics,
    series,
    mismatchMinuteBuckets,
    recentGraphs,
    mismatchIncidents,
    onOpenTransaction,
  } = useVeriFlowRuntime();

  const sourceRows = useMemo(() => Object.entries(sourceHealth), [sourceHealth]);

  const okCount = useMemo(
    () => sourceRows.filter(([, v]) => v.status === "ok").length,
    [sourceRows]
  );
  const staleCount = useMemo(
    () => sourceRows.filter(([, v]) => v.status === "stale").length,
    [sourceRows]
  );

  const railMix = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of recentGraphs) {
      const key = g.payment_rail?.trim() || "unspecified";
      m[key] = (m[key] ?? 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [recentGraphs]);

  const bridgeSharePct = useMemo(() => {
    if (recentGraphs.length === 0) {
      return null;
    }
    const n = recentGraphs.filter(isCryptoGraph).length;
    return Math.round((n / recentGraphs.length) * 1000) / 10;
  }, [recentGraphs]);

  const bridgeVolume = useMemo(() => {
    let s = 0;
    for (const g of recentGraphs) {
      if (!isCryptoGraph(g)) {
        continue;
      }
      const a = merchantPrincipal(g);
      if (typeof a === "number") {
        s += a;
      }
    }
    return s;
  }, [recentGraphs]);

  const openMismatchCount = useMemo(() => mismatchIncidents.length, [mismatchIncidents]);

  return (
    <ModulePageFrame
      eyebrow="Treasury"
      title="Settlement"
      subtitle="Rails snapshot, source pulse, and cut-off slip risk. Same metrics as the operator console."
      actions={
        <>
          <NavLink to="/" className="vf-button vf-button-primary">
            Dashboard
          </NavLink>
          <NavLink to={MODULE_PATHS.reports} className="vf-button vf-button-ghost">
            Reports
          </NavLink>
          <NavLink to={MODULE_PATHS.reconciliation} className="vf-button vf-button-ghost">
            Reconciliation
          </NavLink>
        </>
      }
    >
      <div className="rounded-2xl border border-amber-200/70 bg-gradient-to-r from-amber-50 via-white to-teal-50/80 p-5 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-900/80">
          Cut-off and liquidity
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-800">
          Treasury focuses on <strong>rail readiness</strong> for end-of-day close: whether node simulators
          are alive, mismatch backlog, and enough window for bridge flows. Below is live WebSocket data;
          SLA thresholds and limits live in deploy config (<span className="font-mono">VF_*</span>).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="vf-card p-4">
          <div className="text-xs text-slate-500">Sources OK</div>
          <div className="text-2xl font-semibold text-emerald-800">{okCount}</div>
          <div className="text-[11px] text-slate-500">of {sourceRows.length || "—"} on air</div>
        </div>
        <div className="vf-card border-amber-100 bg-amber-50/50 p-4">
          <div className="text-xs text-amber-900/80">Stale</div>
          <div className="text-2xl font-semibold text-amber-950">{staleCount}</div>
          <div className="text-[11px] text-amber-900/70">check cut-off / network</div>
        </div>
        <div className="vf-card p-4">
          <div className="text-xs text-slate-500">Bridge share in window</div>
          <div className="text-2xl font-semibold text-violet-900">
            {bridgeSharePct != null ? `${bridgeSharePct}%` : "—"}
          </div>
          <div className="text-[11px] text-slate-500">from latest graphs</div>
        </div>
        <div className="vf-card p-4">
          <div className="text-xs text-slate-500">Bridge volume (merchant sum)</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">
            {bridgeVolume > 0 ? bridgeVolume.toFixed(0) : "—"}
          </div>
          <div className="text-[11px] text-slate-500">open signals: {openMismatchCount}</div>
        </div>
      </div>

      <MetricsBar metrics={metrics} series={series} />

      <div className="grid gap-6 lg:grid-cols-2">
        <MismatchChart data={mismatchMinuteBuckets} />
        <div className="vf-card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Rails in window</h2>
          <p className="vf-subtle mt-1 text-xs">
            Distribution of latest graphs by <span className="font-mono">payment_rail</span> — for
            liquidity planning and reserves.
          </p>
          {railMix.length === 0 ? (
            <p className="vf-subtle mt-4 text-sm">No graphs in the window yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {railMix.map(([rail, count]) => (
                <li
                  key={rail}
                  className="flex items-center justify-between rounded-lg border border-black/5 bg-white/80 px-3 py-2 text-sm"
                >
                  <span className="text-slate-800">{formatPaymentRail(rail)}</span>
                  <span className="font-mono text-slate-600">{count}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="vf-subtle mt-4 border-t border-black/5 pt-3 text-xs leading-relaxed">
            <strong>Card / transfer</strong> — short fiat path. <strong>Crypto settlement</strong> adds
            the exchange leg and higher reserve and clearing-time requirements.
          </div>
        </div>
      </div>

      <OpsMetricsCharts metrics={metrics} series={series} />

      <div className="vf-card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Sources (heartbeat)</h2>
        <p className="vf-subtle mt-1 text-xs">
          Simulator nodes. <span className="font-medium">Stale</span> status is a reason not to release a
          batch to the bank without manual review.
        </p>
        {sourceRows.length === 0 ? (
          <p className="vf-subtle mt-4 text-sm">Waiting for data…</p>
        ) : (
          <>
            <div className="mt-4">
              <SourceHealthBar nodes={sourceHealth} embedded />
            </div>
            <div className="mt-6 overflow-x-auto rounded-xl border border-black/5">
              <table className="vf-table text-sm">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Status</th>
                    <th className="text-right">Age, s</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.map(([id, info]) => (
                    <tr key={id}>
                      <td className="font-mono text-xs">{id}</td>
                      <td>
                        <span
                          className={`vf-pill text-xs ${
                            info.status === "ok"
                              ? "bg-emerald-100 text-emerald-800"
                              : info.status === "stale"
                                ? "bg-amber-100 text-amber-900"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {info.status}
                        </span>
                      </td>
                      <td className="text-right tabular-nums text-slate-600">
                        {info.age_ms != null ? `${Math.round(info.age_ms / 1000)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="vf-card overflow-hidden p-0">
        <div className="border-b border-black/5 px-5 py-3">
          <div className="text-sm font-semibold text-slate-900">Recent flows (treasury)</div>
          <div className="vf-subtle text-xs">Click — payment card and graph</div>
        </div>
        {recentGraphs.length === 0 ? (
          <div className="vf-subtle px-5 py-10 text-center text-sm">Empty.</div>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="vf-table text-sm">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Rail</th>
                  <th>Flow</th>
                  <th className="text-right">Amount</th>
                  <th>Updated</th>
                  <th className="text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {recentGraphs.slice(0, 24).map((g) => (
                  <tr key={g.transaction_id}>
                    <td className="font-mono text-xs">{g.transaction_id}</td>
                    <td className="text-slate-700">{formatPaymentRail(g.payment_rail)}</td>
                    <td className="text-slate-600">{flowLabel(g.flow_type)}</td>
                    <td className="text-right tabular-nums font-medium text-slate-900">
                      {merchantPrincipal(g) != null ? merchantPrincipal(g)?.toFixed(2) : "—"}
                    </td>
                    <td className="whitespace-nowrap text-slate-500">
                      {new Date(g.updated_at).toLocaleString()}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="vf-button vf-button-ghost py-1 text-xs"
                        onClick={() => onOpenTransaction(g.transaction_id)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ModulePageFrame>
  );
}
