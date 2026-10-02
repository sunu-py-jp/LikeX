/** Unzoomed document coordinates; the owning model defines the document origin. */
export type ConnectorPoint = Readonly<{ x: number; y: number }>;
/** Clockwise order, beginning at the top edge midpoint, before rotation or flips. */
export const CONNECTOR_PORTS = Object.freeze([
  "top", "topRight", "right", "bottomRight", "bottom", "bottomLeft", "left", "topLeft",
] as const);
export type ConnectorPort = typeof CONNECTOR_PORTS[number];
export const CONNECTOR_ARROWHEADS = Object.freeze(["none", "triangle", "openArrow", "diamond", "oval", "stealth"] as const);
export type ConnectorArrowhead = typeof CONNECTOR_ARROWHEADS[number];
export type ConnectorBinding = Readonly<{ targetId: string; port: ConnectorPort }>;
export type ConnectorEndpoint = ConnectorPoint & Readonly<{ binding?: ConnectorBinding }>;
/** Rotation is clockwise in degrees around the box centre. Flips precede rotation. */
export type ConnectorBox = ConnectorPoint & Readonly<{
  width: number; height: number; rotation?: number; flipX?: boolean; flipY?: boolean;
}>;
/** Numeric path data, never executable SVG or imported formula strings. */
export type ConnectorPathCommand = Readonly<{ type: "move" | "line"; x: number; y: number }>
  | Readonly<{ type: "cubic"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }>
  | Readonly<{ type: "close" }>;
export type ConnectorPath = Readonly<{ commands: readonly ConnectorPathCommand[]; fill?: boolean; stroke?: boolean }>;
/** Outline points/radii are normalized to 0..1 before box size, flips and rotation. */
export type ConnectorOutline = Readonly<{ type: "ellipse" }>
  | Readonly<{ type: "polygon"; points: readonly ConnectorPoint[] }>
  | Readonly<{ type: "roundedRect"; radiusX: number; radiusY: number }>
  | Readonly<{ type: "paths"; paths: readonly ConnectorPath[]; ports: readonly ConnectorPoint[];
    textRect: Readonly<{ left: number; top: number; width: number; height: number }> }>;
export type ConnectorPortPoint = Readonly<{ port: ConnectorPort; point: ConnectorPoint }>;
export type ConnectorTarget = Readonly<{ id: string; box: ConnectorBox; outline?: ConnectorOutline }>;
export type ConnectorSnap = Readonly<{ point: ConnectorPoint; binding: ConnectorBinding; distance: number }>;

export function isConnectorPort(value: unknown): value is ConnectorPort {
  return typeof value === "string" && (CONNECTOR_PORTS as readonly string[]).includes(value);
}
export function isConnectorArrowhead(value: unknown): value is ConnectorArrowhead {
  return typeof value === "string" && (CONNECTOR_ARROWHEADS as readonly string[]).includes(value);
}

function assertPoint(point: ConnectorPoint): void {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new TypeError("Connector coordinates must be finite numbers");
}
function assertBox(box: ConnectorBox): void {
  assertPoint(box);
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width < 0 || box.height < 0 ||
    (box.rotation !== undefined && !Number.isFinite(box.rotation)) ||
    (box.flipX !== undefined && typeof box.flipX !== "boolean") ||
    (box.flipY !== undefined && typeof box.flipY !== "boolean"))
    throw new TypeError("Connector boxes require nonnegative finite dimensions, finite rotation and boolean flips");
}
function pointResult(x: number, y: number): ConnectorPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError("Connector coordinates exceed the finite number range");
  return { x, y };
}
function rotation(box: ConnectorBox): readonly [number, number] {
  const degrees = ((box.rotation ?? 0) % 360 + 360) % 360;
  // Exact quarter turns avoid tiny coordinate drift during repeated edits.
  if (degrees === 0) return [1, 0];
  if (degrees === 90) return [0, 1];
  if (degrees === 180) return [-1, 0];
  if (degrees === 270) return [0, -1];
  const radians = degrees * Math.PI / 180;
  return [Math.cos(radians), Math.sin(radians)];
}
function localToWorld(point: ConnectorPoint, box: ConnectorBox): ConnectorPoint {
  const [cos, sin] = rotation(box);
  const x = (point.x - box.width / 2) * (box.flipX ? -1 : 1);
  const y = (point.y - box.height / 2) * (box.flipY ? -1 : 1);
  return pointResult(box.x + box.width / 2 + x * cos - y * sin,
    box.y + box.height / 2 + x * sin + y * cos);
}

/** Convert a local point (origin at the untransformed box top-left) to document coordinates. */
export function connectorLocalToWorld(point: ConnectorPoint, box: ConnectorBox): ConnectorPoint {
  assertPoint(point); assertBox(box);
  return localToWorld(point, box);
}

/** Inverse of connectorLocalToWorld; points outside the box are also supported. */
export function connectorWorldToLocal(point: ConnectorPoint, box: ConnectorBox): ConnectorPoint {
  assertPoint(point); assertBox(box);
  const [cos, sin] = rotation(box);
  const x = point.x - (box.x + box.width / 2), y = point.y - (box.y + box.height / 2);
  return pointResult((x * cos + y * sin) * (box.flipX ? -1 : 1) + box.width / 2,
    (-x * sin + y * cos) * (box.flipY ? -1 : 1) + box.height / 2);
}

const PORT_FRACTIONS: Readonly<Record<ConnectorPort, ConnectorPoint>> = {
  top: { x: 0.5, y: 0 }, topRight: { x: 1, y: 0 }, right: { x: 1, y: 0.5 }, bottomRight: { x: 1, y: 1 },
  bottom: { x: 0.5, y: 1 }, bottomLeft: { x: 0, y: 1 }, left: { x: 0, y: 0.5 }, topLeft: { x: 0, y: 0 },
};

const EPSILON = 1e-10;
function containsPoint(points: readonly ConnectorPoint[], point: ConnectorPoint): boolean {
  let inside = false;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) <= EPSILON && point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON &&
      point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function assertOutline(outline: ConnectorOutline | undefined): void {
  if (outline === undefined || outline?.type === "ellipse") return;
  if (outline?.type === "paths") {
    if (!Array.isArray(outline.ports) || outline.ports.length !== CONNECTOR_PORTS.length ||
      !Array.isArray(outline.paths) || !outline.paths.length || outline.paths.length > 32)
      throw new TypeError("Path outlines require eight ports and bounded paths");
    for (const point of outline.ports) {
      assertPoint(point);
      if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new TypeError("Path ports must be normalized to 0..1");
    }
    const rect = outline.textRect;
    if (!rect || ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0)
      throw new TypeError("Path text rectangles require finite coordinates and nonnegative dimensions");
    for (const path of outline.paths) {
      if (!Array.isArray(path.commands) || !path.commands.length || path.commands.length > 512 || path.commands[0].type !== "move" ||
        (path.fill !== undefined && typeof path.fill !== "boolean") || (path.stroke !== undefined && typeof path.stroke !== "boolean"))
        throw new TypeError("Invalid connector path");
      for (const command of path.commands) {
        if (command.type === "close") continue;
        if (command.type !== "move" && command.type !== "line" && command.type !== "cubic") throw new TypeError("Unknown connector path command");
        assertPoint(command);
        if (command.type === "cubic") {
          assertPoint({ x: command.x1, y: command.y1 }); assertPoint({ x: command.x2, y: command.y2 });
        }
      }
    }
    return;
  }
  if (outline?.type === "roundedRect") {
    if ([outline.radiusX, outline.radiusY].every(value => Number.isFinite(value) && value >= 0 && value <= 0.5)) return;
    throw new TypeError("Rounded connector outlines require normalized radii between 0 and 0.5");
  }
  if (outline?.type !== "polygon" || !Array.isArray(outline.points) || outline.points.length < 3)
    throw new TypeError("Unknown connector outline or invalid polygon");
  for (const point of outline.points) {
    assertPoint(point);
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new TypeError("Connector polygon points must be normalized to 0..1");
  }
  const area = outline.points.reduce((sum, a, index) => {
    const b = outline.points[(index + 1) % outline.points.length];
    return sum + a.x * b.y - a.y * b.x;
  }, 0);
  if (Math.abs(area) <= EPSILON || !containsPoint(outline.points, { x: 0.5, y: 0.5 }))
    throw new TypeError("Connector polygons must enclose a nonzero area and contain the box centre");
}
function polygonPort(points: readonly ConnectorPoint[], fraction: ConnectorPoint): ConnectorPoint {
  const dx = fraction.x - 0.5, dy = fraction.y - 0.5;
  let distance = Infinity, touchesOrigin = false;
  const include = (t: number) => {
    if (Math.abs(t) <= EPSILON) touchesOrigin = true;
    else if (t > EPSILON) distance = Math.min(distance, t);
  };
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    const sx = b.x - a.x, sy = b.y - a.y, ax = a.x - 0.5, ay = a.y - 0.5;
    const denominator = dx * sy - dy * sx;
    if (Math.abs(denominator) <= EPSILON) {
      if (Math.abs(ax * dy - ay * dx) <= EPSILON) {
        const length = dx * dx + dy * dy;
        const first = (ax * dx + ay * dy) / length, last = ((b.x - 0.5) * dx + (b.y - 0.5) * dy) / length;
        include(first); include(last);
        if (Math.min(first, last) <= 0 && Math.max(first, last) >= 0) touchesOrigin = true;
      }
      continue;
    }
    const t = (ax * sy - ay * sx) / denominator, u = (ax * dy - ay * dx) / denominator;
    if (t >= -EPSILON && u >= -EPSILON && u <= 1 + EPSILON) include(t);
  }
  // If the centre lies on an edge, follow inward/tangent rays to the next edge
  // or vertex; only outward rays stay at the centre boundary point.
  if (touchesOrigin) {
    const probe = Math.min(1e-7, distance / 2);
    if (!containsPoint(points, { x: 0.5 + dx * probe, y: 0.5 + dy * probe })) distance = 0;
  }
  if (!Number.isFinite(distance)) throw new TypeError("Connector polygon has no boundary in this direction");
  return { x: 0.5 + dx * distance, y: 0.5 + dy * distance };
}
function portFraction(port: ConnectorPort, outline: ConnectorOutline | undefined): ConnectorPoint {
  const fraction = PORT_FRACTIONS[port];
  if (!outline) return fraction;
  if (outline.type === "paths") return outline.ports[CONNECTOR_PORTS.indexOf(port)];
  if (outline.type === "polygon") return polygonPort(outline.points, fraction);
  const dx = fraction.x - 0.5, dy = fraction.y - 0.5;
  if (outline.type === "ellipse") {
    const scale = 0.5 / Math.hypot(dx, dy);
    return { x: 0.5 + dx * scale, y: 0.5 + dy * scale };
  }
  if (dx === 0 || dy === 0) return fraction;
  return { x: fraction.x - Math.sign(dx) * outline.radiusX * (1 - Math.SQRT1_2),
    y: fraction.y - Math.sign(dy) * outline.radiusY * (1 - Math.SQRT1_2) };
}

/** Return an outline port, preserving its local identity when the shape turns or flips. */
export function getConnectorPortPoint(box: ConnectorBox, port: ConnectorPort, outline?: ConnectorOutline): ConnectorPoint {
  assertBox(box); assertOutline(outline);
  if (!isConnectorPort(port)) throw new TypeError("Unknown connector port");
  const fraction = portFraction(port, outline);
  return localToWorld({ x: fraction.x * box.width, y: fraction.y * box.height }, box);
}

/** The array order always matches CONNECTOR_PORTS, including coincident ports on a zero-size box. */
export function getConnectorPortPoints(box: ConnectorBox, outline?: ConnectorOutline): readonly ConnectorPortPoint[] {
  assertBox(box); assertOutline(outline);
  return CONNECTOR_PORTS.map(port => {
    const fraction = portFraction(port, outline);
    return { port, point: localToWorld({ x: fraction.x * box.width, y: fraction.y * box.height }, box) };
  });
}

/** Zero width/height is intentional for vertical/horizontal lines. Does not reorder the endpoints. */
export function getConnectorBounds(start: ConnectorPoint, end: ConnectorPoint): ConnectorBox {
  assertPoint(start); assertPoint(end);
  const width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new RangeError("Connector bounds exceed the finite number range");
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height };
}

/** Threshold uses document units. Ties keep target order, then CONNECTOR_PORTS order. */
export function findNearestConnectorPort(point: ConnectorPoint, targets: readonly ConnectorTarget[], maxDistance: number): ConnectorSnap | undefined {
  assertPoint(point);
  if (!Number.isFinite(maxDistance) || maxDistance < 0) throw new TypeError("Connector snap distance must be nonnegative and finite");
  let best: ConnectorSnap | undefined;
  for (const target of targets) {
    if (!target || typeof target.id !== "string" || !target.id) throw new TypeError("Connector targets require a nonempty id");
    for (const candidate of getConnectorPortPoints(target.box, target.outline)) {
      const distance = Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y);
      if (distance <= maxDistance && (!best || distance < best.distance))
        best = { point: candidate.point, binding: { targetId: target.id, port: candidate.port }, distance };
    }
  }
  return best;
}
