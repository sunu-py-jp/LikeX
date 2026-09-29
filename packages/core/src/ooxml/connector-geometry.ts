import { getConnectorPortPoints, type ConnectorOutline, type ConnectorPort } from "../connectors";
import { child, children, type XmlNode } from "./xml";

const SCALE = 100000;
const portGuide = "likexPorts8", shapePrefix = "likexShape_";
const coordinate = (value: number) => Math.round(value * SCALE);
const pointXml = (x: number, y: number) => `<a:pt x="${coordinate(x)}" y="${coordinate(y)}"/>`;
const move = (x: number, y: number) => `<a:moveTo>${pointXml(x, y)}</a:moveTo>`;
const line = (x: number, y: number) => `<a:lnTo>${pointXml(x, y)}</a:lnTo>`;
const arc = (rx: number, ry: number, start: number) => `<a:arcTo wR="${coordinate(rx)}" hR="${coordinate(ry)}" stAng="${start * 60000}" swAng="5400000"/>`;

/** Standard DrawingML custom geometry. shapeTag identifies the owning module's
 * supported shape; it is an inert, validated guide name, not executable data. */
export function createOfficeConnectorGeometry(shapeTag: string, outline?: ConnectorOutline): string {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(shapeTag)) throw new TypeError("Office connector shape tags must be short identifiers");
  const ports = getConnectorPortPoints({ x: 0, y: 0, width: 1, height: 1 }, outline);
  const guides = ports.map(({ point }, index) => `<a:gd name="lxPort${index}x" fmla="*/ w ${coordinate(point.x)} ${SCALE}"/><a:gd name="lxPort${index}y" fmla="*/ h ${coordinate(point.y)} ${SCALE}"/>`).join("");
  const connections = ports.map((_port, index) => `<a:cxn ang="${((270 + index * 45) % 360) * 60000}"><a:pos x="lxPort${index}x" y="lxPort${index}y"/></a:cxn>`).join("");
  let path: string;
  if (outline?.type === "ellipse") path = move(0, 0.5) + [180, 270, 0, 90].map(angle => arc(0.5, 0.5, angle)).join("");
  else if (outline?.type === "polygon") path = outline.points.map((point, index) => (index ? line : move)(point.x, point.y)).join("");
  else if (outline?.type === "roundedRect" && outline.radiusX && outline.radiusY) {
    const { radiusX: x, radiusY: y } = outline;
    path = move(x, 0) + line(1 - x, 0) + arc(x, y, 270) + line(1, 1 - y) + arc(x, y, 0) +
      line(x, 1) + arc(x, y, 90) + line(0, y) + arc(x, y, 180);
  } else path = move(0, 0) + line(1, 0) + line(1, 1) + line(0, 1);
  return `<a:custGeom><a:avLst/><a:gdLst><a:gd name="${portGuide}" fmla="val 1"/><a:gd name="${shapePrefix}${shapeTag}" fmla="val 1"/>${guides}</a:gdLst><a:ahLst/><a:cxnLst>${connections}</a:cxnLst><a:rect l="0" t="0" r="w" b="h"/><a:pathLst><a:path w="${SCALE}" h="${SCALE}">${path}<a:close/></a:path></a:pathLst></a:custGeom>`;
}

/** Recognize only our versioned eight-port geometry. Each module still checks
 * the returned tag against its own supported shapes before accepting it. */
export function readOfficeConnectorShapeTag(geometry: XmlNode | undefined): string | undefined {
  if (!geometry) return;
  const guides = children(child(geometry, "gdLst"), "gd");
  if (guides.filter(node => node.attributes.name === portGuide && node.attributes.fmla === "val 1").length !== 1 ||
    children(child(geometry, "cxnLst"), "cxn").length !== 8) return;
  const tags = guides.filter(node => node.attributes.name?.startsWith(shapePrefix) && node.attributes.fmla === "val 1");
  if (tags.length !== 1) return;
  const tag = tags[0].attributes.name.slice(shapePrefix.length);
  return /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(tag) ? tag : undefined;
}

/** DrawingML preset site order differs from our eight-port order. This covers
 * unchanged standard presets only; callers must reject adjusted/custom sites.
 * Site definitions: Apache POI's primary presetShapeDefinitions.xml resource. */
export function getOfficePresetConnectorPort(preset: string, index: number): ConnectorPort | undefined {
  if (!Number.isInteger(index) || index < 0) return;
  const cardinal: readonly ConnectorPort[] = ["top", "left", "bottom", "right"];
  if (["rect", "roundRect", "diamond"].includes(preset)) return cardinal[index];
  if (preset === "ellipse") return (["top", "topLeft", "left", "bottomLeft", "bottom", "bottomRight", "right", "topRight"] as const)[index];
  if (preset === "triangle") return (["top", "left", "bottomLeft", "bottom", "bottomRight", "right"] as const)[index];
  // Arrow shoulder sites are not our radial outline ports; do not invent a binding.
  if (preset === "rightArrow" || preset === "leftArrow") return index === 1 ? "left" : index === 3 ? "right" : undefined;
}
