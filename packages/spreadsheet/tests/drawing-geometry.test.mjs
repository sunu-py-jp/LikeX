import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingAnchor, drawingRectangle, resizeDrawingRectangle } from '../src/state/drawing-geometry.ts';

const geometry = { columnOffsets: [48, 148, 248, 348, 448, 548, 648], rowOffsets: [28, 128, 228, 328, 428, 528] };
const initial = { left: 248, top: 228, width: 100, height: 60 };
const corners = ['nw', 'ne', 'sw', 'se'];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
function fixedCorner(rectangle, corner, flipX = false, flipY = false) {
  return { x: rectangle.left + ((corner.endsWith('w') !== flipX) ? rectangle.width : 0),
    y: rectangle.top + ((corner.startsWith('n') !== flipY) ? rectangle.height : 0) };
}

for (const corner of corners) {
  test(`${corner} preserves its opposite corner through either or both crossings`, () => {
    const original = fixedCorner(initial, corner), x = corner.endsWith('e') ? 1 : -1, y = corner.startsWith('s') ? 1 : -1;
    for (const [crossX, crossY] of [[false, false], [true, false], [false, true], [true, true]]) {
      const delta = { x: crossX ? -140 * x : 20 * x, y: crossY ? -100 * y : 20 * y };
      const result = resizeDrawingRectangle(initial, corner, delta, geometry);
      assert.equal(result.width, crossX ? 40 : 120); assert.equal(result.height, crossY ? 40 : 80);
      assert.equal(result.flipX, crossX); assert.equal(result.flipY, crossY);
      assert.deepEqual(fixedCorner(result, corner, crossX, crossY), original);
      assert.deepEqual(drawingRectangle({ ...result, anchor: drawingAnchor(result.left, result.top, geometry) }, geometry),
        { left: result.left, top: result.top, width: result.width, height: result.height });
    }
  });
}

test('crossings toggle the initial orientation and returning to the original pointer is exact', () => {
  const options = { flipX: true, flipY: true };
  const result = resizeDrawingRectangle(initial, 'se', { x: -140, y: 20 }, geometry, options);
  assert.equal(result.flipX, false); assert.equal(result.flipY, true);
  assert.deepEqual(resizeDrawingRectangle(initial, 'se', { x: 0, y: 0 }, geometry, options), { ...initial, ...options });
  assert.deepEqual(initial, { left: 248, top: 228, width: 100, height: 60 }, 'previews do not mutate initial geometry');
});

test('image diagonal resizing retains its ratio and fixed corner after crossing', () => {
  for (const corner of corners) {
    const result = resizeDrawingRectangle(initial, corner, { x: corner.endsWith('e') ? -180 : 180, y: corner.startsWith('s') ? -130 : 130 }, geometry,
      { preserveAspectRatio: true });
    close(result.width / result.height, initial.width / initial.height);
    const fixed = fixedCorner(result, corner, true, true), original = fixedCorner(initial, corner);
    close(fixed.x, original.x); close(fixed.y, original.y);
    assert.equal(result.flipX, true); assert.equal(result.flipY, true);
  }
});

test('keyboard resizing moves the named corner and image keys scale from the requested axis', () => {
  for (const corner of corners) {
    const direction = corner.endsWith('e') ? 1 : -1;
    const result = resizeDrawingRectangle(initial, corner, { x: direction * 10, y: 0 }, geometry,
      { preserveAspectRatio: true, axis: 'x' });
    close(result.width, 110); close(result.height, 66);
    const fixed = fixedCorner(result, corner), original = fixedCorner(initial, corner);
    close(fixed.x, original.x); close(fixed.y, original.y);
  }
});

test('crossing and size limits never move the opposite corner outside sheet anchor bounds', () => {
  const nearEdge = { left: 58, top: 38, width: 100, height: 60 };
  const result = resizeDrawingRectangle(nearEdge, 'se', { x: -1000, y: -1000 }, geometry);
  assert.deepEqual(result, { ...nearEdge, width: 16, height: 16, flipX: false, flipY: false });
  const grown = resizeDrawingRectangle(initial, 'nw', { x: -100000, y: -100000 }, geometry);
  assert.equal(grown.left, 48); assert.equal(grown.top, 28);
  assert.deepEqual(fixedCorner(grown, 'nw'), fixedCorner(initial, 'nw'));
  const huge = resizeDrawingRectangle(initial, 'se', { x: 100000, y: 100000 }, geometry);
  assert.equal(huge.width, 10000); assert.equal(huge.height, 10000);
});

test('images keep thin fractional sides at the minimum and maximum without floating point overflow', () => {
  const thin = { left: 58, top: 38, width: 320, height: 0.032 };
  for (const delta of [{ x: 100000, y: 100000 }, { x: -1000, y: -1000 }]) {
    const result = resizeDrawingRectangle(thin, 'se', delta, geometry, { preserveAspectRatio: true });
    close(result.width / result.height, 10000);
    assert.ok(result.width >= 16 && result.width <= 10000);
    assert.ok(result.height > 0);
    assert.ok(result.left >= 48 && result.top >= 28);
  }
});

test('drawings extending beyond the sheet keep their fixed corner and an in-sheet anchor', () => {
  const overflow = { left: 600, top: 480, width: 333, height: 200 };
  for (const corner of corners) {
    const result = resizeDrawingRectangle(overflow, corner, { x: 1000, y: 1000 }, geometry, { preserveAspectRatio: true });
    close(result.width / result.height, 333 / 200);
    assert.ok(result.left >= 48 && result.left <= 647);
    assert.ok(result.top >= 28 && result.top <= 527);
    const original = fixedCorner(overflow, corner), fixed = fixedCorner(result, corner, result.flipX, result.flipY);
    close(fixed.x, original.x); close(fixed.y, original.y);
  }
});

test('a far off-sheet image suppresses a crossing when its fixed corner and ratio cannot fit on that side', () => {
  const large = { left: 48, top: 38, width: 10000, height: 6000 };
  const result = resizeDrawingRectangle(large, 'sw', { x: -140, y: -100000 }, geometry, { preserveAspectRatio: true });
  assert.equal(result.flipY, false);
  assert.ok(result.left >= 48 && result.left <= 647);
  assert.equal(result.top, 38);
  close(result.width / result.height, 5 / 3);
  assert.deepEqual(fixedCorner(result, 'sw'), fixedCorner(large, 'sw'));
});
