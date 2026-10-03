import { createOfficeConnectorGeometry, createOfficeElbowConnectorGeometry, readOfficeElbowConnectorEndpoints, readOfficeConnectorShapeTag, getOfficePresetConnectorPort } from "../ooxml";
import { CONNECTOR_PORTS, connectorLocalToWorld, isConnectorArrowhead, type ConnectorEndpoint, type ConnectorPort } from "../model/core-connectors";
import { getDocumentCanvasConnectorRoute, normalizeCanvasAttributes } from "../model/canvas";
import { getOfficeShapeOutline } from "../model/core-office-shapes";
import type { DocumentCanvasAttributes, DocumentCanvasShape, DocumentCanvasConnector } from "../model/types";
import { child, children, attr, localName, descendants, type XmlNode, type Node } from "./docx-reader";
import { writeDocxShape, readDocxShape } from "./docx-shapes";
import { WPG } from "./docx-xml";
const emu = (value: number) => Math.round(value * 9525);
const rgb = (value: string) => value.replace(/^#/, "").toUpperCase();
const bool = (value: string | undefined) => value === "1" || value === "true";
export function writeDocxCanvas(input: DocumentCanvasAttributes, nextId: () => number): string {
  const canvas = normalizeCanvasAttributes(input), id = nextId(), width = emu(canvas.width), height = emu(canvas.height);
  const ids = new Map(canvas.shapes.map(shape => [shape.id, nextId()]));
  const shapes = canvas.shapes.map(shape => {
    const output = writeDocxShape(shape, ids.get(shape.id)!), wsp = /<wps:wsp>.*<\/wps:wsp>/s.exec(output)![0];
    return wsp.replace('<wps:cNvSpPr/>', `<wps:cNvPr id="${ids.get(shape.id)}" name="Shape ${ids.get(shape.id)}"/><wps:cNvSpPr/>`)
      .replace('<a:off x="0" y="0"/>', `<a:off x="${emu(shape.x)}" y="${emu(shape.y)}"/>`)
      .replace(/<a:prstGeom[^>]*>.*?<\/a:prstGeom>/s, createOfficeConnectorGeometry(shape.preset, getOfficeShapeOutline(shape.preset, shape.width!, shape.height!)));
  }).join("");
  const lines = canvas.connectors.map(line => {
    const id = nextId(), route = getDocumentCanvasConnectorRoute(canvas, line), { bounds } = route, start = route.points[0], end = route.points.at(-1)!;
    const connection = (point: ConnectorEndpoint, end: "st" | "end") => point.binding ? `<a:${end}Cxn id="${ids.get(point.binding.targetId)}" idx="${CONNECTOR_PORTS.indexOf(point.binding.port)}"/>` : "";
    const geometry = line.routing === "elbow" ? createOfficeElbowConnectorGeometry(route.points, bounds) : '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>';
    const flip = line.routing === "straight" ? ` flipH="${start.x > end.x ? 1 : 0}" flipV="${start.y > end.y ? 1 : 0}"` : "";
    const head = (value: DocumentCanvasConnector["startArrow"]) => value === "openArrow" ? "arrow" : value ?? "none";
    return `<wps:wsp><wps:cNvPr id="${id}" name="Connector ${id}"/><wps:cNvCnPr>${connection(line.start, "st")}${connection(line.end, "end")}</wps:cNvCnPr><wps:spPr><a:xfrm${flip}><a:off x="${emu(bounds.x)}" y="${emu(bounds.y)}"/><a:ext cx="${emu(bounds.width)}" cy="${emu(bounds.height)}"/></a:xfrm>${geometry}<a:noFill/><a:ln w="${emu(line.strokeWidth!)}"><a:solidFill><a:srgbClr val="${rgb(line.stroke!)}"/></a:solidFill><a:prstDash val="solid"/><a:headEnd type="${head(line.startArrow)}"/><a:tailEnd type="${head(line.endArrow)}"/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>`;
  }).join("");
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="Drawing canvas ${id}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/><a:chOff x="0" y="0"/><a:chExt cx="${width}" cy="${height}"/></a:xfrm></wpg:grpSpPr>${lines}${shapes}</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/** One Word drawing group is one editable document canvas; no private JSON payload is required. */
export function readDocxCanvas(source: XmlNode, warn: (message: string) => void, theme: ReadonlyMap<string, string>): Node | undefined {
  const group = descendants(source, "wgp")[0]; if (!group) return;
  const transform = child(child(group, "grpSpPr"), "xfrm"), extent = descendants(source, "extent")[0] ?? child(transform, "ext"), childExtent = child(transform, "chExt") ?? extent, offset = child(transform, "chOff");
  const width = Number(attr(extent, "cx")) / 9525, height = Number(attr(extent, "cy")) / 9525, sx = width * 9525 / Number(attr(childExtent, "cx")), sy = height * 9525 / Number(attr(childExtent, "cy")), ox = Number(attr(offset, "x") ?? 0), oy = Number(attr(offset, "y") ?? 0);
  if (![width, height].every(value => Number.isFinite(value) && value >= 1 && value <= 16384) || ![sx, sy, ox, oy].every(Number.isFinite) || sx <= 0 || sy <= 0) { warn("寸法や座標系が不正な描画キャンバスを省略しました"); return; }
  if (descendants(source, "anchor").length) warn("浮動配置の描画キャンバスは本文中に配置しました（回り込み・ページ上の位置は保持しません）");
  if (Number(attr(transform, "rot") ?? 0) || bool(attr(transform, "flipH")) || bool(attr(transform, "flipV"))) warn("描画グループ全体の回転・反転は省略しました。各図形の回転・反転は保持します");
  const sources = children(group, "wsp"), shapes: DocumentCanvasShape[] = [], connectors: DocumentCanvasConnector[] = [], duplicateIds = new Set<string>(), targets = new Map<string, { id: string; preset: string; tagged: boolean; adjusted: boolean }>();
  for (const item of group.children) if (!["cNvPr", "cNvGrpSpPr", "grpSpPr", "wsp", "extLst"].includes(localName(item.name))) warn("描画キャンバス内の入れ子グループ・画像・未対応要素を省略しました");
  if (sources.some((item, index) => child(item, "cNvCnPr") && sources.slice(0, index).some(previous => !child(previous, "cNvCnPr")))) warn("キャンバスの接続線は図形の背面に配置しました");
  const toPoint = (x: number, y: number) => ({ x: (x - ox) * sx / 9525, y: (y - oy) * sy / 9525 });
  for (const [index, source] of sources.entries()) {
    if (child(source, "cNvCnPr")) continue;
    const imported = readDocxShape(source, warn, theme); if (!imported) continue;
    const attrs = imported.attrs!, props = child(source, "spPr"), xfrm = child(props, "xfrm"), off = child(xfrm, "off"), point = toPoint(Number(attr(off, "x") ?? 0), Number(attr(off, "y") ?? 0));
    const id = `canvas-shape-${index + 1}`, shape = { ...attrs, id, ...point, width: Number(attrs.width) * sx, height: Number(attrs.height) * sy } as DocumentCanvasShape;
    if (![shape.x, shape.y, shape.width, shape.height].every(value => Number.isFinite(value)) || shape.width! < 1 || shape.height! < 1 || shape.width! > 16384 || shape.height! > 16384 || shape.x < -16384 || shape.y < -16384 || shape.x > 32768 || shape.y > 32768) { warn("キャンバスの座標範囲を超える図形を省略しました"); continue; }
    if (sx !== sy && shape.rotation) warn("縦横比の異なるグループ内の回転図形は近似した寸法で読み込みました");
    shapes.push(shape);
    const officeId = attr(child(source, "cNvPr"), "id");
    if (officeId && !targets.has(officeId) && !duplicateIds.has(officeId)) targets.set(officeId, { id, preset: shape.preset, tagged: !!readOfficeConnectorShapeTag(child(props, "custGeom")), adjusted: !!children(child(child(props, "prstGeom"), "avLst"), "gd").length });
    else if (officeId) { targets.delete(officeId); duplicateIds.add(officeId); warn("重複するOffice図形IDへの接続を解除しました"); }
  }
  for (const [index, source] of sources.entries()) {
    const connection = child(source, "cNvCnPr"); if (!connection) continue;
    const props = child(source, "spPr"), xfrm = child(props, "xfrm"), off = child(xfrm, "off"), ext = child(xfrm, "ext"), p = toPoint(Number(attr(off, "x") ?? 0), Number(attr(off, "y") ?? 0));
    const box = { ...p, width: Number(attr(ext, "cx")) * sx / 9525, height: Number(attr(ext, "cy")) * sy / 9525, rotation: Number(attr(xfrm, "rot") ?? 0) / 60000, flipX: bool(attr(xfrm, "flipH")), flipY: bool(attr(xfrm, "flipV")) };
    if (![box.x, box.y, box.width, box.height, box.rotation].every(Number.isFinite) || box.width < 0 || box.height < 0 || box.width > 32768 || box.height > 32768) { warn("不正な寸法の接続線を省略しました"); continue; }
    const preset = attr(child(props, "prstGeom"), "prst"), custom = readOfficeElbowConnectorEndpoints(child(props, "custGeom"));
    if (!custom && !["line", "straightConnector1", "bentConnector2", "bentConnector3", "bentConnector4", "bentConnector5"].includes(preset ?? "")) { warn("未対応の接続線の形状を省略しました"); continue; }
    const routing = custom || preset?.startsWith("bentConnector") ? "elbow" : "straight";
    if (!custom && routing === "elbow") warn("Officeの折れ線コネクタは接続先に合わせて自動直交ルートを再計算しました");
    const bind = (end: "st" | "end", local: { x: number; y: number }): ConnectorEndpoint => {
      const localBox = { ...box, x: Number(attr(off, "x") ?? 0) / 9525, y: Number(attr(off, "y") ?? 0) / 9525, width: box.width / sx, height: box.height / sy };
      // DrawingML transforms a child first, then maps it through the group.
      // Scaling the child box before rotation is wrong for non-uniform groups.
      const transformed = connectorLocalToWorld({ x: local.x * localBox.width, y: local.y * localBox.height }, localBox);
      const point = toPoint(transformed.x * 9525, transformed.y * 9525), binding = child(connection, `${end}Cxn`), target = targets.get(attr(binding, "id") ?? ""), site = Number(attr(binding, "idx"));
      const port: ConnectorPort | undefined = target && !target.adjusted ? target.tagged ? CONNECTOR_PORTS[site] : getOfficePresetConnectorPort(target.preset, site) : undefined;
      if (target && port) return { ...point, binding: { targetId: target.id, port } };
      if (binding) warn("対応できない接続先・接続点の関連を解除し、線端の位置を保持しました");
      return point;
    };
    const line = child(props, "ln"), solid = child(line, "solidFill") ?? child(child(source, "style"), "lnRef");
    const direct = child(solid, "srgbClr"), scheme = child(solid, "schemeClr"), system = child(solid, "sysClr"), colorNode = direct ?? scheme ?? system;
    const rawColor = attr(direct, "val") ?? attr(system, "lastClr") ?? theme.get(attr(scheme, "val") ?? "");
    if (colorNode?.children.length) warn("接続線の色の透明度・濃淡調整を省略しました");
    if (solid && (!rawColor || !/^[a-f\d]{6}$/i.test(rawColor))) warn("解決できない接続線の色を既定色へ変換しました");
    const arrow = (end: "head" | "tail") => {
      const node = child(line, `${end}End`), value = attr(node, "type") ?? "none", kind = value === "arrow" ? "openArrow" : value;
      if (["w", "len"].some(key => attr(node, key) !== undefined && attr(node, key) !== "med")) warn("接続線の矢印の幅・長さを標準サイズへ変換しました");
      if (isConnectorArrowhead(kind)) return kind; warn("未対応の線端を装飾なしで読み込みました"); return "none";
    };
    if (child(line, "prstDash") && attr(child(line, "prstDash"), "val") !== "solid" || child(line, "custDash") || ["gradFill", "pattFill", "blipFill", "noFill"].some(key => child(line, key))) warn("接続線の特殊な書式は単色実線へ変換しました");
    if (attr(line, "cmpd") && attr(line, "cmpd") !== "sng" || attr(line, "cap") && attr(line, "cap") !== "flat" || child(line, "round") || child(line, "bevel")) warn("接続線の複合線・端・角の書式を標準形状へ変換しました");
    if (child(props, "effectDag") || child(props, "scene3d") || child(props, "sp3d") || child(props, "effectLst")?.children.length) warn("接続線の影・立体・視覚効果を省略しました");
    if (child(source, "txbx")) warn("接続線内のテキストは未対応のため省略しました");
    const strokeWidth = Number(attr(line, "w") ?? 19050) / 9525;
    if (!Number.isFinite(strokeWidth) || strokeWidth < 0 || strokeWidth > 100) warn("接続線の線幅を既定値に変換しました");
    const start = bind("st", custom?.start ?? { x: 0, y: 0 }), end = bind("end", custom?.end ?? { x: 1, y: 1 });
    if (![start.x, start.y, end.x, end.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1_000_000)) { warn("座標範囲を超える接続線を省略しました"); continue; }
    connectors.push({ id: `canvas-connector-${index + 1}`, start, end, routing, stroke: rawColor && /^[a-f\d]{6}$/i.test(rawColor) ? `#${rawColor}` : "#334155", strokeWidth: Number.isFinite(strokeWidth) && strokeWidth >= 0 && strokeWidth <= 100 ? strokeWidth : 2, startArrow: arrow("head"), endArrow: arrow("tail") });
  }
  return { type: "drawing_canvas", attrs: normalizeCanvasAttributes({ width, height, shapes, connectors }) };
}
