import { CONNECTOR_PORTS, getConnectorBounds, type ConnectorBinding, type ConnectorArrowhead } from "../core";
import { createOfficeConnectorGeometry } from "../ooxml";
import { getSlideConnectorOutline, getSlideLineEndpoints } from "../model/lines";
import type { SlideElement, SlideShapeElement } from "../model/types";
import { emu, fill, xml } from "./pptx-xml";

export function pptxConnectorTargetGeometry(element: SlideElement): string {
  return createOfficeConnectorGeometry(element.type === "shape" ? element.shape : element.type, getSlideConnectorOutline(element));
}
export function pptxLineArrowheads(element: SlideShapeElement): string {
  const marker = (kind: "headEnd" | "tailEnd", value: ConnectorArrowhead | undefined) =>
    `<a:${kind} type="${value === "openArrow" ? "arrow" : value ?? "none"}" w="med" len="med"/>`;
  return marker("headEnd", element.startArrow) + marker("tailEnd", element.endArrow);
}
export function pptxConnectorXml(element: SlideShapeElement, id: number, shapeIds: ReadonlyMap<string, number>, nonVisualProperties = "<p:nvPr/>"): string {
  const { start, end } = getSlideLineEndpoints(element), bounds = getConnectorBounds(start, end);
  const connection = (tag: "stCxn" | "endCxn", binding: ConnectorBinding | undefined) => {
    if (!binding) return "";
    const targetId = shapeIds.get(binding.targetId);
    if (targetId === undefined) throw new Error("PowerPointの線の接続先を解決できません");
    return `<a:${tag} id="${targetId}" idx="${CONNECTOR_PORTS.indexOf(binding.port)}"/>`;
  };
  const locks = element.locked ? '<a:cxnSpLocks noMove="1" noResize="1" noRot="1"/>' : "";
  const transform = `<a:xfrm${end.x < start.x ? ' flipH="1"' : ""}${end.y < start.y ? ' flipV="1"' : ""}><a:off x="${emu(bounds.x)}" y="${emu(bounds.y)}"/><a:ext cx="${emu(bounds.width)}" cy="${emu(bounds.height)}"/></a:xfrm>`;
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${xml(element.name)}"/><p:cNvCxnSpPr>${locks}${connection("stCxn", start.binding)}${connection("endCxn", end.binding)}</p:cNvCxnSpPr>${nonVisualProperties}</p:nvCxnSpPr><p:spPr>${transform}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${fill(element.fill, element.opacity)}<a:ln w="${emu(element.strokeWidth)}">${fill(element.stroke, element.opacity)}<a:prstDash val="solid"/>${pptxLineArrowheads(element)}</a:ln></p:spPr></p:cxnSp>`;
}
