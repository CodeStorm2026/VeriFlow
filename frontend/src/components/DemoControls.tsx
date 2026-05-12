import { useState } from "react";

const actions = [
  { label: "Bridge · fee skew", payload: { type: "fee_mismatch", target_node: "crypto_exchange", count: 1 } },
  {
    label: "Bridge · slow hop",
    payload: { type: "delay", target_node: "crypto_exchange", count: 1, delay_ms: 2200 },
  },
  { label: "Gateway · fee skew", payload: { type: "fee_mismatch", target_node: "gateway", count: 1 } },
  { label: "Bank · slow settle", payload: { type: "delay", target_node: "bank", count: 1, delay_ms: 2500 } },
  { label: "Gateway · duplicate", payload: { type: "duplicate", target_node: "gateway", count: 1 } },
  { label: "Bank · missing final", payload: { type: "missing", target_node: "bank", count: 1 } },
];

const scenarioOptions: { value: string; label: string }[] = [
  { value: "clean", label: "Clean path" },
  { value: "fee_mismatch_gateway", label: "Fee · gateway" },
  { value: "fee_mismatch_crypto", label: "Fee · bridge (bridge rail)" },
  { value: "fee_mismatch_bank", label: "Fee · bank" },
  { value: "delay_gateway", label: "Delay · gateway" },
  { value: "delay_crypto", label: "Delay · bridge (bridge rail)" },
  { value: "delay_bank", label: "Delay · bank" },
  { value: "duplicate_gateway", label: "Duplicate · gateway" },
  { value: "duplicate_bank", label: "Duplicate · bank" },
  { value: "missing_gateway", label: "Missing · gateway" },
  { value: "missing_crypto", label: "Missing · bridge (bridge rail)" },
  { value: "missing_bank", label: "Missing · bank" },
];

interface DemoControlsProps {
  apiUrl: string;
  onManualTrigger?: () => void;
  onDemoScenarioQueued?: (transactionId: string) => void;
}

const DemoControls = ({
  apiUrl,
  onManualTrigger,
  onDemoScenarioQueued,
}: DemoControlsProps) => {
  const [injectStatus, setInjectStatus] = useState<string | null>(null);
  const [injectError, setInjectError] = useState<string | null>(null);
  const [scenarioStatus, setScenarioStatus] = useState<string | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const [amount, setAmount] = useState("120.5");
  const [currency, setCurrency] = useState("USD");
  const [rail, setRail] = useState<"card_acquiring" | "bank_transfer" | "crypto_settlement">(
    "crypto_settlement"
  );
  const [transferScheme, setTransferScheme] = useState<
    "instant_local" | "ach_like" | "cross_border"
  >("instant_local");
  const [scenario, setScenario] = useState("fee_mismatch_crypto");
  const [txId, setTxId] = useState("");
  const [delayOverride, setDelayOverride] = useState("");

  const trigger = async (payload: Record<string, unknown>) => {
    onManualTrigger?.();
    setInjectStatus("Sending...");
    setInjectError(null);
    try {
      const response = await fetch(`${apiUrl}/demo/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const text = await response.text();
        setInjectError(`Request failed (${response.status}). ${text}`.trim());
        setInjectStatus(null);
        return;
      }
      const data = await response.json().catch(() => null);
      setInjectStatus(data?.command_id ? "Queued (next hop)" : "Queued");
    } catch {
      setInjectError("API unreachable.");
      setInjectStatus(null);
    }
  };

  const submitScenario = async () => {
    onManualTrigger?.();
    setScenarioStatus("Sending scripted payment…");
    setScenarioError(null);
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setScenarioError("Amount must be a positive number.");
      setScenarioStatus(null);
      return;
    }
    const body: Record<string, unknown> = {
      amount: parsedAmount,
      currency: currency.trim().toUpperCase() || "USD",
      payment_rail: rail,
      transfer_scheme: transferScheme,
      scenario,
    };
    const trimmedId = txId.trim();
    if (trimmedId) {
      body.transaction_id = trimmedId;
    }
    const d = delayOverride.trim();
    if (d) {
      const n = Number(d);
      if (Number.isFinite(n) && n >= 400) {
        body.delay_ms = Math.floor(n);
      }
    }
    try {
      const response = await fetch(`${apiUrl}/demo/scenario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        const detail =
          typeof data?.detail === "string"
            ? data.detail
            : Array.isArray(data?.detail)
              ? data.detail.map((x: { msg?: string }) => x?.msg).join("; ")
              : raw || `Request failed (${response.status})`;
        setScenarioError(detail);
        setScenarioStatus(null);
        return;
      }
      const id = typeof data?.transaction_id === "string" ? data.transaction_id : "";
      setScenarioStatus(
        id ? `Done · ${id}` : "Done"
      );
      if (id) {
        onDemoScenarioQueued?.(id);
      }
    } catch {
      setScenarioError("API unreachable.");
      setScenarioStatus(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="vf-card p-4">
        <div className="mb-2 text-sm font-semibold">Quick fault</div>
        <p className="vf-subtle mb-3 text-xs">Hop-level inject.</p>
        <div className="grid gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => trigger(action.payload)}
              className="vf-button vf-button-ghost w-full justify-center"
            >
              {action.label}
            </button>
          ))}
        </div>
        {injectStatus && <div className="mt-3 text-xs text-emerald-700">{injectStatus}</div>}
        {injectError && <div className="mt-3 text-xs text-rose-700">{injectError}</div>}
      </div>

      <div className="vf-card p-4">
        <div className="mb-2 text-sm font-semibold">Scripted payment</div>
        <p className="vf-subtle mb-3 text-xs">Rail + scenario → detail when ready.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-700">
            Amount
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Currency (transfer rail)
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm uppercase"
            />
          </label>
        </div>
        <label className="mt-3 block text-xs font-medium text-slate-700">
          Payment rail
          <select
            value={rail}
            onChange={(e) => setRail(e.target.value as typeof rail)}
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
          >
            <option value="crypto_settlement">Bridge path</option>
            <option value="card_acquiring">Card path</option>
            <option value="bank_transfer">Transfer path</option>
          </select>
        </label>
        {rail === "bank_transfer" && (
          <label className="mt-3 block text-xs font-medium text-slate-700">
            Transfer flavor
            <select
              value={transferScheme}
              onChange={(e) => setTransferScheme(e.target.value as typeof transferScheme)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="instant_local">Instant</option>
              <option value="ach_like">Batch-like</option>
              <option value="cross_border">Cross-border</option>
            </select>
          </label>
        )}
        <label className="mt-3 block text-xs font-medium text-slate-700">
          Scenario
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
          >
            {scenarioOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-xs font-medium text-slate-700">
          Payment id (optional)
          <input
            type="text"
            value={txId}
            onChange={(e) => setTxId(e.target.value)}
            placeholder="auto"
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <label className="mt-3 block text-xs font-medium text-slate-700">
          Custom delay (ms)
          <input
            type="text"
            inputMode="numeric"
            value={delayOverride}
            onChange={(e) => setDelayOverride(e.target.value)}
            placeholder="for delay scenarios"
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={submitScenario}
          className="vf-button vf-button-primary mt-4 w-full justify-center"
        >
          Run script
        </button>
        {scenarioStatus && (
          <div className="mt-2 text-xs text-emerald-700">{scenarioStatus}</div>
        )}
        {scenarioError && <div className="mt-2 text-xs text-rose-700">{scenarioError}</div>}
      </div>
    </div>
  );
};

export default DemoControls;
