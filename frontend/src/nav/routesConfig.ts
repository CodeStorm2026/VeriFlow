import type { ViewerPersona } from "../context/PersonaContext";

/** Paths for secondary navigation & routes (single source of truth). */
export const MODULE_PATHS = {
  reversals: "/reversals",
  reconciliation: "/reconciliation",
  settlement: "/settlement",
  reports: "/reports",
  settings: "/settings",
  portalMerchant: "/portal/merchant",
  portalCrypto: "/portal/crypto",
  access: "/access",
} as const;

export function sidebarGeneralItems(
  persona: ViewerPersona = "operator"
): { label: string; to: string; badge?: string }[] {
  if (persona === "merchant") {
    return [
      { label: "Desk", to: MODULE_PATHS.portalMerchant },
      { label: "Reports", to: MODULE_PATHS.reports },
    ];
  }
  if (persona === "bridge") {
    return [
      { label: "Desk", to: MODULE_PATHS.portalCrypto },
      { label: "Reports", to: MODULE_PATHS.reports },
    ];
  }
  return [
    { label: "Dashboard", to: "/" },
    { label: "Merchant", to: MODULE_PATHS.portalMerchant },
    { label: "Bridge", to: MODULE_PATHS.portalCrypto },
    { label: "Reversals", to: MODULE_PATHS.reversals },
    { label: "Reconciliation", to: MODULE_PATHS.reconciliation, badge: "Crypto" },
    { label: "Treasury", to: MODULE_PATHS.settlement },
    { label: "Reports", to: MODULE_PATHS.reports },
  ];
}

export function sidebarSettingsItems(
  persona: ViewerPersona = "operator"
): { label: string; to: string }[] {
  const account = { label: "Account", to: MODULE_PATHS.access };
  if (persona === "merchant" || persona === "bridge") {
    return [account, { label: "Settings", to: MODULE_PATHS.settings }];
  }
  return [account, { label: "Settings", to: MODULE_PATHS.settings }];
}
