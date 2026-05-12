import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import AccessPage from "./pages/AccessPage";
import DashboardPage from "./pages/DashboardPage";
import ReconciliationPage from "./pages/modules/ReconciliationPage";
import ReportsPage from "./pages/modules/ReportsPage";
import ReversalsPage from "./pages/modules/ReversalsPage";
import PortalPage from "./pages/modules/PortalPage";
import SettlementPage from "./pages/modules/SettlementPage";
import SettingsPage from "./pages/modules/SettingsPage";
import TransactionDetailOutlet from "./pages/TransactionDetailOutlet";
import MismatchChart from "./components/MismatchChart";
import SourceHealthBar from "./components/SourceHealthBar";
import OpsMetricsCharts from "./components/OpsMetricsCharts";
import { usePersona } from "./context/PersonaContext";
import { VeriFlowRuntimeProvider } from "./context/VeriFlowRuntimeContext";
import { isMismatchIncident, MISMATCH_TYPES } from "./lib/incidents";
import { MODULE_PATHS, sidebarGeneralItems, sidebarSettingsItems } from "./nav/routesConfig";
import { resolveApiBaseUrl, resolveWebSocketUrl } from "./lib/veriflowEndpoints";
import { connectWebSocket } from "./lib/ws";
import { graphSemanticFingerprint } from "./lib/graphFingerprint";
import {
  GraphSnapshot,
  Incident,
  MetricSeries,
  MetricsSnapshot,
  WsMessage,
} from "./types";

const MAX_GRAPHS = 60;
const DETAIL_GRAPH_MIN_INTERVAL_MS = 3500;
const INCIDENT_TTL_MS = 15 * 60 * 1000;
const DEMO_BOOST_WINDOW_MS = 120000;

const isGraphComplete = (snapshot: GraphSnapshot | null): boolean => {
  if (!snapshot || snapshot.nodes.length === 0) {
    return false;
  }
  return snapshot.nodes.every((node) => node.status !== "unknown");
};

const App = () => {
  const apiUrl = useMemo(() => resolveApiBaseUrl(), []);
  const wsUrl = useMemo(() => resolveWebSocketUrl(), []);

  const [graphs, setGraphs] = useState<Record<string, GraphSnapshot>>({});
  const [activeTx, setActiveTx] = useState<string | null>(null);
  const [displayGraph, setDisplayGraph] = useState<GraphSnapshot | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [escalationByIncident, setEscalationByIncident] = useState<
    Record<string, { deadline_ms: number; transaction_id: string; severity?: string }>
  >({});
  const [sourceHealth, setSourceHealth] = useState<
    Record<string, { status: string; age_ms?: number | null }>
  >({});
  const [replayMode, setReplayMode] = useState(false);
  const [resolutionLog, setResolutionLog] = useState<
    { transaction_id: string; kind: "mock_correction" | "bank_autocorrect"; summary: string; at_ms: number }[]
  >([]);
  const replayTimer = useRef<number | null>(null);
  const replayBuffer = useRef<Record<string, GraphSnapshot[]>>({});
  const replayModeRef = useRef(false);
  const activeTxRef = useRef<string | null>(null);
  const lastGraphUpdateRef = useRef(0);
  const completedTxRef = useRef<Set<string>>(new Set());
  const displayFingerprintRef = useRef("");
  const incidentsRef = useRef<Incident[]>([]);
  const demoBoostUntilRef = useRef(0);
  const isDetailRef = useRef(false);
  const pinnedTxRef = useRef<Set<string>>(new Set());
  const graphsRef = useRef<Record<string, GraphSnapshot>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const { persona, merchantDisplayName, bridgeDisplayName } = usePersona();
  const isDetailRoute = location.pathname.startsWith("/tx/");
  isDetailRef.current = isDetailRoute;
  graphsRef.current = graphs;

  useEffect(() => {
    replayModeRef.current = replayMode;
  }, [replayMode]);

  useEffect(() => {
    activeTxRef.current = activeTx;
  }, [activeTx]);

  useEffect(() => {
    incidentsRef.current = incidents;
  }, [incidents]);

  useEffect(() => {
    displayFingerprintRef.current = graphSemanticFingerprint(displayGraph);
  }, [displayGraph]);

  useEffect(() => {
    const nextPinned = new Set<string>(
      incidents.filter(isMismatchIncident).map((incident) => incident.transaction_id)
    );
    if (activeTx) {
      nextPinned.add(activeTx);
    }
    pinnedTxRef.current = nextPinned;
  }, [incidents, activeTx]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIncidents((prev) => pruneIncidents(prev, INCIDENT_TTL_MS));
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = connectWebSocket(wsUrl, (message: WsMessage) => {
      if (message.type === "bootstrap") {
        const bootstrapPayload = message.payload as {
          graphs: GraphSnapshot[];
          incidents: Incident[];
          metrics: MetricsSnapshot;
          escalations?: {
            incident_id: string;
            transaction_id: string;
            deadline_ms: number;
            severity?: string;
          }[];
          source_health?: {
            nodes: Record<string, { status: string; age_ms?: number | null }>;
          };
        };
        const bootstrapGraphs = bootstrapPayload.graphs;
        const bootstrapIncidents = bootstrapPayload.incidents;
        const bootstrapMetrics = bootstrapPayload.metrics;

        const initialGraphs = Object.fromEntries(
          bootstrapGraphs.map((graph) => [graph.transaction_id, graph])
        );
        setGraphs(trimGraphs(initialGraphs, MAX_GRAPHS, pinnedTxRef.current));
        setIncidents(pruneIncidents(bootstrapIncidents, INCIDENT_TTL_MS));
        setMetrics(bootstrapMetrics);
        if (bootstrapPayload.source_health?.nodes) {
          setSourceHealth(bootstrapPayload.source_health.nodes);
        }
        if (bootstrapPayload.escalations?.length) {
          setEscalationByIncident((prev) => {
            const next = { ...prev };
            for (const e of bootstrapPayload.escalations!) {
              next[e.incident_id] = {
                deadline_ms: e.deadline_ms,
                transaction_id: e.transaction_id,
                severity: e.severity,
              };
            }
            return next;
          });
        }
        const mismatchIds = Array.from(
          new Set(
            bootstrapIncidents
              .filter(isMismatchIncident)
              .map((incident) => incident.transaction_id)
          )
        );
        if (!activeTxRef.current && mismatchIds.length > 0 && !isDetailRef.current) {
          setActiveTx(mismatchIds[0]);
        }
        return;
      }

      if (message.type === "graph") {
        const snapshot = message.payload as GraphSnapshot;
        const pinnedIds = new Set<string>(pinnedTxRef.current);
        if (activeTxRef.current) {
          pinnedIds.add(activeTxRef.current);
        }
        setGraphs((prev) =>
          trimGraphs({ ...prev, [snapshot.transaction_id]: snapshot }, MAX_GRAPHS, pinnedIds)
        );

        const buffer = replayBuffer.current[snapshot.transaction_id] || [];
        buffer.push(snapshot);
        if (buffer.length > 40) {
          buffer.shift();
        }
        replayBuffer.current[snapshot.transaction_id] = buffer;

        const isActive = snapshot.transaction_id === activeTxRef.current;
        const isComplete = isGraphComplete(snapshot);
        if (isComplete) {
          completedTxRef.current.add(snapshot.transaction_id);
        }

        if (!replayModeRef.current && isActive && isDetailRef.current) {
          const now = Date.now();
          const fingerprint = graphSemanticFingerprint(snapshot);
          if (fingerprint === displayFingerprintRef.current) {
            return;
          }
          if (now - lastGraphUpdateRef.current < DETAIL_GRAPH_MIN_INTERVAL_MS) {
            return;
          }
          setDisplayGraph(snapshot);
          lastGraphUpdateRef.current = now;
        }
        return;
      }

      if (message.type === "incident") {
        const incident = message.payload as Incident;
        setIncidents((prev) => addIncident(prev, incident, INCIDENT_TTL_MS));
        if (isMismatchIncident(incident)) {
          if (!activeTxRef.current && !isDetailRef.current) {
            setActiveTx(incident.transaction_id);
          }
        }
        if (incident.type === "bank_ledger_autocorrect") {
          setResolutionLog((prev) =>
            [
              {
                transaction_id: incident.transaction_id,
                kind: "bank_autocorrect",
                summary: incident.message,
                at_ms: Date.now(),
              },
              ...prev,
            ].slice(0, 80)
          );
        }
        return;
      }

      if (message.type === "metrics") {
        const snapshot = message.payload as MetricsSnapshot;
        setMetrics(snapshot);
        setSeries((prev) => {
          const next: MetricSeries[] = [
            ...prev,
            {
              ts: snapshot.updated_at,
              tx_per_sec: snapshot.tx_per_sec,
              mismatch_rate: snapshot.mismatch_rate,
              reconciliation_latency_ms: snapshot.reconciliation_latency_ms,
              active_incidents: snapshot.active_incidents,
              events_in_window: snapshot.events_in_window,
            },
          ];
          return next.slice(-60);
        });
        return;
      }

      if (message.type === "escalation_pending") {
        const p = message.payload as {
          incident_id: string;
          transaction_id: string;
          deadline_ms: number;
          severity?: string;
        };
        setEscalationByIncident((prev) => ({ ...prev, [p.incident_id]: p }));
        return;
      }

      if (message.type === "escalation_due") {
        const p = message.payload as { incident_id: string };
        setEscalationByIncident((prev) => {
          const next = { ...prev };
          delete next[p.incident_id];
          return next;
        });
        return;
      }

      if (message.type === "source_health") {
        const p = message.payload as {
          nodes: Record<string, { status: string; age_ms?: number | null }>;
        };
        setSourceHealth(p.nodes);
        return;
      }

      if (message.type === "correction") {
        const entry = message.payload as {
          transaction_id?: string;
          node_id?: string;
          delta_amount?: number;
          auto_eligible?: boolean;
          recorded_at_ms?: number;
        };
        const tid = entry.transaction_id?.trim();
        if (tid) {
          const summary = `Mock correction: Δ ${entry.delta_amount ?? "?"} @ ${entry.node_id ?? "?"}${
            entry.auto_eligible ? " (auto band)" : ""
          }`;
          setResolutionLog((prev) =>
            [
              {
                transaction_id: tid,
                kind: "mock_correction",
                summary,
                at_ms: entry.recorded_at_ms ?? Date.now(),
              },
              ...prev,
            ].slice(0, 80)
          );
        }
        return;
      }
    });

    return () => socket.close();
  }, [wsUrl]);

  useEffect(() => {
    if (replayMode || !isDetailRoute) {
      return;
    }
    if (activeTx && graphs[activeTx]) {
      setDisplayGraph(graphs[activeTx]);
      lastGraphUpdateRef.current = Date.now();
    }
  }, [activeTx, replayMode, isDetailRoute]);

  const sortedGraphs = useMemo<GraphSnapshot[]>(() => {
    return (Object.values(graphs) as GraphSnapshot[]).sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at)
    );
  }, [graphs]);

  const mismatchIncidents = useMemo(() => {
    return incidents.filter(isMismatchIncident);
  }, [incidents]);

  const mismatchByTx = useMemo(() => {
    const map: Record<string, Incident | undefined> = {};
    for (const incident of mismatchIncidents) {
      if (!map[incident.transaction_id]) {
        map[incident.transaction_id] = incident;
      }
    }
    return map;
  }, [mismatchIncidents]);

  const primaryIncidentByTx = useMemo(() => {
    const map: Record<string, Incident | undefined> = {};
    for (const incident of incidents) {
      if (!map[incident.transaction_id]) {
        map[incident.transaction_id] = incident;
      }
    }
    return map;
  }, [incidents]);

  const incompleteGraphs = useMemo(() => {
    return sortedGraphs.filter((g) => !isGraphComplete(g));
  }, [sortedGraphs]);

  const mismatchGraphs = useMemo(() => {
    return sortedGraphs.filter((graph) => mismatchByTx[graph.transaction_id]);
  }, [sortedGraphs, mismatchByTx]);

  const visibleMismatchIncidents = mismatchIncidents;

  const mismatchMinuteBuckets = useMemo(() => {
    const map = new Map<number, number>();
    for (const inc of incidents) {
      if (!MISMATCH_TYPES.has(inc.type)) {
        continue;
      }
      const t = Date.parse(inc.timestamp);
      if (!Number.isFinite(t)) {
        continue;
      }
      const slot = Math.floor(t / 60000);
      map.set(slot, (map.get(slot) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-12)
      .map(([slot, count]) => ({
        minute: new Date(slot * 60000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        count,
      }));
  }, [incidents]);

  const bannerIncident = visibleMismatchIncidents[0];
  const bannerSla = bannerIncident
    ? escalationByIncident[bannerIncident.incident_id]
    : undefined;

  const deskRedirect =
    persona === "bridge" ? MODULE_PATHS.portalCrypto : MODULE_PATHS.portalMerchant;

  const handleImmediateEscalate = async () => {
    if (!bannerIncident) {
      return;
    }
    try {
      await fetch(`${apiUrl}/escalations/immediate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: bannerIncident.incident_id,
          transaction_id: bannerIncident.transaction_id,
        }),
      });
    } catch {
      // ignore network errors in demo
    }
  };

  const handleBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const stopReplay = useCallback(() => {
    if (replayTimer.current) {
      window.clearInterval(replayTimer.current);
    }
    replayTimer.current = null;
    setReplayMode(false);
    const txId = activeTxRef.current;
    if (txId && isDetailRef.current) {
      const latest = graphsRef.current[txId];
      if (latest) {
        setDisplayGraph(latest);
      }
    }
  }, []);

  const startReplay = useCallback(() => {
    const txId = activeTxRef.current;
    if (!txId) {
      return;
    }
    const buffer = replayBuffer.current[txId] || [];
    if (buffer.length === 0) {
      return;
    }
    setReplayMode(true);
    let index = 0;
    replayTimer.current = window.setInterval(() => {
      setDisplayGraph(buffer[index]);
      index += 1;
      if (index >= buffer.length) {
        stopReplay();
      }
    }, 350);
  }, [stopReplay]);

  const handleSelect = useCallback(
    (id: string) => {
      setActiveTx(id);
      if (!replayModeRef.current && graphsRef.current[id]) {
        setDisplayGraph(graphsRef.current[id]!);
      }
      navigate(`/tx/${id}`);
    },
    [navigate]
  );

  const loadHistory = useCallback(async (txId: string) => {
    if (!txId) {
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/tx/${txId}/history`);
      if (!response.ok) {
        return;
      }
      const data = await response.json().catch(() => null);
      const history = Array.isArray(data?.history) ? (data.history as GraphSnapshot[]) : [];
      if (history.length === 0) {
        return;
      }
      replayBuffer.current[txId] = history;
      const latest = history[history.length - 1];
      setDisplayGraph((prev) =>
        prev && prev.transaction_id === txId ? prev : latest
      );
      lastGraphUpdateRef.current = Date.now();
      if (isGraphComplete(latest)) {
        completedTxRef.current.add(txId);
      }
      const pinnedIds = new Set<string>(pinnedTxRef.current);
      pinnedIds.add(txId);
      setGraphs((prev) =>
        trimGraphs({ ...prev, [txId]: latest }, MAX_GRAPHS, pinnedIds)
      );
    } catch (err) {
      // Ignore history fetch failures.
    }
  }, [apiUrl]);

  const mismatchAnalysisIncidents = useMemo(() => {
    return incidents
      .filter((i: Incident) => isMismatchIncident(i))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [incidents]);

  const recentGraphs = useMemo((): GraphSnapshot[] => {
    return Object.values(graphs)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 24);
  }, [graphs]);

  const moduleRuntimeValue = useMemo(
    () => ({
      apiUrl,
      metrics,
      series,
      mismatchMinuteBuckets,
      mismatchIncidents: mismatchAnalysisIncidents,
      recentGraphs,
      sourceHealth,
      onOpenTransaction: handleSelect,
    }),
    [
      apiUrl,
      metrics,
      series,
      mismatchMinuteBuckets,
      mismatchAnalysisIncidents,
      recentGraphs,
      sourceHealth,
      handleSelect,
    ]
  );

  return (
    <div className="vf-shell">
      <aside className="vf-sidebar">
        <div className="vf-brand">
          <div className="vf-logo">V</div>
          <div>
            <div className="vf-brand-title">VeriFlow</div>
            <div className="vf-brand-sub">FX / crypto rails</div>
          </div>
        </div>
        <div className="vf-nav-section">
          <div className="vf-nav-title">General</div>
          <nav className="vf-nav">
            {sidebarGeneralItems(persona).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }: { isActive: boolean }) =>
                  `vf-nav-item ${isActive ? "vf-nav-item-active" : ""}`
                }
              >
                <span className="vf-nav-dot" aria-hidden="true" />
                <span>{item.label}</span>
                {item.badge ? <span className="vf-nav-badge">{item.badge}</span> : null}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="vf-nav-section">
          <div className="vf-nav-title">Settings</div>
          <nav className="vf-nav">
            {sidebarSettingsItems(persona).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }: { isActive: boolean }) =>
                  `vf-nav-item ${isActive ? "vf-nav-item-active" : ""}`
                }
              >
                <span className="vf-nav-dot" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="vf-sidebar-footer">
          <div className="vf-user-chip">
            <div className="vf-user-avatar">A</div>
            <div>
              <div className="vf-user-name">
                {persona === "operator"
                  ? "Operator"
                  : persona === "merchant"
                    ? merchantDisplayName
                    : bridgeDisplayName}
              </div>
              <NavLink to={MODULE_PATHS.access} className="vf-user-email hover:underline">
                Account
              </NavLink>
            </div>
          </div>
        </div>
      </aside>
      <div className="vf-main">
        <header className="vf-topbar">
          <label className="vf-search" aria-label="Search transactions">
            <svg
              viewBox="0 0 24 24"
              role="img"
              aria-hidden="true"
              className="vf-icon"
            >
              <path
                d="M15.5 15.5L20 20M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            <input
              type="search"
              placeholder="Tx id"
            />
          </label>
          <div className="vf-topbar-actions">
            <div className="vf-topbar-meta">
              <div className="vf-topbar-label">Queue</div>
              <div className="vf-topbar-value">
                {mismatchGraphs.length > 0
                  ? `${mismatchGraphs.length} open`
                  : "Clear"}
              </div>
            </div>
            <button type="button" className="vf-icon-button" aria-label="Notifications">
              <svg viewBox="0 0 24 24" role="img" aria-hidden="true">
                <path
                  d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 19a2 2 0 0 0 4 0"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </header>
        <main className="vf-content">
          <VeriFlowRuntimeProvider value={moduleRuntimeValue}>
            <Routes>
            <Route
              path="/"
              element={
                persona === "merchant" ? (
                  <Navigate to={MODULE_PATHS.portalMerchant} replace />
                ) : persona === "bridge" ? (
                  <Navigate to={MODULE_PATHS.portalCrypto} replace />
                ) : (
                  <DashboardPage
                    graphs={mismatchGraphs}
                    allGraphs={sortedGraphs.slice(0, 48)}
                    incompleteGraphs={incompleteGraphs}
                    resolutionLog={resolutionLog}
                    activeId={activeTx}
                    incidentByTx={mismatchByTx}
                    primaryIncidentByTx={primaryIncidentByTx}
                    metrics={metrics}
                    series={series}
                    incidents={incidents.slice(0, 40)}
                    apiUrl={apiUrl}
                    onSelect={handleSelect}
                    onManualDemo={() => {
                      demoBoostUntilRef.current = Date.now() + DEMO_BOOST_WINDOW_MS;
                    }}
                    onDemoScenarioQueued={(id) => {
                      demoBoostUntilRef.current = Date.now() + DEMO_BOOST_WINDOW_MS;
                      handleSelect(id);
                    }}
                    bannerIncident={bannerIncident}
                    bannerSla={bannerSla}
                    onEscalateNow={handleImmediateEscalate}
                    mismatchMinuteBuckets={mismatchMinuteBuckets}
                    sourceHealth={sourceHealth}
                  />
                )
              }
            />
            <Route path={MODULE_PATHS.access} element={<AccessPage />} />
            <Route
              path="/tx/:id"
              element={
                <TransactionDetailOutlet
                  graphs={graphs}
                  displayGraph={displayGraph}
                  setActiveTx={setActiveTx}
                  setDisplayGraph={setDisplayGraph}
                  replayMode={replayMode}
                  replayBuffer={replayBuffer}
                  lastGraphUpdateRef={lastGraphUpdateRef}
                  apiUrl={apiUrl}
                  onReplay={startReplay}
                  onStop={stopReplay}
                  onBack={handleBack}
                  loadHistory={loadHistory}
                />
              }
            />
            <Route path={MODULE_PATHS.portalMerchant} element={<PortalPage role="merchant" />} />
            <Route path={MODULE_PATHS.portalCrypto} element={<PortalPage role="crypto" />} />
            <Route
              path={MODULE_PATHS.reversals}
              element={
                persona === "operator" ? (
                  <ReversalsPage />
                ) : (
                  <Navigate to={deskRedirect} replace />
                )
              }
            />
            <Route
              path={MODULE_PATHS.reconciliation}
              element={
                persona === "operator" ? (
                  <ReconciliationPage />
                ) : (
                  <Navigate to={deskRedirect} replace />
                )
              }
            />
            <Route
              path={MODULE_PATHS.settlement}
              element={
                persona === "operator" ? (
                  <SettlementPage />
                ) : (
                  <Navigate to={deskRedirect} replace />
                )
              }
            />
            <Route path={MODULE_PATHS.reports} element={<ReportsPage />} />
            <Route path={MODULE_PATHS.settings} element={<SettingsPage />} />
            <Route
              path="*"
              element={<Navigate to={persona === "operator" ? "/" : deskRedirect} replace />}
            />
          </Routes>
          </VeriFlowRuntimeProvider>
        </main>
      </div>
    </div>
  );
};

const trimGraphs = (
  source: Record<string, GraphSnapshot>,
  limit: number,
  pinnedIds: Set<string> = new Set()
): Record<string, GraphSnapshot> => {
  const entries = Object.values(source).sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );
  const trimmed: GraphSnapshot[] = [];
  for (const graph of entries) {
    if (trimmed.length < limit || pinnedIds.has(graph.transaction_id)) {
      trimmed.push(graph);
    }
  }
  return Object.fromEntries(trimmed.map((graph) => [graph.transaction_id, graph]));
};

const pruneIncidents = (items: Incident[], ttlMs: number): Incident[] => {
  const cutoff = Date.now() - ttlMs;
  const byId: Record<string, Incident> = {};
  for (const item of items) {
    const timestamp = Date.parse(item.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < cutoff) {
      continue;
    }
    byId[item.incident_id] = item;
  }
  return Object.values(byId).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
};

const addIncident = (items: Incident[], next: Incident, ttlMs: number): Incident[] => {
  return pruneIncidents([next, ...items], ttlMs);
};

export default App;
