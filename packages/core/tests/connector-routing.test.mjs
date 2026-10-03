import test from 'node:test';
import assert from 'node:assert/strict';
import { getConnectorRoute, getConnectorPortPoint, CONNECTOR_PORTS, isConnectorRouting } from '../src/connectors.ts';
const target = (id, x, y, extra = {}) => ({ id, box: { x, y, width: 100, height: 60, ...extra } });
const endpoint = (target, port) => ({ ...getConnectorPortPoint(target.box, port), binding: { targetId: target.id, port } });
const elbow = (a, ap, b, bp, extra = {}) => getConnectorRoute(endpoint(a, ap), endpoint(b, bp), { routing: 'elbow', startTarget: a, endTarget: b, ...extra });
function checkRoute(route, start, end) {
  assert.deepEqual(route.points[0], { x: start.x, y: start.y });
  assert.deepEqual(route.points.at(-1), { x: end.x, y: end.y });
  assert.ok(route.points.length <= 64);
  for (const [index, point] of route.points.entries()) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.ok(point.x >= route.bounds.x && point.y >= route.bounds.y);
    assert.ok(point.x <= route.bounds.x + route.bounds.width + 1e-8 && point.y <= route.bounds.y + route.bounds.height + 1e-8);
    if (index) assert.ok(point.x === route.points[index - 1].x || point.y === route.points[index - 1].y, 'segments are axis-aligned');
  }
}
function crossesInterior(a, b, box) {
  return a.y === b.y ? a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
    : a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height;
}
test('straight remains default; elbow free endpoints, coincident points and validation', () => {
  const start = Object.freeze({ x: 10, y: 20 }), end = Object.freeze({ x: 60, y: 90 });
  assert.deepEqual(getConnectorRoute(start, end), { points: [start, end], bounds: { x: 10, y: 20, width: 50, height: 70 } });
  checkRoute(getConnectorRoute(start, end, { routing: 'elbow' }), start, end);
  checkRoute(getConnectorRoute(start, start, { routing: 'elbow' }), start, start);
  assert.equal(isConnectorRouting('elbow'), true); assert.equal(isConnectorRouting('curve'), false);
  assert.throws(() => getConnectorRoute(start, end, { routing: 'curve' }), TypeError);
  for (const clearance of [-1, NaN, Infinity]) assert.throws(() => getConnectorRoute(start, end, { clearance }), TypeError);
  assert.throws(() => getConnectorRoute({ x: NaN, y: 0 }, end), TypeError);
  assert.throws(() => getConnectorRoute({ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }), RangeError);
});
test('opposing ports use a centred dogleg, recompute on moving a target and retain actual endpoint order', () => {
  const a = target('a', 0, 0), b = target('b', 300, 180);
  assert.deepEqual(elbow(a, 'right', b, 'left').points, [{ x: 100, y: 30 }, { x: 200, y: 30 }, { x: 200, y: 210 }, { x: 300, y: 210 }]);
  const moved = target('b', 300, 0);
  assert.deepEqual(elbow(a, 'right', moved, 'left').points, [{ x: 100, y: 30 }, { x: 300, y: 30 }]);
  assert.deepEqual(elbow(moved, 'left', a, 'right').points, [{ x: 300, y: 30 }, { x: 100, y: 30 }]);
});
test('routes avoid both target bodies for all ports, including outward-facing endpoints and narrow gaps', () => {
  const a = target('a', 0, 0);
  for (const [x, y] of [[250, 140], [110, 0], [100.001, 0], [0, 61], [-250, -140], [100, 60]]) {
    const b = target('b', x, y);
    for (const ap of CONNECTOR_PORTS) for (const bp of CONNECTOR_PORTS) {
      const route = elbow(a, ap, b, bp);
      checkRoute(route, endpoint(a, ap), endpoint(b, bp));
      for (let index = 1; index < route.points.length; index++) for (const t of [a, b])
        assert.equal(crossesInterior(route.points[index - 1], route.points[index], t.box), false, `${x},${y},${ap},${bp}: ${JSON.stringify(route.points)}`);
    }
  }
});
test('rotated/flipped ports, same shape, overlapping shapes and zero dimensions stay finite and deterministic', () => {
  for (const rotation of [0, 45, 90, 180, 270]) for (const flipX of [false, true]) {
    const a = target('a', -100, -60, { rotation, flipX });
    for (const b of [a, target('b', -70, -30), target('b', 500, 300, { width: 0, height: 0 })]) {
      for (const ap of CONNECTOR_PORTS) for (const bp of CONNECTOR_PORTS) {
        const start = endpoint(a, ap), end = endpoint(b, bp), input = JSON.stringify([a, b, start, end]);
        const route = elbow(a, ap, b, bp);
        checkRoute(route, start, end);
        assert.deepEqual(elbow(a, ap, b, bp), route);
        assert.equal(JSON.stringify([a, b, start, end]), input);
      }
    }
  }
});
test('unbound or mismatched target context does not invent connections', () => {
  const a = target('a', 0, 0), start = { x: 40, y: 30 }, end = { x: 50, y: 100 };
  assert.deepEqual(getConnectorRoute(start, end, { routing: 'elbow', startTarget: a }), getConnectorRoute(start, end, { routing: 'elbow' }));
  assert.throws(() => getConnectorRoute(start, end, { startTarget: { id: '', box: a.box } }), TypeError);
});
