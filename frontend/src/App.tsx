import { useEffect, useMemo, useRef, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import DashboardPage from "./pages/DashboardPage";
import TransactionDetailPage from "./pages/TransactionDetailPage";
import { connectWebSocket } from "./lib/ws";
import {
  GraphSnapshot,
  Incident,
  MetricSeries,
  MetricsSnapshot,
  WsMessage,
} from "./types";

const wsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:8001/ws";
const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8001";
const MAX_GRAPHS = 60;
const DETAIL_RENDER_INTERVAL_MS = 15000;
const INCIDENT_TTL_MS = 15 * 60 * 1000;
const MISMATCH_DISPLAY_INTERVAL_MS = 150000;
const DEMO_BOOST_WINDOW_MS = 120000;
const MISMATCH_TYPES = new Set<string>([
  "amount_mismatch",
  "fee_mismatch",
  "fx_mismatch",
]);

const isGraphComplete = (snapshot: GraphSnapshot | null): boolean => {
  if (!snapshot || snapshot.nodes.length === 0) {
    return false;
  }
  return snapshot.nodes.every((node) => node.status !== "unknown");
};

const isMismatchIncident = (incident: Incident): boolean => {
  return MISMATCH_TYPES.has(incident.type);
};

const graphFingerprint = (snapshot: GraphSnapshot | null): string => {
  if (!snapshot) {
    return "";
  }
  const nodeKey = snapshot.nodes
    .map((node) =>
      `${node.id}:${node.status}:${node.amount ?? ""}:${node.fee ?? ""}:${node.currency ?? ""}`
    )
    .join("|");
  const edgeKey = snapshot.edges
    .map((edge) => `${edge.id}:${edge.status}:${edge.animated ? "1" : "0"}`)
    .join("|");
  return `${snapshot.transaction_id}::${nodeKey}::${edgeKey}`;
};

const App = () => {
  const [graphs, setGraphs] = useState<Record<string, GraphSnapshot>>({});
  const [activeTx, setActiveTx] = useState<string | null>(null);
  const [displayGraph, setDisplayGraph] = useState<GraphSnapshot | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [replayMode, setReplayMode] = useState(false);
  const [visibleMismatchIds, setVisibleMismatchIds] = useState<string[]>([]);
  const replayTimer = useRef<number | null>(null);
  const replayBuffer = useRef<Record<string, GraphSnapshot[]>>({});
  const replayModeRef = useRef(false);
  const activeTxRef = useRef<string | null>(null);
  const lastGraphUpdateRef = useRef(0);
  const completedTxRef = useRef<Set<string>>(new Set());
  const displayFingerprintRef = useRef("");
  const visibleMismatchRef = useRef<string[]>([]);
  const pendingMismatchRef = useRef<string[]>([]);
  const pendingMismatchSetRef = useRef<Set<string>>(new Set());
  const demoBoostUntilRef = useRef(0);
  const isDetailRef = useRef(false);
  const pinnedTxRef = useRef<Set<string>>(new Set());
  const navigate = useNavigate();
  const location = useLocation();
  const isDetailRoute = location.pathname.startsWith("/tx/");
  isDetailRef.current = isDetailRoute;

  useEffect(() => {
    replayModeRef.current = replayMode;
  }, [replayMode]);

  useEffect(() => {
    activeTxRef.current = activeTx;
  }, [activeTx]);

  useEffect(() => {
    visibleMismatchRef.current = visibleMismatchIds;
  }, [visibleMismatchIds]);

  useEffect(() => {
    displayFingerprintRef.current = graphFingerprint(displayGraph);
  }, [displayGraph]);

  const addVisibleMismatch = (txId: string) => {
    setVisibleMismatchIds((prev) => {
      if (prev.includes(txId)) {
        return prev;
      }
      return [txId, ...prev].slice(0, MAX_GRAPHS);
    });
  };

  const queueMismatchTx = (txId: string, immediate: boolean) => {
    if (visibleMismatchRef.current.includes(txId)) {
      return;
    }
    if (immediate) {
      addVisibleMismatch(txId);
      return;
    }
    if (!pendingMismatchSetRef.current.has(txId)) {
      pendingMismatchRef.current.push(txId);
      pendingMismatchSetRef.current.add(txId);
    }
  };

  const flushMismatchQueue = () => {
    const pending = pendingMismatchRef.current.splice(0, pendingMismatchRef.current.length);
    if (pending.length === 0) {
      return;
    }
    pendingMismatchSetRef.current.clear();
    setVisibleMismatchIds((prev) => {
      const seen = new Set(prev);
      const next = [...prev];
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const txId = pending[index];
        if (!seen.has(txId)) {
          next.unshift(txId);
          seen.add(txId);
        }
      }
      return next.slice(0, MAX_GRAPHS);
    });
  };

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
    const timer = window.setInterval(() => {
      if (Date.now() < demoBoostUntilRef.current) {
        return;
      }
      const nextId = pendingMismatchRef.current.shift();
      if (!nextId) {
        return;
      }
      pendingMismatchSetRef.current.delete(nextId);
      addVisibleMismatch(nextId);
    }, MISMATCH_DISPLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = connectWebSocket(wsUrl, (message: WsMessage) => {
      if (message.type === "bootstrap") {
        const bootstrapGraphs = message.payload.graphs as GraphSnapshot[];
        const bootstrapIncidents = message.payload.incidents as Incident[];
        const bootstrapMetrics = message.payload.metrics as MetricsSnapshot;

        const initialGraphs = Object.fromEntries(
          bootstrapGraphs.map((graph) => [graph.transaction_id, graph])
        );
        setGraphs(trimGraphs(initialGraphs, MAX_GRAPHS, pinnedTxRef.current));
        setIncidents(pruneIncidents(bootstrapIncidents, INCIDENT_TTL_MS));
        setMetrics(bootstrapMetrics);
        const mismatchIds = Array.from(
          new Set(
            bootstrapIncidents
              .filter(isMismatchIncident)
              .map((incident) => incident.transaction_id)
          )
        );
        setVisibleMismatchIds(mismatchIds.slice(0, MAX_GRAPHS));
        pendingMismatchRef.current = [];
        pendingMismatchSetRef.current.clear();
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
          const fingerprint = graphFingerprint(snapshot);
          if (fingerprint === displayFingerprintRef.current) {
            return;
          }
          if (isComplete) {
            setDisplayGraph(snapshot);
            lastGraphUpdateRef.current = now;
            return;
          }
          if (completedTxRef.current.has(snapshot.transaction_id)) {
            return;
          }
          if (now - lastGraphUpdateRef.current >= DETAIL_RENDER_INTERVAL_MS) {
            setDisplayGraph(snapshot);
            lastGraphUpdateRef.current = now;
          }
        }
        return;
      }

      if (message.type === "incident") {
        const incident = message.payload as Incident;
        setIncidents((prev) => addIncident(prev, incident, INCIDENT_TTL_MS));
        if (isMismatchIncident(incident)) {
          const immediate = Date.now() < demoBoostUntilRef.current;
          queueMismatchTx(incident.transaction_id, immediate);
          if (!activeTxRef.current && !isDetailRef.current) {
            setActiveTx(incident.transaction_id);
          }
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
            },
          ];
          return next.slice(-30);
        });
      }
    });

    return () => socket.close();
  }, []);

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

  const visibleMismatchSet = useMemo(() => {
    return new Set(visibleMismatchIds);
  }, [visibleMismatchIds]);

  const mismatchGraphs = useMemo(() => {
    return sortedGraphs.filter(
      (graph) =>
        mismatchByTx[graph.transaction_id] && visibleMismatchSet.has(graph.transaction_id)
    );
  }, [sortedGraphs, mismatchByTx, visibleMismatchSet]);

  const visibleMismatchIncidents = useMemo(() => {
    return mismatchIncidents.filter((incident) =>
      visibleMismatchSet.has(incident.transaction_id)
    );
  }, [mismatchIncidents, visibleMismatchSet]);


  const startReplay = () => {
    const txId = activeTxRef.current ?? activeTx;
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
  };

  const stopReplay = () => {
    if (replayTimer.current) {
      window.clearInterval(replayTimer.current);
    }
    replayTimer.current = null;
    setReplayMode(false);
    if (activeTx && graphs[activeTx] && isDetailRoute) {
      setDisplayGraph(graphs[activeTx]);
    }
  };

  const handleSelect = (id: string) => {
    setActiveTx(id);
    if (!replayMode && graphs[id]) {
      setDisplayGraph(graphs[id]);
    }
    navigate(`/tx/${id}`);
  };

  const handleBack = () => {
    navigate("/");
  };

  const loadHistory = async (txId: string) => {
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
  };

  const DetailRoute = () => {
    const { id } = useParams();
    const txId = id ?? "";

    useEffect(() => {
      if (!id) {
        navigate("/");
        return;
      }
      setActiveTx(id);
      setDisplayGraph(graphs[id] ?? null);
      lastGraphUpdateRef.current = 0;
      loadHistory(id);
    }, [id, navigate]);

    const bufferSize = txId ? (replayBuffer.current[txId]?.length ?? 0) : 0;
    const currentGraph =
      displayGraph && displayGraph.transaction_id === txId
        ? displayGraph
        : graphs[txId] ?? null;

    return (
      <TransactionDetailPage
        txId={txId}
        graph={currentGraph}
        replayMode={replayMode}
        bufferSize={bufferSize}
        onReplay={startReplay}
        onStop={stopReplay}
        onBack={handleBack}
      />
    );
  };

  type NavItem = { label: string; to?: string; badge?: string };
  type SettingsItem = { label: string };

  const navItems: NavItem[] = [
    { label: "Dashboard", to: "/" },
    { label: "Payment Reversal Manager" },
    { label: "Reconciliation System", badge: "AI" },
    { label: "Fraud & Risk Monitoring" },
    { label: "Reports & Analytics" },
  ];

  const settingsItems: SettingsItem[] = [
    { label: "System Settings" },
    { label: "Help & Support" },
    { label: "System Status" },
  ];

  return (
    <div className="vf-shell">
      <aside className="vf-sidebar">
        <div className="vf-brand">
          <div className="vf-logo">V</div>
          <div>
            <div className="vf-brand-title">VeriFlow</div>
            <div className="vf-brand-sub">Workspace</div>
          </div>
        </div>
        <div className="vf-nav-section">
          <div className="vf-nav-title">General</div>
          <nav className="vf-nav">
            {navItems.map((item) =>
              item.to ? (
                <NavLink
                  key={item.label}
                  to={item.to}
                  end
                  className={({ isActive }: { isActive: boolean }) =>
                    `vf-nav-item ${isActive ? "vf-nav-item-active" : ""}`
                  }
                >
                  <span className="vf-nav-dot" aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.badge ? <span className="vf-nav-badge">{item.badge}</span> : null}
                </NavLink>
              ) : (
                <div key={item.label} className="vf-nav-item vf-nav-item-disabled">
                  <span className="vf-nav-dot" aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.badge ? <span className="vf-nav-badge">{item.badge}</span> : null}
                </div>
              )
            )}
          </nav>
        </div>
        <div className="vf-nav-section">
          <div className="vf-nav-title">Settings</div>
          <nav className="vf-nav">
            {settingsItems.map((item) => (
              <div key={item.label} className="vf-nav-item vf-nav-item-disabled">
                <span className="vf-nav-dot" aria-hidden="true" />
                <span>{item.label}</span>
              </div>
            ))}
          </nav>
        </div>
        <div className="vf-sidebar-footer">
          <div className="vf-user-chip">
            <div className="vf-user-avatar">A</div>
            <div>
              <div className="vf-user-name">Admin</div>
              <div className="vf-user-email">admin@veriflow.com</div>
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
              placeholder="Find transactions by ID, customer, or amount"
            />
          </label>
          <div className="vf-topbar-actions">
            <div className="vf-topbar-meta">
              <div className="vf-topbar-label">Mismatch queue</div>
              <div className="vf-topbar-value">
                {mismatchGraphs.length > 0
                  ? `${mismatchGraphs.length} open`
                  : "No mismatches"}
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
          <Routes>
            <Route
              path="/"
              element={
                <DashboardPage
                  graphs={mismatchGraphs}
                  activeId={activeTx}
                  incidentByTx={mismatchByTx}
                  metrics={metrics}
                  series={series}
                  incidents={visibleMismatchIncidents}
                  apiUrl={apiUrl}
                  onSelect={handleSelect}
                  onManualDemo={() => {
                    demoBoostUntilRef.current = Date.now() + DEMO_BOOST_WINDOW_MS;
                    flushMismatchQueue();
                  }}
                />
              }
            />
            <Route path="/tx/:id" element={<DetailRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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
