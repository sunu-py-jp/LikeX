import test from "node:test";
import assert from "node:assert/strict";
import { getDragInsertionIndex, getDragScrollDelta } from "../src/drag.ts";

const bounds = { left: 100, top: 100, right: 500, bottom: 400 };
test("drag scroll is idle inside and runs in either axis at/beyond edges", () => {
  assert.deepEqual(getDragScrollDelta({ x: 250, y: 250 }, bounds), { x: 0, y: 0 });
  assert.deepEqual(getDragScrollDelta({ x: 90, y: 410 }, bounds, 50), { x: -36, y: 36 });
  assert.deepEqual(getDragScrollDelta({ x: 510, y: 90 }, bounds, 50), { x: 36, y: -36 });
  assert.deepEqual(getDragScrollDelta({ x: 90, y: 410 }, bounds, 50, { axes: "y" }), { x: 0, y: 36 });
});
test("drag scroll scales by elapsed time, ramps near edges, and clamps delayed frames", () => {
  assert.equal(getDragScrollDelta({ x: 124, y: 250 }, bounds, 50).x, -18);
  assert.equal(getDragScrollDelta({ x: 90, y: 250 }, bounds, 1000).x, -46.08);
  assert.deepEqual(getDragScrollDelta({ x: NaN, y: 410 }, bounds), { x: 0, y: 0 });
  assert.deepEqual(getDragScrollDelta({ x: 90, y: 410 }, bounds, -10), { x: -0, y: 0 });
});
test("insertion boundaries work with variable heights, gaps, and both ends", () => {
  const remaining = [{ start: 10, end: 30 }, { start: 50, end: 200 }];
  assert.equal(getDragInsertionIndex(-20, remaining), 0);
  assert.equal(getDragInsertionIndex(40, remaining), 1);
  assert.equal(getDragInsertionIndex(130, remaining), 2);
  assert.equal(getDragInsertionIndex(400, remaining), 2);
  assert.equal(getDragInsertionIndex(10, []), 0);
});
