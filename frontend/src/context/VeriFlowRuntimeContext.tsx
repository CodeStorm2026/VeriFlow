import { createContext, useContext, type ReactNode } from "react";

import type { MismatchMinuteBucket } from "../components/MismatchChart";
import type { GraphSnapshot, Incident, MetricSeries, MetricsSnapshot } from "../types";

export interface VeriFlowRuntimeValue {
  apiUrl: string;
  metrics: MetricsSnapshot | null;
  series: MetricSeries[];
  mismatchMinuteBuckets: MismatchMinuteBucket[];
  /** Recent mismatch-class incidents for queues and reports */
  mismatchIncidents: Incident[];
  recentGraphs: GraphSnapshot[];
  sourceHealth: Record<string, { status: string; age_ms?: number | null }>;
  onOpenTransaction: (transactionId: string) => void;
}

const VeriFlowRuntimeContext = createContext<VeriFlowRuntimeValue | null>(null);

export function VeriFlowRuntimeProvider({
  value,
  children,
}: {
  value: VeriFlowRuntimeValue;
  children: ReactNode;
}) {
  return <VeriFlowRuntimeContext.Provider value={value}>{children}</VeriFlowRuntimeContext.Provider>;
}

export function useVeriFlowRuntime(): VeriFlowRuntimeValue {
  const ctx = useContext(VeriFlowRuntimeContext);
  if (!ctx) {
    throw new Error("useVeriFlowRuntime must be used inside VeriFlowRuntimeProvider");
  }
  return ctx;
}
