import type { ConnectorArrowhead } from "../../core";

/** Arrow tips coincide with endpoints; auto-start-reverse also handles reversed lines. */
export function LineMarker({ id, kind, color }: { id: string; kind: ConnectorArrowhead; color: string }) {
  if (kind === "none") return null;
  return <marker id={id} viewBox="0 0 10 10" markerWidth="6" markerHeight="6" refX="10" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth">
    {kind === "oval" ? <ellipse cx="5" cy="5" rx="5" ry="4" fill={color} />
      : kind === "openArrow" ? <path d="M1 1 9 5 1 9" fill="none" stroke={color} strokeWidth="1.4" />
      : <path d={kind === "diamond" ? "M10 5 5 0 0 5 5 10Z" : kind === "stealth" ? "M10 5 0 0 3 5 0 10Z" : "M10 5 0 0 0 10Z"} fill={color} />}
  </marker>;
}
