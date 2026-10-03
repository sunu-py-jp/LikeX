import type { ConnectorBox, ConnectorPoint } from "../connectors";
import { child, children, localName, type XmlNode } from "./xml";

const SCALE = 100000;
const MARKER = "likexElbow1";
const MAX_POINTS = 64;

/** Editable, open DrawingML polyline in document coordinates. The caller owns
 * xfrm, arrowheads and native connection references. A versioned inert guide
 * distinguishes this supported geometry from arbitrary imported custom paths. */
export function createOfficeElbowConnectorGeometry(points: readonly ConnectorPoint[], bounds: ConnectorBox): string {
  if (!Array.isArray(points) || points.length < 1 || points.length > MAX_POINTS || !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width < 0 || bounds.height < 0)
    throw new TypeError("Office elbow geometry requires finite bounds and 1..64 points");
  const normalized = points.map((point, index) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError("Office elbow coordinates must be finite");
    const dx = point.x - bounds.x, dy = point.y - bounds.y;
    if (dx < 0 || dy < 0 || dx > bounds.width || dy > bounds.height)
      throw new RangeError("Office elbow points must lie inside the provided bounds");
    if (index && point.x !== points[index - 1].x && point.y !== points[index - 1].y)
      throw new TypeError("Office elbow segments must be horizontal or vertical");
    const x = Math.round((bounds.width ? dx / bounds.width : 0) * SCALE);
    const y = Math.round((bounds.height ? dy / bounds.height : 0) * SCALE);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x > SCALE || y > SCALE ||
      (!bounds.width && point.x !== bounds.x) || (!bounds.height && point.y !== bounds.y))
      throw new RangeError("Office elbow points must lie inside the provided bounds");
    return { x, y };
  });
  // Even zero-length lines have a start and end in DrawingML.
  if (normalized.length === 1) normalized.push(normalized[0]);
  for (let index = 1; index < normalized.length; index++) if (normalized[index].x !== normalized[index - 1].x && normalized[index].y !== normalized[index - 1].y)
    throw new TypeError("Office elbow segments must be horizontal or vertical");
  const path = normalized.map((point, index) => `<a:${index ? "lnTo" : "moveTo"}><a:pt x="${point.x}" y="${point.y}"/></a:${index ? "lnTo" : "moveTo"}>`).join("");
  return `<a:custGeom><a:avLst/><a:gdLst><a:gd name="${MARKER}" fmla="val 1"/></a:gdLst><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="w" b="h"/><a:pathLst><a:path w="${SCALE}" h="${SCALE}" fill="none">${path}</a:path></a:pathLst></a:custGeom>`;
}

/** Return normalized (0..1) endpoints only for the validated supported elbow
 * polyline. Apply the owning xfrm afterwards, including flips and rotation. */
export function readOfficeElbowConnectorEndpoints(geometry: XmlNode | undefined): { start: ConnectorPoint; end: ConnectorPoint } | undefined {
  if (!geometry || localName(geometry.name) !== "custGeom" || children(child(geometry, "gdLst"), "gd").filter(node => node.attributes.name === MARKER && node.attributes.fmla === "val 1").length !== 1) return;
  const paths = children(child(geometry, "pathLst"), "path");
  if (paths.length !== 1) return;
  const path = paths[0], width = Number(path.attributes.w), height = Number(path.attributes.h);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || path.attributes.fill !== "none") return;
  const commands = path.children;
  if (commands.length < 2 || commands.length > MAX_POINTS) return;
  const points: ConnectorPoint[] = [];
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    if (localName(command.name) !== (index ? "lnTo" : "moveTo")) return;
    const pointNodes = command.children;
    if (pointNodes.length !== 1 || localName(pointNodes[0].name) !== "pt") return;
    if (!/^\d+$/.test(pointNodes[0].attributes.x ?? "") || !/^\d+$/.test(pointNodes[0].attributes.y ?? "")) return;
    const x = Number(pointNodes[0].attributes.x), y = Number(pointNodes[0].attributes.y);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x > width || y > height) return;
    const point = { x: x / width, y: y / height }, previous = points[index - 1];
    if (previous && previous.x !== point.x && previous.y !== point.y) return;
    points.push(point);
  }
  return { start: points[0], end: points[points.length - 1] };
}
