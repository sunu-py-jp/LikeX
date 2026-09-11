import type { ReactNode } from "react";

/** A ribbon section keeps related controls together and names them visually and accessibly. */
export function RibbonGroup({ label, children, className = "" }: {
  label: string; children: ReactNode; className?: string;
}) {
  return <section className={`lxs-ribbon-group ${className}`} role="group" aria-label={label}>
    <div className="lxs-ribbon-group-body">{children}</div>
    <div className="lxs-ribbon-group-label" aria-hidden="true">{label}</div>
  </section>;
}
