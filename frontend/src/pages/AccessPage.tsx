import { useState } from "react";
import { useNavigate } from "react-router-dom";

import ModulePageFrame from "../components/ModulePageFrame";
import { usePersona } from "../context/PersonaContext";

export default function AccessPage() {
  const navigate = useNavigate();
  const {
    persona,
    signInAsMerchant,
    signInAsBridge,
    signOutToOperator,
    merchantDisplayName,
    setMerchantDisplayName,
    bridgeDisplayName,
    setBridgeDisplayName,
  } = usePersona();
  const [mName, setMName] = useState(merchantDisplayName);
  const [bName, setBName] = useState(bridgeDisplayName);

  return (
    <ModulePageFrame
      eyebrow="Session"
      title="Account"
      subtitle="Demo personas: operator vs merchant vs bridge console. Stored in this browser only."
    >
      <div className="vf-card border-teal-200/60 bg-teal-50/40 p-4 text-sm text-slate-800">
        Active:{" "}
        <span className="font-semibold">
          {persona === "operator"
            ? "Operator (risk / ops)"
            : persona === "merchant"
              ? `Merchant · ${merchantDisplayName}`
              : `Bridge · ${bridgeDisplayName}`}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="vf-card flex flex-col gap-3 p-5">
          <div className="text-sm font-semibold text-slate-900">Operator</div>
          <p className="vf-subtle text-xs">Full desk, demo inject, reversals, treasury.</p>
          <button
            type="button"
            className="vf-button vf-button-primary mt-auto"
            onClick={() => {
              signOutToOperator();
              navigate("/", { replace: true });
            }}
          >
            Continue as operator
          </button>
        </div>

        <div className="vf-card flex flex-col gap-3 p-5">
          <div className="text-sm font-semibold text-slate-900">Merchant</div>
          <label className="text-xs font-medium text-slate-700">
            Display name
            <input
              value={mName}
              onChange={(e) => setMName(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <p className="vf-subtle text-xs">
            Card / transfer view, no ops demo. Same live data, scoped list.
          </p>
          <button
            type="button"
            className="vf-button vf-button-primary mt-auto"
            onClick={() => {
              setMerchantDisplayName(mName.trim() || merchantDisplayName);
              signInAsMerchant(mName.trim() || undefined);
              navigate("/portal/merchant", { replace: true });
            }}
          >
            Sign in as merchant
          </button>
        </div>

        <div className="vf-card flex flex-col gap-3 p-5">
          <div className="text-sm font-semibold text-slate-900">Bridge</div>
          <label className="text-xs font-medium text-slate-700">
            Desk label
            <input
              value={bName}
              onChange={(e) => setBName(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <p className="vf-subtle text-xs">Stablecoin / FX leg console.</p>
          <button
            type="button"
            className="vf-button vf-button-primary mt-auto"
            onClick={() => {
              setBridgeDisplayName(bName.trim() || bridgeDisplayName);
              signInAsBridge(bName.trim() || undefined);
              navigate("/portal/crypto", { replace: true });
            }}
          >
            Sign in as bridge
          </button>
        </div>
      </div>
    </ModulePageFrame>
  );
}
