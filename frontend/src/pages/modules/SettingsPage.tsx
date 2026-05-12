import { useCallback, useEffect, useState } from "react";

import ModulePageFrame from "../../components/ModulePageFrame";
import { resolveApiBaseUrl } from "../../lib/veriflowEndpoints";

type FeeSettingsDTO = {
  fee_payer: string;
  gateway_fee_model: string;
  gateway_fee_rate: number;
  gateway_fixed_fee: number;
  bank_fee_rate: number;
  bank_fee_floor: number;
  crypto_network_fee_rate: number;
  crypto_network_fee_floor: number;
  policy_max_bank_fee_vs_gateway: number;
};

export default function SettingsPage() {
  const [fee, setFee] = useState<FeeSettingsDTO | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const loadFees = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = await fetch(`${resolveApiBaseUrl()}/settings/fees`);
      if (!r.ok) {
        setLoadErr(`HTTP ${r.status}`);
        return;
      }
      setFee((await r.json()) as FeeSettingsDTO);
    } catch {
      setLoadErr("unreachable");
    }
  }, []);

  useEffect(() => {
    void loadFees();
  }, [loadFees]);

  const saveFees = async () => {
    if (!fee) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch(`${resolveApiBaseUrl()}/settings/fees`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway_fee_model: fee.gateway_fee_model,
          gateway_fee_rate: fee.gateway_fee_rate,
          gateway_fixed_fee: fee.gateway_fixed_fee,
          bank_fee_rate: fee.bank_fee_rate,
          bank_fee_floor: fee.bank_fee_floor,
          crypto_network_fee_rate: fee.crypto_network_fee_rate,
          crypto_network_fee_floor: fee.crypto_network_fee_floor,
          policy_max_bank_fee_vs_gateway: fee.policy_max_bank_fee_vs_gateway,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        setNote(t || `HTTP ${r.status}`);
        setBusy(false);
        return;
      }
      setFee((await r.json()) as FeeSettingsDTO);
      setNote("saved");
    } catch {
      setNote("failed");
    }
    setBusy(false);
  };

  const resetOverrides = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch(`${resolveApiBaseUrl()}/settings/fees`, { method: "DELETE" });
      if (!r.ok) {
        setNote(`HTTP ${r.status}`);
      } else {
        setFee((await r.json()) as FeeSettingsDTO);
        setNote("env defaults");
      }
    } catch {
      setNote("failed");
    }
    setBusy(false);
  };

  return (
    <ModulePageFrame
      eyebrow="Config"
      title="Settings"
      subtitle="Env: VF_* in compose. Redis overrides apply on next simulator event."
    >
      <div className="vf-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Fee simulators</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="vf-button vf-button-ghost text-xs"
              onClick={() => void loadFees()}
              disabled={busy}
            >
              Reload
            </button>
            <button
              type="button"
              className="vf-button vf-button-ghost text-xs"
              onClick={() => void resetOverrides()}
              disabled={busy}
            >
              Clear Redis
            </button>
            <button
              type="button"
              className="vf-button vf-button-primary text-xs"
              onClick={() => void saveFees()}
              disabled={busy || !fee}
            >
              Save
            </button>
          </div>
        </div>
        <p className="vf-subtle mt-2 text-xs">
          Model: sender pays — principal per hop is not reduced by fee; fee is on the sender line.
        </p>
        {loadErr && <p className="mt-2 text-sm text-rose-700">{loadErr}</p>}
        {note && <p className="mt-2 text-xs text-slate-600">{note}</p>}
        {fee && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-700">
              Fee payer (read-only)
              <input
                readOnly
                value={fee.fee_payer}
                className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Gateway fee model
              <select
                value={fee.gateway_fee_model}
                onChange={(e) => setFee({ ...fee, gateway_fee_model: e.target.value })}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              >
                <option value="percent">percent</option>
                <option value="fixed">fixed</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Gateway fee rate (0–1)
              <input
                type="number"
                step="0.001"
                value={fee.gateway_fee_rate}
                onChange={(e) => setFee({ ...fee, gateway_fee_rate: Number(e.target.value) })}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Gateway fixed fee
              <input
                type="number"
                step="0.01"
                value={fee.gateway_fixed_fee}
                onChange={(e) => setFee({ ...fee, gateway_fixed_fee: Number(e.target.value) })}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Bank fee rate (0–1)
              <input
                type="number"
                step="0.0001"
                value={fee.bank_fee_rate}
                onChange={(e) => setFee({ ...fee, bank_fee_rate: Number(e.target.value) })}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Bank fee floor
              <input
                type="number"
                step="0.01"
                value={fee.bank_fee_floor}
                onChange={(e) => setFee({ ...fee, bank_fee_floor: Number(e.target.value) })}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Crypto network fee rate (0–1)
              <input
                type="number"
                step="0.0001"
                value={fee.crypto_network_fee_rate}
                onChange={(e) =>
                  setFee({ ...fee, crypto_network_fee_rate: Number(e.target.value) })
                }
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Crypto network fee floor
              <input
                type="number"
                step="0.01"
                value={fee.crypto_network_fee_floor}
                onChange={(e) =>
                  setFee({ ...fee, crypto_network_fee_floor: Number(e.target.value) })
                }
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700 sm:col-span-2">
              Max bank fee / gateway fee (policy ratio)
              <input
                type="number"
                step="0.01"
                value={fee.policy_max_bank_fee_vs_gateway}
                onChange={(e) =>
                  setFee({ ...fee, policy_max_bank_fee_vs_gateway: Number(e.target.value) })
                }
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        )}
      </div>
    </ModulePageFrame>
  );
}
