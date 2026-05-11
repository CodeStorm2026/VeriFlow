import { useState } from "react";

const actions = [
  {
    label: "Inject fee mismatch",
    payload: { type: "fee_mismatch", target_node: "gateway", count: 1 },
  },
  {
    label: "Inject delay",
    payload: { type: "delay", target_node: "bank", count: 1, delay_ms: 2500 },
  },
  {
    label: "Inject duplicate",
    payload: { type: "duplicate", target_node: "gateway", count: 1 },
  },
  {
    label: "Inject missing event",
    payload: { type: "missing", target_node: "bank", count: 1 },
  },
];

interface DemoControlsProps {
  apiUrl: string;
}

const DemoControls = ({ apiUrl }: DemoControlsProps) => {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trigger = async (payload: Record<string, any>) => {
    setStatus("Sending...");
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/demo/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        setError(`Request failed (${response.status}). ${text}`.trim());
        setStatus(null);
        return;
      }
      const data = await response.json().catch(() => null);
      setStatus(
        data?.command_id
          ? `Queued for next event (${data.command_id})`
          : "Queued for next event"
      );
    } catch (err) {
      setError("Failed to reach API. Check websocket-api container and CORS.");
      setStatus(null);
    }
  };

  return (
    <div className="vf-card p-4">
      <div className="mb-3 text-sm font-semibold">Demo mode</div>
      <div className="grid gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => trigger(action.payload)}
            className="rounded-xl border border-black/10 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:shadow-glow"
          >
            {action.label}
          </button>
        ))}
      </div>
      {status && <div className="mt-3 text-xs text-emerald-700">{status}</div>}
      {error && <div className="mt-3 text-xs text-rose-700">{error}</div>}
    </div>
  );
};

export default DemoControls;
