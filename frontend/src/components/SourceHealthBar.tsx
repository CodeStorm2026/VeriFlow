const tone: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  stale: "bg-amber-100 text-amber-900",
  unknown: "bg-slate-100 text-slate-600",
};

export interface SourceNodeHealth {
  status: string;
  last_seen_ms?: number | null;
  age_ms?: number | null;
}

interface SourceHealthBarProps {
  nodes: Record<string, SourceNodeHealth>;
  /** No outer card or title — for embedding inside another block */
  embedded?: boolean;
}

const SourceHealthBar = ({ nodes, embedded }: SourceHealthBarProps) => {
  const entries = Object.entries(nodes);
  if (entries.length === 0) {
    return null;
  }

  const pills = (
    <div className="flex flex-wrap gap-2">
      {entries.map(([id, info]) => (
        <span
          key={id}
          className={`vf-pill text-xs ${tone[info.status] ?? tone.unknown}`}
          title={
            info.last_seen_ms
              ? `last seen ${info.age_ms != null ? `${Math.round(info.age_ms / 1000)}s ago` : ""}`
              : "no heartbeat yet"
          }
        >
          {id.replace("_", " ")}: {info.status}
        </span>
      ))}
    </div>
  );

  if (embedded) {
    return pills;
  }

  return (
    <div className="vf-card p-4">
      <div className="mb-2 text-sm font-semibold">Sources</div>
      {pills}
    </div>
  );
};

export default SourceHealthBar;
