"use client";

import { useId } from "react";
import type { SpreadsheetShapeDrawing } from "../../model/types";
import { getShapeDefinition, shapeBodyFrame } from "../../model/shapes";

/** The insertion gallery and sheet use identical geometry, with unscaled outline widths. */
export function Shape({ drawing }: { drawing: SpreadsheetShapeDrawing }) {
  const marker = useId().replace(/:/g, "");
  const stroke = drawing.strokeWidth;
  const geometry = getShapeDefinition(drawing.shape).geometry;
  const frame = shapeBodyFrame(drawing.shape, drawing.width, drawing.height, stroke);
  const paint = { fill: drawing.fill, stroke: drawing.stroke, strokeWidth: stroke, strokeLinejoin: "round" as const };
  return <svg className="lxs-shape" width="100%" height="100%" viewBox={`0 0 ${drawing.width} ${drawing.height}`} aria-hidden="true" overflow="visible"
    style={{ transform: `scale(${drawing.flipX ? -1 : 1}, ${drawing.flipY ? -1 : 1})`, transformOrigin: "center" }}>
    {geometry.type === "line" && geometry.arrow && <defs><marker id={marker} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 9 4.5 0 9 2 4.5Z" fill={drawing.stroke} /></marker></defs>}
    {geometry.type === "rectangle" && <rect {...frame} rx={geometry.rounded ? Math.min(frame.width, frame.height) * 16667 / 100000 : undefined} {...paint} />}
    {geometry.type === "ellipse" && <ellipse cx={drawing.width / 2} cy={drawing.height / 2} rx={frame.width / 2} ry={frame.height / 2} {...paint} />}
    {geometry.type === "polygon" && <polygon points={geometry.points.map(([x, y]) => `${frame.x + frame.width * x},${frame.y + frame.height * y}`).join(" ")} {...paint} />}
    {geometry.type === "line" && <line x1={Math.max(stroke, 4)} y1={Math.max(stroke, 4)}
      x2={Math.max(stroke, drawing.width - (geometry.arrow ? stroke * 7 : stroke))}
      y2={Math.max(stroke, drawing.height - (geometry.arrow ? stroke * 7 : stroke))}
      stroke={drawing.stroke} strokeWidth={stroke} markerEnd={geometry.arrow ? `url(#${marker})` : undefined} />}
  </svg>;
}
