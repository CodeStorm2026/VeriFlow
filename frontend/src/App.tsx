import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";

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
const GRAPH_RENDER_INTERVAL_MS = 250;
const INCIDENT_TTL_MS = 15 * 60 * 1000;

const App = () => {
  const [graphs, setGraphs] = useState<Record<string, GraphSnapshot>>({});
  const [activeTx, setActiveTx] = useState<string | null>(null);
  const [displayGraph, setDisplayGraph] = useState<GraphSnapshot | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [replayMode, setReplayMode] = useState(false);
  const replayTimer = useRef<number | null>(null);
  const replayBuffer = useRef<Record<string, GraphSnapshot[]>>({});
  const replayModeRef = useRef(false);
  const activeTxRef = useRef<string | null>(null);
  const lastGraphUpdateRef = useRef(0);
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
    const nextPinned = new Set(incidents.map((incident) => incident.transaction_id));
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
        const bootstrapGraphs = message.payload.graphs as GraphSnapshot[];
        const bootstrapIncidents = message.payload.incidents as Incident[];
        const bootstrapMetrics = message.payload.metrics as MetricsSnapshot;

        const initialGraphs = Object.fromEntries(
          bootstrapGraphs.map((graph) => [graph.transaction_id, graph])
        );
        setGraphs(trimGraphs(initialGraphs, MAX_GRAPHS, pinnedTxRef.current));
        setIncidents(pruneIncidents(bootstrapIncidents, INCIDENT_TTL_MS));
        setMetrics(bootstrapMetrics);
        if (!activeTxRef.current && bootstrapGraphs.length > 0 && !isDetailRef.current) {
          setActiveTx(bootstrapGraphs[0].transaction_id);
        }
        return;
      }

      if (message.type === "graph") {
        const snapshot = message.payload as GraphSnapshot;
        const pinnedIds = new Set(pinnedTxRef.current);
        if (activeTxRef.current) {
          pinnedIds.add(activeTxRef.current);
        }
        setGraphs((prev) =>
          trimGraphs({ ...prev, [snapshot.transaction_id]: snapshot }, MAX_GRAPHS, pinnedIds)
        );
        if (!activeTxRef.current && !isDetailRef.current) {
          setActiveTx(snapshot.transaction_id);
        }

        const buffer = replayBuffer.current[snapshot.transaction_id] || [];
        buffer.push(snapshot);
        if (buffer.length > 40) {
          buffer.shift();
        }
        replayBuffer.current[snapshot.transaction_id] = buffer;

        const isActive = snapshot.transaction_id === activeTxRef.current;
        if (!replayModeRef.current && isActive && isDetailRef.current) {
          const now = Date.now();
          if (now - lastGraphUpdateRef.current >= GRAPH_RENDER_INTERVAL_MS) {
            setDisplayGraph(snapshot);
            lastGraphUpdateRef.current = now;
          }
        }
        return;
      }

      if (message.type === "incident") {
        const incident = message.payload as Incident;
        setIncidents((prev) => addIncident(prev, incident, INCIDENT_TTL_MS));
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
    }
  }, [activeTx, graphs, replayMode, isDetailRoute]);

  const sortedGraphs = useMemo(() => {
    return Object.values(graphs).sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at)
    );
  }, [graphs]);

  const incidentByTx = useMemo(() => {
    const map: Record<string, Incident | undefined> = {};
    for (const incident of incidents) {
      if (!map[incident.transaction_id]) {
        map[incident.transaction_id] = incident;
      }
    }
    return map;
  }, [incidents]);

  const incidentGraphs = useMemo(() => {
    const filtered = sortedGraphs.filter(
      (graph) => incidentByTx[graph.transaction_id]
    );
    return filtered.sort((a, b) => {
      const left = incidentByTx[a.transaction_id]?.timestamp ?? "";
      const right = incidentByTx[b.transaction_id]?.timestamp ?? "";
      return right.localeCompare(left);
    });
  }, [sortedGraphs, incidentByTx]);

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
    const url = `${window.location.origin}/tx/${id}`;
    window.open(url, "_blank", "noopener,noreferrer");
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
      const pinnedIds = new Set(pinnedTxRef.current);
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

  return (
    <div className="min-h-screen px-6 py-8">
      <header className="mb-8 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">
            Realtime Transaction Integrity
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            VeriFlow Observability
          </h1>
          <p className="vf-subtle max-w-2xl">
            Reconstruct and validate distributed financial flows as they happen. Live graph
            updates, trust-weighted incidents, and fee analytics in one surface.
          </p>
        </div>
        <div className="vf-card animate-lift px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Active flow</div>
          <div className="text-lg font-semibold">
            {activeTx ?? "Awaiting events"}
          </div>
        </div>
      </header>

      <Routes>
        <Route
          path="/"
          element={
            <DashboardPage
              graphs={incidentGraphs}
              activeId={activeTx}
              incidentByTx={incidentByTx}
              metrics={metrics}
              series={series}
              incidents={incidents}
              apiUrl={apiUrl}
              onSelect={handleSelect}
            />
          }
        />
        <Route path="/tx/:id" element={<DetailRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
