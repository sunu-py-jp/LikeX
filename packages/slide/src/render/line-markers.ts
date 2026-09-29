import type { SlideShapeElement } from "../model/types";
import { getSlideShapeGeometry } from "./render-style";

export type SlideLineMarker = { kind: "polygon" | "polyline"; points: readonly (readonly [number, number])[] }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; rotation: number };
/** Shared SVG/PNG geometry. Arrow tips meet the actual endpoint and stay inside the segment direction. */
export function getSlideLineMarkers(element: SlideShapeElement): SlideLineMarker[] {
  if (element.shape !== "line" || !element.strokeWidth || element.stroke === "transparent") return [];
  const line = getSlideShapeGeometry(element);
  if (line.kind !== "line") return [];
  const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1), length = Math.max(8, element.strokeWidth * 4), half = length * .42;
  return (["start", "end"] as const).flatMap(end => {
    const marker = element[end === "start" ? "startArrow" : "endArrow"] ?? "none";
    if (marker === "none") return [];
    const x = end === "start" ? line.x1 : line.x2, y = end === "start" ? line.y1 : line.y2;
    const rotation = angle + (end === "start" ? Math.PI : 0), cos = Math.cos(rotation), sin = Math.sin(rotation);
    const point = (along: number, across: number): readonly [number, number] => [x + along * cos - across * sin, y + along * sin + across * cos];
    if (marker === "oval") { const center = point(-length / 2, 0); return [{ kind: "ellipse", cx: center[0], cy: center[1], rx: length / 2, ry: half, rotation } as SlideLineMarker]; }
    const points = marker === "diamond" ? [[0, 0], [-length / 2, -half], [-length, 0], [-length / 2, half]]
      : marker === "stealth" ? [[0, 0], [-length, -half], [-length * .72, 0], [-length, half]]
      : marker === "openArrow" ? [[-length, -half], [0, 0], [-length, half]] : [[0, 0], [-length, -half], [-length, half]];
    return [{ kind: marker === "openArrow" ? "polyline" : "polygon", points: points.map(([along, across]) => point(along, across)) } as SlideLineMarker];
  });
}
