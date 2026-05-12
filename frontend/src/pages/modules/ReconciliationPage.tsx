import { useMemo } from "react";
import { NavLink } from "react-router-dom";

import MetricsBar from "../../components/MetricsBar";
import MismatchChart from "../../components/MismatchChart";
import ModulePageFrame from "../../components/ModulePageFrame";
import OpsMetricsCharts from "../../components/OpsMetricsCharts";
import SourceHealthBar from "../../components/SourceHealthBar";
import { useVeriFlowRuntime } from "../../context/VeriFlowRuntimeContext";
import { flowLabel, incidentLabel } from "../../lib/humanize";
import { MODULE_PATHS } from "../../nav/routesConfig";
import type { GraphSnapshot, Incident } from "../../types";
import { formatPaymentRail } from "../../types";

const CRYPTO_PATH_NODES = ["merchant", "gateway", "crypto_exchange", "bank"] as const;

function isCryptoGraph(g: GraphSnapshot): boolean {
  return g.flow_type === "crypto" || g.payment_rail === "crypto_settlement";
}

function principalAmount(g: GraphSnapshot): number | undefined {
  const m = g.nodes.find((n) => n.id === "merchant");
  return typeof m?.amount === "number" ? m.amount : undefined;
}

export default function ReconciliationPage() {
  const {
    metrics,
    series,
    mismatchMinuteBuckets,
    mismatchIncidents,
    recentGraphs,
    sourceHealth,
    onOpenTransaction,
  } = useVeriFlowRuntime();

  const cryptoGraphs = useMemo((): GraphSnapshot[] => recentGraphs.filter(isCryptoGraph), [
    recentGraphs,
  ]);
  const cryptoTxIds = useMemo(
    () => new Set(cryptoGraphs.map((g: GraphSnapshot) => g.transaction_id)),
    [cryptoGraphs]
  );

  const cryptoIncidents = useMemo(
    () => mismatchIncidents.filter((i) => cryptoTxIds.has(i.transaction_id)),
    [mismatchIncidents, cryptoTxIds]
  );

  /** Bridge signals: payment in the crypto window or explicit exchange involvement. */
  const bridgeTouchingIncidents = useMemo(
    () =>
      mismatchIncidents.filter(
        (i) =>
          cryptoTxIds.has(i.transaction_id) || Boolean(i.affected_nodes?.includes("crypto_exchange"))
      ),
    [mismatchIncidents, cryptoTxIds]
  );

  const cryptoHealth = useMemo(() => {
    const next: Record<string, { status: string; age_ms?: number | null }> = {};
    for (const id of CRYPTO_PATH_NODES) {
      if (sourceHealth[id]) {
        next[id] = sourceHealth[id]!;
      }
    }
    return next;
  }, [sourceHealth]);

  const exchangeEvents = metrics?.node_events?.crypto_exchange ?? 0;
  const globalMismatchPct =
    metrics?.mismatch_rate != null
      ? (metrics.mismatch_rate <= 1 ? metrics.mismatch_rate * 100 : metrics.mismatch_rate).toFixed(1)
      : "—";

  const severityClass = (s: string) => {
    if (s === "critical" || s === "high") return "bg-rose-100 text-rose-800";
    if (s === "medium") return "bg-amber-100 text-amber-900";
    return "bg-slate-100 text-slate-700";
  };

  return (
    <ModulePageFrame
      eyebrow="Reconciliation"
      title="Crypto bridge and on-chain / off-chain"
      subtitle="Dedicated control loop: stablecoin, network fees, FX corridor, and final bank leg. Divergences here block liquidity release and bridge reporting."
      actions={
        <>
          <NavLink to="/" className="vf-button vf-button-primary">
            Dashboard
          </NavLink>
          <NavLink to={MODULE_PATHS.reports} className="vf-button vf-button-ghost">
            Reports
          </NavLink>
          <NavLink to={MODULE_PATHS.settlement} className="vf-button vf-button-ghost">
            Treasury
          </NavLink>
        </>
      }
    >
      <div className="relative overflow-hidden rounded-2xl border-2 border-violet-400/70 bg-gradient-to-br from-violet-950 via-violet-900 to-slate-900 p-6 text-white shadow-lg shadow-violet-900/40">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-teal-400/20 blur-3xl" aria-hidden />
        <div className="relative max-w-3xl space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-200">
            Critical priority
          </p>
          <h2 className="text-xl font-semibold leading-snug md:text-2xl">
            The crypto leg is not “just another rail”. It is peak risk: asset price, slippage,
            network gas, bridge wiring, and alignment with the bank.
          </h2>
          <p className="text-sm leading-relaxed text-violet-100/95">
            VeriFlow keeps a separate check matrix for{" "}
            <span className="font-semibold text-white">merchant → gateway → crypto_exchange → bank</span>
            : amounts, fees, bank-vs-gateway policy, delays, and missing hops. Everything below is live
            from the same stream as the operator console.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="vf-card border-violet-200/60 bg-violet-50/50 p-4">
          <div className="text-xs font-medium text-violet-900/80">Crypto payment signals</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-violet-950">
            {cryptoIncidents.length}
          </div>
          <div className="mt-0.5 text-[11px] text-violet-800/80">in the current mismatch queue</div>
        </div>
        <div className="vf-card p-4">
          <div className="text-xs font-medium text-slate-600">Bridge graphs in window</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {cryptoGraphs.length}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">from latest flows on the desk</div>
        </div>
        <div className="vf-card p-4">
          <div className="text-xs font-medium text-slate-600">crypto_exchange node events</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{exchangeEvents}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">in the current metrics window</div>
        </div>
        <div className="vf-card p-4">
          <div className="text-xs font-medium text-slate-600">Mismatch (all rails)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {globalMismatchPct}
            {globalMismatchPct !== "—" ? "%" : ""}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">share for load context</div>
        </div>
      </div>

      <MetricsBar metrics={metrics} series={series} />

      <div className="grid gap-6 lg:grid-cols-2">
        <MismatchChart data={mismatchMinuteBuckets} />
        <div className="vf-card flex flex-col p-4">
          <div className="mb-2 text-sm font-semibold text-slate-900">Bridge chain health</div>
          <p className="vf-subtle mb-3 text-xs">
            Simulator heartbeats on key crypto-path nodes. A break here is a hard stop for reconciliation
            and treasury.
          </p>
          {Object.keys(cryptoHealth).length === 0 ? (
            <p className="vf-subtle text-sm">Waiting for node data…</p>
          ) : (
            <SourceHealthBar nodes={cryptoHealth} />
          )}
        </div>
      </div>

      <OpsMetricsCharts metrics={metrics} series={series} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="vf-card overflow-hidden p-0">
          <div className="border-b border-black/5 bg-violet-50/80 px-4 py-3">
            <div className="text-sm font-semibold text-violet-950">Queue: crypto and exchange</div>
            <div className="vf-subtle text-xs">
              Signals involving <span className="font-mono">crypto_exchange</span> or tied to a bridge
              payment
            </div>
          </div>
          <div className="max-h-[380px] space-y-2 overflow-auto p-3">
            {bridgeTouchingIncidents.length === 0 ? (
              <p className="vf-subtle px-1 py-6 text-center text-sm">No open bridge signals.</p>
            ) : (
              bridgeTouchingIncidents.slice(0, 20).map((i: Incident) => (
                <button
                  key={i.incident_id}
                  type="button"
                  onClick={() => onOpenTransaction(i.transaction_id)}
                  className="w-full rounded-xl border border-violet-100 bg-white/90 p-3 text-left shadow-sm transition hover:border-violet-300 hover:shadow"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`vf-pill text-xs ${severityClass(i.severity)}`}>
                      {incidentLabel(i.type)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(i.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-slate-800">{i.message}</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">{i.transaction_id}</p>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="vf-card overflow-hidden p-0">
          <div className="border-b border-black/5 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Latest bridge payments</div>
            <div className="vf-subtle text-xs">Live list from the reconciliation stream</div>
          </div>
          <ul className="max-h-[380px] divide-y divide-slate-100 overflow-auto">
            {cryptoGraphs.slice(0, 16).map((g) => (
              <li key={g.transaction_id}>
                <button
                  type="button"
                  onClick={() => onOpenTransaction(g.transaction_id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-violet-50/60"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-slate-500">{g.transaction_id}</div>
                    <div className="truncate text-sm text-slate-800">
                      {formatPaymentRail(g.payment_rail)} · {flowLabel(g.flow_type)}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">{g.path.join(" → ")}</div>
                  </div>
                  <div className="shrink-0 text-right text-sm font-medium tabular-nums text-slate-900">
                    {principalAmount(g) != null ? `${principalAmount(g)?.toFixed(2)}` : "—"}
                  </div>
                </button>
              </li>
            ))}
            {cryptoGraphs.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-slate-500">
                No bridge graphs in the window yet — run a crypto-rail scenario or wait for traffic.
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="vf-card p-5">
        <h2 className="text-sm font-semibold text-slate-900">What we reconcile on crypto</h2>
        <ul className="vf-subtle mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <li className="rounded-lg border border-black/5 bg-white/80 px-3 py-2">
            <span className="font-medium text-slate-800">Merchant ↔ gateway</span> — amounts and fees at
            the bridge entry.
          </li>
          <li className="rounded-lg border border-black/5 bg-white/80 px-3 py-2">
            <span className="font-medium text-slate-800">Gateway ↔ crypto_exchange</span> — network and
            bridge fees, FX leg.
          </li>
          <li className="rounded-lg border border-black/5 bg-white/80 px-3 py-2">
            <span className="font-medium text-slate-800">Crypto ↔ bank</span> — final match to the bank
            leg and fee policy.
          </li>
          <li className="rounded-lg border border-black/5 bg-white/80 px-3 py-2">
            <span className="font-medium text-slate-800">Flow reliability</span> — duplicates, delays,
            missing hops, SLA escalations.
          </li>
        </ul>
        <p className="vf-subtle mt-4 text-xs">
          This is not a replacement for accounting ledgers: payment graph plus real-time signals. Rules
          extend at the engine and Kafka event stream level.
        </p>
      </div>
    </ModulePageFrame>
  );
}
