import { OFFICE_SHAPE_PRESETS } from "../model/core-office-shapes";
import { CONNECTOR_PORTS, connectorLocalToWorld, isConnectorArrowhead, type ConnectorArrowhead, type ConnectorPort } from "../core";
import { getOfficePresetConnectorPort, readOfficeConnectorShapeTag, readOfficeElbowConnectorEndpoints } from "../ooxml";
import { isSlideLine } from "../model/lines";
import type { SlideElement, SlideLineGeometry, SlideShapeKind } from "../model/types";
import { child, children, nonVisual, type Node, type PptxContext, type Relations } from "./pptx-reader";

export const PPTX_SHAPE_KINDS: Readonly<Record<string, SlideShapeKind>> = Object.assign(Object.create(null), {
  ...Object.fromEntries(OFFICE_SHAPE_PRESETS.map(item => [item.preset, item.preset])),
  rightArrow: "arrow", arrow: "arrow", leftArrow: "leftArrow", line: "line", straightConnector1: "line",
});
export function readPptxLineEndpoints(transform: Node, geometry?: Node): SlideLineGeometry {
  const off = child(transform, "off"), ext = child(transform, "ext");
  const box = { x: Number(off?.attributes.x) / 9525, y: Number(off?.attributes.y) / 9525,
    width: Number(ext?.attributes.cx) / 9525, height: Number(ext?.attributes.cy) / 9525,
    rotation: Number(transform.attributes.rot ?? 0) / 60000,
    flipX: ["1", "true"].includes(transform.attributes.flipH ?? ""), flipY: ["1", "true"].includes(transform.attributes.flipV ?? "") };
  const custom = readOfficeElbowConnectorEndpoints(geometry);
  return { start: connectorLocalToWorld({ x: (custom?.start.x ?? 0) * box.width, y: (custom?.start.y ?? 0) * box.height }, box),
    end: connectorLocalToWorld({ x: (custom?.end.x ?? 1) * box.width, y: (custom?.end.y ?? 1) * box.height }, box) };
}
export function readPptxArrowhead(node: Node | undefined, context: PptxContext): ConnectorArrowhead | undefined {
  if (!node) return;
  const raw = node.attributes.type ?? "none", value = raw === "arrow" ? "openArrow" : raw;
  if (!isConnectorArrowhead(value)) { context.warn("未対応の線端の装飾を省略しました"); return; }
  if ([node.attributes.w, node.attributes.len].some(size => size !== undefined && size !== "med"))
    context.warn("線端の装飾サイズを標準サイズへ変更しました", { code: "appearance-adjusted", action: "adjustment" });
  return value;
}

export type PptxConnectionSource = { node: Node; element: SlideElement; scope: Relations };
/** Resolve IDs only after every object in the same Office part has been read. */
export function resolvePptxConnections(elements: SlideElement[], sources: readonly PptxConnectionSource[], context: PptxContext): void {
  const scopes = new Map<Relations, Map<string, PptxConnectionSource | null>>();
  for (const source of sources) {
    const nativeId = nonVisual(source.node)?.attributes.id;
    if (!nativeId) continue;
    let targets = scopes.get(source.scope);
    if (!targets) { targets = new Map(); scopes.set(source.scope, targets); }
    targets.set(nativeId, targets.has(nativeId) ? null : source);
  }
  for (const source of sources) {
    const element = source.element;
    if (!isSlideLine(element) || !element.line) continue;
    const properties = child(child(source.node, "nvCxnSpPr"), "cNvCxnSpPr");
    if (!properties) continue;
    const warning = () => context.warn("接続先または接続点を対応できる図形として解決できない線は、端点の位置を保持して接続を解除しました。", {
      code: "content-approximated", action: "approximation", elementId: element.id, elementName: element.name,
    });
    const binding = (tag: "stCxn" | "endCxn") => {
      const node = child(properties, tag); if (!node) return;
      const target = scopes.get(source.scope)?.get(node.attributes.id), index = Number(node.attributes.idx);
      if (!target || isSlideLine(target.element) || !/^\d+$/.test(node.attributes.idx ?? "") || !Number.isSafeInteger(index)) { warning(); return; }
      const props = child(target.node, "spPr"), geometry = child(props, "custGeom"), customTag = readOfficeConnectorShapeTag(geometry);
      const transform = child(props, "xfrm");
      if ([transform?.attributes.flipH, transform?.attributes.flipV].some(value => value === "1" || value === "true")) { warning(); return; }
      let port: ConnectorPort | undefined;
      if (customTag && (target.element.type === "shape" ? PPTX_SHAPE_KINDS[customTag] === target.element.shape : customTag === target.element.type || customTag === "rect"))
        port = CONNECTOR_PORTS[index];
      else if (!geometry) {
        const preset = child(props, "prstGeom");
        if (preset && !children(child(preset, "avLst"), "gd").length)
          port = getOfficePresetConnectorPort(preset.attributes.prst, index);
      }
      if (!port) { warning(); return; }
      return { targetId: target.element.id, port };
    };
    const start = binding("stCxn"), end = binding("endCxn");
    if (!start && !end) continue;
    const index = elements.findIndex(item => item.id === element.id);
    elements[index] = { ...element, line: {
      start: { ...element.line.start, ...(start ? { binding: start } : {}) },
      end: { ...element.line.end, ...(end ? { binding: end } : {}) },
    } };
  }
}
