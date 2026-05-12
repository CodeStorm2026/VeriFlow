import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

import ModulePageFrame from "../../components/ModulePageFrame";
import SourceHealthBar from "../../components/SourceHealthBar";
import { usePersona } from "../../context/PersonaContext";
import { useVeriFlowRuntime } from "../../context/VeriFlowRuntimeContext";
import { flowLabel, incidentLabel } from "../../lib/humanize";
import { MODULE_PATHS } from "../../nav/routesConfig";
import { formatPaymentRail, type GraphSnapshot, type Incident } from "../../types";

type PortalRole = "merchant" | "crypto";

const MERCHANT_NODES = new Set(["merchant", "gateway", "bank"]);
const CRYPTO_NODES = new Set(["merchant", "gateway", "crypto_exchange", "bank"]);

function matchesPortal(graph: GraphSnapshot, role: PortalRole): boolean {
  if (role === "crypto") {
    return graph.flow_type === "crypto" || graph.payment_rail === "crypto_settlement";
  }
  return graph.flow_type !== "crypto" && graph.payment_rail !== "crypto_settlement";
}

function merchantAmount(graph: GraphSnapshot): number | undefined {
  const m = graph.nodes.find((n) => n.id === "merchant");
  return m?.amount;
}

function exchangeLegAmount(graph: GraphSnapshot): number | undefined {
  const n = graph.nodes.find((x) => x.id === "crypto_exchange");
  return typeof n?.amount === "number" ? n.amount : undefined;
}

const BRIDGE_INJECT_ACTIONS: { label: string; payload: Record<string, unknown> }[] = [
  { label: "Fee skew at exchange", payload: { type: "fee_mismatch", target_node: "crypto_exchange", count: 1 } },
  { label: "Exchange leg delay", payload: { type: "delay", target_node: "crypto_exchange", count: 1, delay_ms: 2200 } },
  { label: "Bank delay (fiat exit)", payload: { type: "delay", target_node: "bank", count: 1, delay_ms: 2500 } },
  { label: "Missing exchange event", payload: { type: "missing", target_node: "crypto_exchange", count: 1 } },
  { label: "Duplicate at gateway", payload: { type: "duplicate", target_node: "gateway", count: 1 } },
  { label: "Bank fee skew", payload: { type: "fee_mismatch", target_node: "bank", count: 1 } },
];

const BRIDGE_SCENARIOS: { value: string; label: string }[] = [
  { value: "clean", label: "Clean path" },
  { value: "fee_mismatch_crypto", label: "Fee · exchange" },
  { value: "fee_mismatch_bank", label: "Fee · bank" },
  { value: "fee_mismatch_gateway", label: "Fee · gateway" },
  { value: "delay_crypto", label: "Delay · exchange" },
  { value: "delay_bank", label: "Delay · bank" },
  { value: "delay_gateway", label: "Delay · gateway" },
  { value: "missing_crypto", label: "Missing · exchange" },
  { value: "missing_bank", label: "Missing · bank" },
  { value: "duplicate_bank", label: "Duplicate · bank" },
];

function BridgeLiquidityDesk({
  apiUrl,
  onPaymentQueued,
}: {
  apiUrl: string;
  onPaymentQueued?: (transactionId: string) => void;
}) {
  const { recentGraphs, metrics, mismatchIncidents, onOpenTransaction } = useVeriFlowRuntime();

  const cryptoGraphs = useMemo(
    (): GraphSnapshot[] =>
      recentGraphs.filter((g) => g.flow_type === "crypto" || g.payment_rail === "crypto_settlement"),
    [recentGraphs]
  );

  const bridgeSignals = useMemo(() => {
    const ids = new Set(cryptoGraphs.map((g) => g.transaction_id));
    return mismatchIncidents.filter(
      (i) =>
        ids.has(i.transaction_id) ||
        Boolean(i.affected_nodes?.includes("crypto_exchange")) ||
        i.type === "fx_mismatch"
    );
  }, [mismatchIncidents, cryptoGraphs]);

  const exchangeEvents = metrics?.node_events?.crypto_exchange ?? 0;
  const volHint = useMemo(() => {
    let s = 0;
    for (const g of cryptoGraphs.slice(0, 12)) {
      const a = merchantAmount(g);
      if (typeof a === "number") {
        s += a;
      }
    }
    return s;
  }, [cryptoGraphs]);

  const [amount, setAmount] = useState("5000");
  const [currency, setCurrency] = useState("USD");
  const [scenario, setScenario] = useState("clean");
  const [asset, setAsset] = useState("USDC");
  const [chain, setChain] = useState("Ethereum");
  const [mintTo, setMintTo] = useState("0x71C…9A3B");
  const [memo, setMemo] = useState("Treasury sweep / L2");
  const [optionalTxId, setOptionalTxId] = useState("");
  const [delayMs, setDelayMs] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [injectMsg, setInjectMsg] = useState<string | null>(null);

  const submitBridge = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    const n = Number.parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setErr("Enter a positive amount.");
      setBusy(false);
      return;
    }
    const body: Record<string, unknown> = {
      amount: n,
      currency: currency.trim().toUpperCase() || "USD",
      payment_rail: "crypto_settlement",
      transfer_scheme: "instant_local",
      scenario,
      bridge_asset: asset.trim() || undefined,
      bridge_chain: chain.trim() || undefined,
      mint_to_address: mintTo.trim() || undefined,
      bridge_memo: memo.trim() || undefined,
    };
    const tid = optionalTxId.trim();
    if (tid) {
      body.transaction_id = tid;
    }
    const d = delayMs.trim();
    if (d) {
      const dn = Number(d);
      if (Number.isFinite(dn) && dn >= 400) {
        body.delay_ms = Math.floor(dn);
      }
    }
    try {
      const res = await fetch(`${apiUrl}/demo/scenario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let data: { transaction_id?: string } | null = null;
      try {
        data = raw ? (JSON.parse(raw) as { transaction_id?: string }) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        setErr(raw || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      const id = typeof data?.transaction_id === "string" ? data.transaction_id : "";
      setMsg(id ? `Bridge payment queued · ${id}` : "Queued.");
      if (id) {
        onPaymentQueued?.(id);
      }
    } catch {
      setErr("API unavailable.");
    }
    setBusy(false);
  };

  const quickInject = async (payload: Record<string, unknown>) => {
    setInjectMsg(null);
    try {
      const res = await fetch(`${apiUrl}/demo/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setInjectMsg("Inject rejected");
        return;
      }
      setInjectMsg(data?.command_id ? `Command ${data.command_id}` : "Queued");
    } catch {
      setInjectMsg("Network unavailable");
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-violet-300/80 bg-gradient-to-br from-violet-950 via-slate-900 to-slate-950 p-5 text-white shadow-md">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-200">
          Bridge and liquidity
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-violet-50/95">
          Not “just an on-ramp”: stablecoin issuance, exchange-leg control, network fees, and handoff to
          the bank. Start a new bridge payment or surgically break a leg for drills — everything lands in
          the same Kafka stream the operator sees.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="vf-card border-violet-200/50 bg-violet-50/40 p-4">
          <div className="text-xs text-violet-900/80">Bridge flows in window</div>
          <div className="text-2xl font-semibold tabular-nums text-violet-950">{cryptoGraphs.length}</div>
        </div>
        <div className="vf-card p-4">
          <div className="text-xs text-slate-500">Signals (bridge + FX)</div>
          <div className="text-2xl font-semibold text-slate-900">{bridgeSignals.length}</div>
        </div>
        <div className="vf-card p-4">
          <div className="text-xs text-slate-500">crypto_exchange events</div>
          <div className="text-2xl font-semibold text-slate-900">{exchangeEvents}</div>
        </div>
        <div className="vf-card p-4">
          <div className="text-xs text-slate-500">Merchant sum (12 items)</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">
            {volHint > 0 ? volHint.toFixed(0) : "—"}
          </div>
        </div>
      </div>

      <div className="vf-card p-5">
        <h2 className="text-sm font-semibold text-slate-900">New bridge payment</h2>
        <p className="vf-subtle mt-1 text-xs">
          Rail <span className="font-mono">crypto_settlement</span> — scenarios with “crypto” in the name
          require this rail (already selected). Metadata lands on the merchant node in the graph.
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">
                Amount
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Ledger currency
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm uppercase"
                />
              </label>
            </div>
            <label className="block text-xs font-medium text-slate-700">
              Scenario
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              >
                {BRIDGE_SCENARIOS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Payment ID (optional)
              <input
                value={optionalTxId}
                onChange={(e) => setOptionalTxId(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-sm"
                placeholder="auto"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Delay for delay scenarios (ms)
              <input
                value={delayMs}
                onChange={(e) => setDelayMs(e.target.value)}
                placeholder="≥ 400"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-700">
              Bridge asset
              <input
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="USDC"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Network / L2
              <input
                value={chain}
                onChange={(e) => setChain(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="Ethereum"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Mint / custody address (on-chain recipient)
              <input
                value={mintTo}
                onChange={(e) => setMintTo(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Label / memo for risk and ops
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitBridge()}
              className="vf-button vf-button-primary w-full justify-center"
            >
              {busy ? "Starting…" : "Start bridge payment"}
            </button>
            {msg && <p className="text-xs text-emerald-800">{msg}</p>}
            {err && <p className="text-xs text-rose-700">{err}</p>}
          </div>
        </div>
      </div>

      <div className="vf-card p-4">
        <div className="mb-2 text-sm font-semibold text-slate-900">Quick leg fault (demo)</div>
        <p className="vf-subtle mb-3 text-xs">
          Commands go to the control topic and apply to the next matching simulator hop.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BRIDGE_INJECT_ACTIONS.map((a) => (
            <button
              key={a.label}
              type="button"
              className="vf-button vf-button-ghost justify-center text-xs"
              onClick={() => void quickInject(a.payload)}
            >
              {a.label}
            </button>
          ))}
        </div>
        {injectMsg && <p className="mt-2 text-xs text-slate-600">{injectMsg}</p>}
      </div>

      <div className="vf-card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 px-4 py-2">
          <div className="text-sm font-semibold text-slate-900">Latest bridge flows</div>
          <button
            type="button"
            className="vf-button vf-button-ghost py-1 text-xs"
            onClick={() => {
              const g = cryptoGraphs[0];
              if (g) {
                onOpenTransaction(g.transaction_id);
              }
            }}
            disabled={cryptoGraphs.length === 0}
          >
            Open latest
          </button>
        </div>
        <ul className="max-h-[280px] divide-y divide-slate-100 overflow-auto">
          {cryptoGraphs.slice(0, 14).map((g) => (
            <li key={g.transaction_id}>
              <button
                type="button"
                onClick={() => onOpenTransaction(g.transaction_id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-violet-50/50"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs text-slate-500">{g.transaction_id}</div>
                  <div className="truncate text-xs text-slate-600">{g.path.join(" → ")}</div>
                </div>
                <div className="shrink-0 text-right text-xs tabular-nums text-slate-800">
                  <div>{merchantAmount(g) != null ? `${merchantAmount(g)?.toFixed(2)}` : "—"}</div>
                  <div className="text-[10px] text-slate-400">
                    exchange {exchangeLegAmount(g) != null ? exchangeLegAmount(g)?.toFixed(2) : "—"}
                  </div>
                </div>
              </button>
            </li>
          ))}
          {cryptoGraphs.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
              No bridge graphs yet — start a payment above or wait for the simulator.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

const MERCHANT_SOURCES_KEY = "vf_merchant_payout_sources";

type PayoutSource = { id: string; label: string; detail: string; kind: "account" | "card" };

const DEFAULT_PAYOUT_SOURCES: PayoutSource[] = [
  { id: "s1", label: "USD operating account", detail: "US01 ****4521", kind: "account" },
  { id: "s2", label: "EUR account", detail: "DE89 ****3000", kind: "account" },
  { id: "s3", label: "Corporate card", detail: "···· 9912", kind: "card" },
];

function MerchantOutgoingPayout({
  apiUrl,
  onPaymentQueued,
}: {
  apiUrl: string;
  onPaymentQueued?: (transactionId: string) => void;
}) {
  const [sources, setSources] = useState<PayoutSource[]>(DEFAULT_PAYOUT_SOURCES);
  const [funding, setFunding] = useState<"bank_account" | "card">("bank_account");
  const [sourceId, setSourceId] = useState(DEFAULT_PAYOUT_SOURCES[0]!.id);
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryAccount, setBeneficiaryAccount] = useState("");
  const [amount, setAmount] = useState("250.00");
  const [currency, setCurrency] = useState("USD");
  const [purpose, setPurpose] = useState("Supplier payout");
  const [transferScheme, setTransferScheme] = useState<"instant_local" | "ach_like" | "cross_border">(
    "instant_local"
  );
  const [optionalTxId, setOptionalTxId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newDetail, setNewDetail] = useState("");
  const [newKind, setNewKind] = useState<"account" | "card">("account");
  const sourcesHydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MERCHANT_SOURCES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PayoutSource[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSources(parsed);
          if (!parsed.some((s) => s.id === sourceId)) {
            setSourceId(parsed[0]!.id);
          }
        }
      }
    } catch {
      /* ignore */
    }
    sourcesHydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sourcesHydrated.current) {
      return;
    }
    try {
      localStorage.setItem(MERCHANT_SOURCES_KEY, JSON.stringify(sources));
    } catch {
      /* ignore */
    }
  }, [sources]);

  const filteredSources = useMemo(
    () => sources.filter((s) => (funding === "card" ? s.kind === "card" : s.kind === "account")),
    [sources, funding]
  );

  useEffect(() => {
    const list = funding === "card" ? sources.filter((s) => s.kind === "card") : sources.filter((s) => s.kind === "account");
    if (list.length && !list.some((s) => s.id === sourceId)) {
      setSourceId(list[0]!.id);
    }
  }, [funding, sources, sourceId]);

  const addSource = () => {
    const label = newLabel.trim();
    const detail = newDetail.trim();
    if (!label || !detail) {
      return;
    }
    const id = `s-${Date.now()}`;
    setSources((prev) => [...prev, { id, label, detail, kind: newKind }]);
    setSourceId(id);
    setNewLabel("");
    setNewDetail("");
  };

  const submitPayout = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    const n = Number.parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setErr("Enter a positive amount.");
      setBusy(false);
      return;
    }
    if (!beneficiaryName.trim() || !beneficiaryAccount.trim()) {
      setErr("Enter beneficiary name and account / details.");
      setBusy(false);
      return;
    }
    const src = sources.find((s) => s.id === sourceId);
    const fromLabel = src ? `${src.label} — ${src.detail}` : "";
    const paymentRail = funding === "card" ? "card_acquiring" : "bank_transfer";
    const body: Record<string, unknown> = {
      amount: n,
      currency: currency.trim().toUpperCase() || "USD",
      payment_rail: paymentRail,
      scenario: "clean",
      payout_method: funding,
      from_account_label: fromLabel || undefined,
      beneficiary_name: beneficiaryName.trim(),
      beneficiary_account: beneficiaryAccount.trim(),
      payment_purpose: purpose.trim() || undefined,
    };
    if (paymentRail === "bank_transfer") {
      body.transfer_scheme = transferScheme;
    }
    const tid = optionalTxId.trim();
    if (tid) {
      body.transaction_id = tid;
    }
    try {
      const res = await fetch(`${apiUrl}/demo/scenario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let data: { transaction_id?: string } | null = null;
      try {
        data = raw ? (JSON.parse(raw) as { transaction_id?: string }) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        setErr(raw || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      const id = typeof data?.transaction_id === "string" ? data.transaction_id : "";
      setMsg(id ? `Payment queued · ${id}` : "Payment queued.");
      if (id) {
        onPaymentQueued?.(id);
      }
    } catch {
      setErr("API unavailable.");
    }
    setBusy(false);
  };

  return (
    <div className="vf-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Outgoing money</h2>
          <p className="vf-subtle mt-1 max-w-xl text-xs">
            Choose where we debit (account or card), who receives funds, and their details. The demo
            enqueues into the same pipeline as the simulators — payout fields appear on the merchant node
            in the graph.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Your accounts and cards
          </h3>
          <ul className="mt-2 space-y-2">
            {sources.map((s) => (
              <li
                key={s.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  sourceId === s.id ? "border-teal-500 bg-teal-50/60" : "border-black/5 bg-white/80"
                }`}
              >
                <button
                  type="button"
                  className="text-left"
                  onClick={() => {
                    setSourceId(s.id);
                    setFunding(s.kind === "card" ? "card" : "bank_account");
                  }}
                >
                  <div className="font-medium text-slate-900">{s.label}</div>
                  <div className="font-mono text-xs text-slate-500">{s.detail}</div>
                  <div className="text-[10px] uppercase text-slate-400">
                    {s.kind === "card" ? "Card" : "Account"}
                  </div>
                </button>
                <button
                  type="button"
                  className="vf-button vf-button-ghost py-0.5 text-[10px]"
                  onClick={() => setSources((prev) => prev.filter((x) => x.id !== s.id))}
                  aria-label="Remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-3">
            <div className="text-xs font-medium text-slate-700">Add funding source</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                placeholder="Label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
              <input
                placeholder="IBAN / masked card"
                value={newDetail}
                onChange={(e) => setNewDetail(e.target.value)}
                className="rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as "account" | "card")}
                className="rounded border border-slate-200 px-2 py-1.5 text-sm"
              >
                <option value="account">Checking account</option>
                <option value="card">Card</option>
              </select>
              <button type="button" className="vf-button vf-button-ghost text-xs" onClick={addSource}>
                Add
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                funding === "bank_account" ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700"
              }`}
              onClick={() => setFunding("bank_account")}
            >
              From account (transfer)
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                funding === "card" ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700"
              }`}
              onClick={() => setFunding("card")}
            >
              By card
            </button>
          </div>
          <label className="block text-xs font-medium text-slate-700">
            Debit from
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            >
              {filteredSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {s.detail}
                </option>
              ))}
            </select>
            {filteredSources.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">Add an account or card on the left.</p>
            )}
          </label>
          {funding === "bank_account" && (
            <label className="block text-xs font-medium text-slate-700">
              Transfer type
              <select
                value={transferScheme}
                onChange={(e) => setTransferScheme(e.target.value as typeof transferScheme)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              >
                <option value="instant_local">Instant local</option>
                <option value="ach_like">Batch (ACH-like)</option>
                <option value="cross_border">Cross-border</option>
              </select>
            </label>
          )}
          <label className="block text-xs font-medium text-slate-700">
            Beneficiary (legal name)
            <input
              value={beneficiaryName}
              onChange={(e) => setBeneficiaryName(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              placeholder="Acme Supplies LLC"
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Beneficiary account / IBAN / card details
            <input
              value={beneficiaryAccount}
              onChange={(e) => setBeneficiaryAccount(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              placeholder="DE89370400440532013000 or ····4242"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-700">
              Amount
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Currency
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm uppercase"
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-700">
            Payment reference
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Payment ID (optional)
            <input
              value={optionalTxId}
              onChange={(e) => setOptionalTxId(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-sm"
              placeholder="auto"
            />
          </label>
          <button
            type="button"
            disabled={busy || filteredSources.length === 0}
            onClick={() => void submitPayout()}
            className="vf-button vf-button-primary w-full justify-center"
          >
            {busy ? "Sending…" : "Send money (demo)"}
          </button>
          {msg && <p className="text-xs text-emerald-800">{msg}</p>}
          {err && <p className="text-xs text-rose-700">{err}</p>}
        </div>
      </div>
    </div>
  );
}

export default function PortalPage({ role }: { role: PortalRole }) {
  const { persona, merchantDisplayName, bridgeDisplayName } = usePersona();
  const { recentGraphs, mismatchIncidents, metrics, sourceHealth, onOpenTransaction, apiUrl } =
    useVeriFlowRuntime();
  const [q, setQ] = useState("");
  const [rail, setRail] = useState<"all" | "card" | "transfer">("all");

  const filtered = useMemo(() => {
    let list = recentGraphs.filter((g) => matchesPortal(g, role));
    const qq = q.trim().toLowerCase();
    if (qq) {
      list = list.filter((g) => g.transaction_id.toLowerCase().includes(qq));
    }
    if (role === "merchant" && rail !== "all") {
      list = list.filter((g) => {
        if (rail === "card") return g.payment_rail === "card_acquiring";
        if (rail === "transfer") return g.payment_rail === "bank_transfer";
        return true;
      });
    }
    return list.slice(0, 40);
  }, [recentGraphs, role, q, rail]);

  const txSet = useMemo(() => new Set(filtered.map((g) => g.transaction_id)), [filtered]);

  const portalIncidents = useMemo(() => {
    return mismatchIncidents
      .filter((i) => txSet.has(i.transaction_id))
      .slice(0, 12);
  }, [mismatchIncidents, txSet]);

  const healthNodes = useMemo(() => {
    const want = role === "crypto" ? CRYPTO_NODES : MERCHANT_NODES;
    const next: Record<string, { status: string; age_ms?: number | null }> = {};
    for (const id of want) {
      if (sourceHealth[id]) next[id] = sourceHealth[id]!;
    }
    return next;
  }, [sourceHealth, role]);

  const title = role === "crypto" ? "Bridge desk" : "Merchant desk";
  const eyebrow = role === "crypto" ? "Liquidity" : "Acceptance";
  const subtitle =
    role === "crypto"
      ? "Stablecoin, FX, on-chain exit, and the bank final leg."
      : "Card, transfer.";

  const sessionOk =
    (role === "merchant" && persona === "merchant") || (role === "crypto" && persona === "bridge");

  return (
    <>
      <div
        className={`mb-4 rounded-xl border px-4 py-2 text-xs ${
          sessionOk
            ? "border-emerald-200 bg-emerald-50/80 text-emerald-950"
            : "border-amber-200 bg-amber-50/80 text-amber-950"
        }`}
      >
        {sessionOk ? (
          <span>
            Session:{" "}
            <strong>
              {role === "merchant" ? merchantDisplayName : bridgeDisplayName}
            </strong>
          </span>
        ) : (
          <span>
            Viewing desk without matching sign-in — open{" "}
            <NavLink to={MODULE_PATHS.access} className="font-semibold text-teal-800 underline">
              Account
            </NavLink>{" "}
            and choose {role === "merchant" ? "Merchant" : "Bridge"}.
          </span>
        )}
      </div>
      <ModulePageFrame
      eyebrow={eyebrow}
      title={title}
      subtitle={subtitle}
      actions={
        <>
          <NavLink to={MODULE_PATHS.access} className="vf-button vf-button-ghost">
            Account
          </NavLink>
          {persona === "operator" ? (
            <NavLink to="/" className="vf-button vf-button-primary">
              Operator
            </NavLink>
          ) : (
            <NavLink to="/" className="vf-button vf-button-ghost">
              Operator desk
            </NavLink>
          )}
          <NavLink to="/reports" className="vf-button vf-button-ghost">
            Charts
          </NavLink>
          {role === "crypto" && (
            <NavLink to={MODULE_PATHS.reconciliation} className="vf-button vf-button-ghost">
              Reconciliation
            </NavLink>
          )}
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="vf-card p-4">
          <div className="text-xs text-slate-500">Throughput</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">
            {metrics?.tx_per_sec != null ? metrics.tx_per_sec.toFixed(1) : "—"}
          </div>
          <div className="text-xs text-slate-500">tx/s</div>
        </div>
        <div className="vf-card p-4">
          <div className="text-xs text-slate-500">Open signals</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">
            {portalIncidents.length}
          </div>
          <div className="text-xs text-slate-500">scoped</div>
        </div>
        <div className="vf-card p-4">
          <div className="text-xs text-slate-500">Mismatch rate</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">
            {metrics?.mismatch_rate != null
              ? `${(metrics.mismatch_rate * 100).toFixed(1)}%`
              : "—"}
          </div>
        </div>
      </div>

      {role === "crypto" && (
        <BridgeLiquidityDesk apiUrl={apiUrl} onPaymentQueued={onOpenTransaction} />
      )}

      {role === "merchant" && (
        <MerchantOutgoingPayout apiUrl={apiUrl} onPaymentQueued={onOpenTransaction} />
      )}

      <div className="vf-card p-4">
        <div className="mb-3 text-sm font-semibold text-slate-900">Sources</div>
        {Object.keys(healthNodes).length === 0 ? (
          <p className="vf-subtle text-sm">Waiting…</p>
        ) : (
          <SourceHealthBar nodes={healthNodes} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Payment id"
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
        />
        {role === "merchant" && (
          <div className="flex gap-1">
            {(["all", "card", "transfer"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRail(key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  rail === key
                    ? "bg-teal-700 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {key === "all" ? "All" : key === "card" ? "Card" : "Transfer"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="vf-card overflow-hidden p-0">
          <div className="border-b border-black/5 px-4 py-2 text-sm font-semibold text-slate-900">
            {role === "crypto" ? "Bridge payments" : "Payments"}
          </div>
          <ul className="max-h-[420px] divide-y divide-slate-100 overflow-auto">
            {filtered.map((g) => (
              <li key={g.transaction_id}>
                <button
                  type="button"
                  onClick={() => onOpenTransaction(g.transaction_id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <div>
                    <div className="font-mono text-xs text-slate-500">{g.transaction_id}</div>
                    <div className="text-sm text-slate-800">
                      {formatPaymentRail(g.payment_rail)} · {flowLabel(g.flow_type)}
                    </div>
                  </div>
                  <div className="text-right text-sm font-medium tabular-nums text-slate-900">
                    {merchantAmount(g) != null ? `${merchantAmount(g)?.toFixed(2)}` : "—"}
                  </div>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">Empty.</li>
            )}
          </ul>
        </div>

        <div className="vf-card p-4">
          <div className="mb-3 text-sm font-semibold text-slate-900">Signals</div>
          <div className="max-h-[420px] space-y-2 overflow-auto">
            {portalIncidents.map((i: Incident) => (
              <button
                key={i.incident_id}
                type="button"
                onClick={() => onOpenTransaction(i.transaction_id)}
                className="w-full rounded-lg border border-black/5 bg-white p-3 text-left hover:border-teal-300"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    {incidentLabel(i.type)}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(i.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="mt-1 truncate text-sm text-slate-800">{i.message}</div>
                <div className="mt-1 font-mono text-[11px] text-slate-500">{i.transaction_id}</div>
              </button>
            ))}
            {portalIncidents.length === 0 && (
              <p className="text-sm text-slate-500">None.</p>
            )}
          </div>
        </div>
      </div>
    </ModulePageFrame>
    </>
  );
}
