import test from "node:test";
import assert from "node:assert/strict";
import { CONNECTOR_PORTS, CONNECTOR_ARROWHEADS, isConnectorPort, isConnectorArrowhead, getConnectorPortPoint, getConnectorPortPoints,
  connectorLocalToWorld, connectorWorldToLocal, getConnectorBounds, findNearestConnectorPort } from "../src/connectors.ts";

const box = Object.freeze({ x: 10, y: 20, width: 100, height: 60 });
function close(actual, expected) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `x: ${actual.x} !== ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `y: ${actual.y} !== ${expected.y}`);
}

test("ports have fixed clockwise identities and the eight expected bounding-box positions", () => {
  assert.deepEqual(CONNECTOR_PORTS, ["top", "topRight", "right", "bottomRight", "bottom", "bottomLeft", "left", "topLeft"]);
  assert.equal(Object.isFrozen(CONNECTOR_PORTS), true);
  assert.deepEqual(getConnectorPortPoints(box), [
    { port: "top", point: { x: 60, y: 20 } }, { port: "topRight", point: { x: 110, y: 20 } },
    { port: "right", point: { x: 110, y: 50 } }, { port: "bottomRight", point: { x: 110, y: 80 } },
    { port: "bottom", point: { x: 60, y: 80 } }, { port: "bottomLeft", point: { x: 10, y: 80 } },
    { port: "left", point: { x: 10, y: 50 } }, { port: "topLeft", point: { x: 10, y: 20 } },
  ]);
  assert.deepEqual(getConnectorPortPoint(box, "bottomLeft"), { x: 10, y: 80 });
  for (const port of CONNECTOR_PORTS) assert.equal(isConnectorPort(port), true);
  for (const port of [null, 1, "Top", "center", "__proto__"]) assert.equal(isConnectorPort(port), false);
  assert.deepEqual(CONNECTOR_ARROWHEADS, ["none", "triangle", "openArrow", "diamond", "oval", "stealth"]);
  for (const arrow of CONNECTOR_ARROWHEADS) assert.equal(isConnectorArrowhead(arrow), true);
  for (const arrow of [null, "arrow", "rectangle"]) assert.equal(isConnectorArrowhead(arrow), false);
});

test("port identity follows clockwise rotation and both flips in local coordinates", () => {
  assert.deepEqual(getConnectorPortPoint({ ...box, rotation: 90 }, "top"), { x: 90, y: 50 });
  assert.deepEqual(getConnectorPortPoint({ ...box, rotation: -90 }, "top"), { x: 30, y: 50 });
  assert.deepEqual(getConnectorPortPoint({ ...box, rotation: 450 }, "top"), { x: 90, y: 50 });
  assert.deepEqual(getConnectorPortPoint({ ...box, flipX: true }, "topLeft"), { x: 110, y: 20 });
  assert.deepEqual(getConnectorPortPoint({ ...box, flipY: true }, "topLeft"), { x: 10, y: 80 });
  assert.deepEqual(getConnectorPortPoint({ ...box, flipX: true, flipY: true, rotation: 90 }, "topLeft"), { x: 30, y: 100 });
  close(getConnectorPortPoint({ x: 0, y: 0, width: 20, height: 20, rotation: 45 }, "top"),
    { x: 10 + Math.sqrt(50), y: 10 - Math.sqrt(50) });
});

test("world/local transforms are inverse across non-square, flipped, rotated and outside points", () => {
  for (const rotation of [-721, -90, 0, 33, 90, 180, 271, 720]) {
    for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const geometry = { ...box, rotation, flipX, flipY };
      for (const point of [{ x: 0, y: 0 }, { x: 50, y: 30 }, { x: 100, y: 60 }, { x: -25, y: 140 }])
        close(connectorWorldToLocal(connectorLocalToWorld(point, geometry), geometry), point);
    }
  }
});

test("bounds preserve both endpoint directions and zero dimensions without padding", () => {
  assert.deepEqual(getConnectorBounds({ x: 90, y: -20 }, { x: -10, y: 30 }), { x: -10, y: -20, width: 100, height: 50 });
  assert.deepEqual(getConnectorBounds({ x: 2, y: 3 }, { x: 2, y: 40 }), { x: 2, y: 3, width: 0, height: 37 });
  assert.deepEqual(getConnectorBounds({ x: 2, y: 3 }, { x: 20, y: 3 }), { x: 2, y: 3, width: 18, height: 0 });
  assert.deepEqual(getConnectorBounds({ x: 2, y: 3 }, { x: 2, y: 3 }), { x: 2, y: 3, width: 0, height: 0 });
  assert.deepEqual(getConnectorPortPoints({ x: 4, y: 7, width: 0, height: 0 }).map(item => item.point),
    Array.from({ length: 8 }, () => ({ x: 4, y: 7 })));
});

test("snap chooses the actual closest port across targets and includes the exact threshold", () => {
  const targets = Object.freeze([{ id: "shape-a", box }, { id: "shape-b", box: { ...box, x: 200, rotation: 90 } }]);
  assert.deepEqual(findNearestConnectorPort({ x: 59, y: 20 }, targets, 1),
    { point: { x: 60, y: 20 }, binding: { targetId: "shape-a", port: "top" }, distance: 1 });
  assert.equal(findNearestConnectorPort({ x: 58, y: 20 }, targets, 1), undefined);
  assert.deepEqual(findNearestConnectorPort({ x: 280, y: 50 }, targets, 0),
    { point: { x: 280, y: 50 }, binding: { targetId: "shape-b", port: "top" }, distance: 0 });
  assert.equal(findNearestConnectorPort({ x: 0, y: 0 }, [], 10), undefined);
});

test("snap ties use caller target order and the documented port order", () => {
  const tiny = { x: 0, y: 0, width: 0, height: 0 };
  assert.deepEqual(findNearestConnectorPort({ x: 0, y: 0 }, [{ id: "second", box: tiny }, { id: "first", box: tiny }], 0),
    { point: { x: 0, y: 0 }, binding: { targetId: "second", port: "top" }, distance: 0 });
  const square = { x: 0, y: 0, width: 20, height: 20 };
  assert.equal(findNearestConnectorPort({ x: 10, y: 10 }, [{ id: "shape", box: square }], 10).binding.port, "top");
});

test("moving or resizing a target recomputes a bound endpoint without mutating its binding", () => {
  const binding = Object.freeze({ targetId: "shape", port: "right" });
  assert.deepEqual(getConnectorPortPoint(box, binding.port), { x: 110, y: 50 });
  assert.deepEqual(getConnectorPortPoint({ ...box, x: 30, width: 140, height: 100 }, binding.port), { x: 170, y: 70 });
  assert.deepEqual(binding, { targetId: "shape", port: "right" });
});

test("invalid geometry, ports and snap thresholds cannot produce NaN coordinates", () => {
  for (const invalid of [NaN, Infinity, -Infinity, "12", null]) {
    assert.throws(() => connectorLocalToWorld({ x: invalid, y: 0 }, box), TypeError);
    assert.throws(() => getConnectorPortPoint({ ...box, width: invalid }, "left"), TypeError);
    assert.throws(() => findNearestConnectorPort({ x: 0, y: 0 }, [], invalid), TypeError);
  }
  assert.throws(() => getConnectorPortPoint({ ...box, width: -1 }, "top"), TypeError);
  assert.throws(() => getConnectorPortPoint({ ...box, rotation: Infinity }, "top"), TypeError);
  assert.throws(() => getConnectorPortPoint({ ...box, flipX: "true" }, "top"), TypeError);
  assert.throws(() => getConnectorPortPoint(box, "center"), TypeError);
  assert.throws(() => findNearestConnectorPort({ x: 0, y: 0 }, [], -1), TypeError);
  assert.throws(() => findNearestConnectorPort({ x: 0, y: 0 }, [{ id: "", box }], 10), TypeError);
  assert.throws(() => getConnectorBounds({ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }), RangeError);
  assert.throws(() => getConnectorPortPoint({ x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 }, "right"), RangeError);
});

test("ellipse and rounded rectangle corners lie on the actual outline before transforms", () => {
  const ellipse = { type: "ellipse" };
  const point = getConnectorPortPoint(box, "topRight", ellipse);
  close(point, { x: 60 + 50 * Math.SQRT1_2, y: 50 - 30 * Math.SQRT1_2 });
  assert.ok(Math.abs(((point.x - 60) / 50) ** 2 + ((point.y - 50) / 30) ** 2 - 1) < 1e-12);
  const rounded = { type: "roundedRect", radiusX: 0.1, radiusY: 1 / 6 };
  close(getConnectorPortPoint(box, "topRight", rounded), { x: 100 + 10 * Math.SQRT1_2, y: 30 - 10 * Math.SQRT1_2 });
  assert.deepEqual(getConnectorPortPoint(box, "top", rounded), { x: 60, y: 20 });
  close(getConnectorPortPoint({ ...box, rotation: 90, flipY: true }, "topRight", ellipse),
    connectorLocalToWorld({ x: 50 + 50 * Math.SQRT1_2, y: 30 - 30 * Math.SQRT1_2 }, { ...box, rotation: 90, flipY: true }));
  assert.deepEqual(getConnectorPortPoint(box, "topRight", { type: "roundedRect", radiusX: 0, radiusY: 0 }), { x: 110, y: 20 });
});

test("triangle and diamond ports project the eight rays onto polygon edges", () => {
  const square = { x: 0, y: 0, width: 120, height: 120 };
  const triangle = { type: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
  close(getConnectorPortPoint(square, "topRight", triangle), { x: 80, y: 40 });
  close(getConnectorPortPoint(square, "left", triangle), { x: 30, y: 60 });
  const diamond = { type: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }] };
  close(getConnectorPortPoint(square, "topRight", diamond), { x: 90, y: 30 });
  close(getConnectorPortPoint(square, "bottomLeft", diamond), { x: 30, y: 90 });
  assert.deepEqual(getConnectorPortPoints(square, { ...diamond, points: [...diamond.points].reverse() }), getConnectorPortPoints(square, diamond));
});

test("polygon centre on an edge preserves inward, outward and collinear directions", () => {
  const square = { x: 0, y: 0, width: 100, height: 100 };
  const triangle = { type: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
  assert.deepEqual(getConnectorPortPoint(square, "topRight", triangle), { x: 50, y: 50 });
  assert.deepEqual(getConnectorPortPoint(square, "bottom", triangle), { x: 50, y: 100 });
  assert.deepEqual(getConnectorPortPoint(square, "left", triangle), { x: 0, y: 50 });
  assert.deepEqual(getConnectorPortPoint(square, "topLeft", triangle), { x: 0, y: 0 });
  assert.deepEqual(getConnectorPortPoint(square, "bottomRight", triangle), { x: 100, y: 100 });
});

test("outlines support zero-sized and thin boxes; snapping uses the outline rather than its box", () => {
  const ellipse = { type: "ellipse" }, zero = { x: 4, y: 7, width: 0, height: 0 };
  assert.deepEqual(getConnectorPortPoints(zero, ellipse).map(item => item.point), Array.from({ length: 8 }, () => ({ x: 4, y: 7 })));
  const thin = { x: 0, y: 0, width: 100000, height: 0.001 };
  close(getConnectorPortPoint(thin, "topRight", ellipse), { x: 50000 + 50000 * Math.SQRT1_2, y: 0.0005 - 0.0005 * Math.SQRT1_2 });
  const point = getConnectorPortPoint(box, "topRight", ellipse);
  assert.deepEqual(findNearestConnectorPort(point, [{ id: "ellipse", box, outline: ellipse }], 0)?.binding, { targetId: "ellipse", port: "topRight" });
  assert.equal(findNearestConnectorPort({ x: 110, y: 20 }, [{ id: "ellipse", box, outline: ellipse }], 1), undefined);
});

test("outline validation rejects invalid radii and polygons before returning geometry", () => {
  for (const outline of [null, { type: "custom" }, { type: "roundedRect", radiusX: -0.1, radiusY: 0.1 },
    { type: "roundedRect", radiusX: 0.1, radiusY: 0.6 }, { type: "roundedRect", radiusX: NaN, radiusY: 0.1 },
    { type: "polygon", points: [] }, { type: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: Infinity, y: 0 }] },
    { type: "polygon", points: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0, y: 0.1 }] }])
    assert.throws(() => getConnectorPortPoints(box, outline), TypeError);
});
