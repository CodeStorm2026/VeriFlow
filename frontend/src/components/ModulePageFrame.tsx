import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

interface ModulePageFrameProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  actions?: ReactNode;
}

export default function ModulePageFrame({
  eyebrow,
  title,
  subtitle,
  children,
  actions,
}: ModulePageFrameProps) {
  return (
    <div className="space-y-6">
      <nav className="text-xs text-slate-500" aria-label="Breadcrumb">
        <NavLink to="/" className="font-medium text-teal-700 hover:underline">
          Dashboard
        </NavLink>
        <span className="mx-1.5 text-slate-400">/</span>
        <span className="text-slate-600">{title}</span>
      </nav>

      <header className="space-y-2">
        <div className="vf-detail-eyebrow">{eyebrow}</div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? (
          <p className="vf-subtle max-w-2xl text-sm leading-snug text-slate-600">{subtitle}</p>
        ) : null}
      </header>

      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}

      <div className="space-y-6">{children}</div>
    </div>
  );
}
