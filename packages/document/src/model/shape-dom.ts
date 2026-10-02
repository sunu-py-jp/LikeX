import type { DOMOutputSpec } from "prosemirror-model";
import { getOfficeShapeGeometry, OFFICE_SHAPE_PRESETS, type OfficeShapePreset } from "./core-office-shapes";

/** The editable shape remains a node, not a rasterized picture. Text is rendered by the browser. */
export function shapeDom(attrs: Record<string, unknown>): DOMOutputSpec {
  const width = Number(attrs.width), height = Number(attrs.height);
  const geometry = getOfficeShapeGeometry(attrs.preset as OfficeShapePreset, width, height), rect = geometry.textRect;
  const label = OFFICE_SHAPE_PRESETS.find(item => item.preset === attrs.preset)?.label ?? "図形";
  return ["div", { "data-document-shape": "true", "data-document-id": attrs.id, "data-shape-attrs": JSON.stringify(attrs), class: "lxd-shape", contenteditable: "false", role: "img", "aria-label": `${label}${attrs.text ? `: ${attrs.text}` : ""}`, style: `width:${width}px;height:${height}px` },
    ["div", { class: "lxd-shape-content", style: `transform:rotate(${attrs.rotation}deg) scale(${attrs.flipH ? -1 : 1},${attrs.flipV ? -1 : 1})` },
      ["http://www.w3.org/2000/svg svg", { width, height, viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" },
        ...geometry.paths.map(path => ["http://www.w3.org/2000/svg path", { d: path.d, fill: path.fill === false ? "none" : attrs.fill ?? "none", stroke: path.stroke === false ? "none" : attrs.stroke ?? "none", "stroke-width": attrs.strokeWidth, "stroke-linejoin": "round" }] as DOMOutputSpec)],
      ["div", { class: "lxd-shape-text", style: `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;color:${attrs.color};font-size:${attrs.fontSize}pt` }, String(attrs.text ?? "")],
    ],
  ];
}
