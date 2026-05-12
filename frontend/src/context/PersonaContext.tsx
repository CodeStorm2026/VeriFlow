import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ViewerPersona = "operator" | "merchant" | "bridge";

const PERSONA_KEY = "vf_persona";
const MERCHANT_NAME_KEY = "vf_merchant_display_name";
const BRIDGE_NAME_KEY = "vf_bridge_display_name";

function readStoredPersona(): ViewerPersona {
  try {
    const v = localStorage.getItem(PERSONA_KEY);
    if (v === "merchant" || v === "bridge" || v === "operator") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "operator";
}

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key)?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export interface PersonaContextValue {
  persona: ViewerPersona;
  setPersona: (p: ViewerPersona) => void;
  merchantDisplayName: string;
  setMerchantDisplayName: (s: string) => void;
  bridgeDisplayName: string;
  setBridgeDisplayName: (s: string) => void;
  /** Demo: switch to merchant persona, optional org label, then go to merchant desk */
  signInAsMerchant: (displayName?: string) => void;
  signInAsBridge: (displayName?: string) => void;
  signOutToOperator: () => void;
}

const PersonaContext = createContext<PersonaContextValue | null>(null);

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState<ViewerPersona>(readStoredPersona);
  const [merchantDisplayName, setMerchantDisplayNameState] = useState(() =>
    readStored(MERCHANT_NAME_KEY, "Acme Demo Merchant")
  );
  const [bridgeDisplayName, setBridgeDisplayNameState] = useState(() =>
    readStored(BRIDGE_NAME_KEY, "Bridge desk (demo)")
  );

  const setPersona = useCallback((p: ViewerPersona) => {
    setPersonaState(p);
    try {
      localStorage.setItem(PERSONA_KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  const setMerchantDisplayName = useCallback((s: string) => {
    setMerchantDisplayNameState(s);
    try {
      localStorage.setItem(MERCHANT_NAME_KEY, s);
    } catch {
      /* ignore */
    }
  }, []);

  const setBridgeDisplayName = useCallback((s: string) => {
    setBridgeDisplayNameState(s);
    try {
      localStorage.setItem(BRIDGE_NAME_KEY, s);
    } catch {
      /* ignore */
    }
  }, []);

  const signInAsMerchant = useCallback(
    (displayName?: string) => {
      if (displayName?.trim()) {
        setMerchantDisplayName(displayName.trim());
      }
      setPersona("merchant");
    },
    [setMerchantDisplayName, setPersona]
  );

  const signInAsBridge = useCallback(
    (displayName?: string) => {
      if (displayName?.trim()) {
        setBridgeDisplayName(displayName.trim());
      }
      setPersona("bridge");
    },
    [setBridgeDisplayName, setPersona]
  );

  const signOutToOperator = useCallback(() => {
    setPersona("operator");
  }, [setPersona]);

  const value = useMemo(
    () => ({
      persona,
      setPersona,
      merchantDisplayName,
      setMerchantDisplayName,
      bridgeDisplayName,
      setBridgeDisplayName,
      signInAsMerchant,
      signInAsBridge,
      signOutToOperator,
    }),
    [
      persona,
      setPersona,
      merchantDisplayName,
      setMerchantDisplayName,
      bridgeDisplayName,
      setBridgeDisplayName,
      signInAsMerchant,
      signInAsBridge,
      signOutToOperator,
    ]
  );

  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaContextValue {
  const ctx = useContext(PersonaContext);
  if (!ctx) {
    throw new Error("usePersona must be used within PersonaProvider");
  }
  return ctx;
}
