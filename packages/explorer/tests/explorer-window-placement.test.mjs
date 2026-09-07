import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { calcDetachedWindowPosition } = await importTypeScript('../src/model/window-placement.ts');
const metrics = Object.freeze({ screenX: 300, screenY: 100, outerWidth: 1200, outerHeight: 800, innerWidth: 1180, innerHeight: 700 });
const rect = Object.freeze({ left: 24, top: 10 });
const anchor = Object.freeze({ screenX: 1000, screenY: 600, offsetX: 120, offsetY: 15 });

test('the drop lands on the grabbed tab point after accounting for borders and the title bar', () => {
  const position = calcDetachedWindowPosition(metrics, rect, anchor);
  assert.deepEqual(position, { left: 846, top: 485 });
  // For this measured window, the viewport starts 10 px from its left edge
  // and 90 px below its top edge, before the tab's own 24/10 px offset.
  assert.equal(position.left + 10 + rect.left + anchor.offsetX, anchor.screenX);
  assert.equal(position.top + 90 + rect.top + anchor.offsetY, anchor.screenY);
});

test('an already aligned window stays put and the same drop is independent of its temporary opening position', () => {
  const aligned = { ...metrics, screenX: 846, screenY: 485 };
  assert.deepEqual(calcDetachedWindowPosition(aligned, rect, anchor), { left: 846, top: 485 });
  assert.deepEqual(calcDetachedWindowPosition({ ...metrics, screenX: -2000, screenY: -600 }, rect, anchor), { left: 846, top: 485 });
});

test('negative monitor coordinates and grabs near either tab edge are preserved', () => {
  assert.deepEqual(calcDetachedWindowPosition(metrics, { left: 8, top: 4 }, {
    screenX: -1800, screenY: -500, offsetX: 0, offsetY: 0,
  }), { left: -1818, top: -594 });
  assert.deepEqual(calcDetachedWindowPosition(metrics, { left: 8, top: 4 }, {
    screenX: -1800, screenY: -500, offsetX: 223, offsetY: 31,
  }), { left: -2041, top: -625 });
});

test('fractional CSS measurements round only the final window origin', () => {
  const position = calcDetachedWindowPosition({ ...metrics, outerWidth: 1201, innerWidth: 1180, outerHeight: 800.25 },
    { left: 12.25, top: 6.75 }, { screenX: 600.25, screenY: 400.75, offsetX: 100.25, offsetY: 12.5 });
  assert.deepEqual(position, { left: 477, top: 292 });
  assert.ok(Math.abs(position.left + 10.5 + 12.25 + 100.25 - 600.25) <= 0.5);
  assert.ok(Math.abs(position.top + 89.75 + 6.75 + 12.5 - 400.75) <= 0.5);
});

test('fullscreen or inconsistent browser chrome measurements never create negative chrome offsets', () => {
  const expected = { left: 856, top: 575 };
  assert.deepEqual(calcDetachedWindowPosition({ ...metrics, outerWidth: 1180, outerHeight: 700 }, rect, anchor), expected);
  assert.deepEqual(calcDetachedWindowPosition({ ...metrics, outerWidth: 1100, outerHeight: 680 }, rect, anchor), expected);
  assert.deepEqual(calcDetachedWindowPosition({ ...metrics, outerWidth: 1220, outerHeight: 710 }, rect, anchor), { left: 836, top: 575 });
});

test('unavailable or non-finite measurements return null before any window move is requested', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const key of Object.keys(metrics)) {
      assert.equal(calcDetachedWindowPosition({ ...metrics, [key]: value }, rect, anchor), null, `metric ${key}=${value}`);
    }
    for (const key of Object.keys(rect)) {
      assert.equal(calcDetachedWindowPosition(metrics, { ...rect, [key]: value }, anchor), null, `rect ${key}=${value}`);
    }
    for (const key of Object.keys(anchor)) {
      assert.equal(calcDetachedWindowPosition(metrics, rect, { ...anchor, [key]: value }), null, `anchor ${key}=${value}`);
    }
  }
  for (const dimension of ['outerWidth', 'outerHeight', 'innerWidth', 'innerHeight']) {
    for (const value of [0, -1]) assert.equal(calcDetachedWindowPosition({ ...metrics, [dimension]: value }, rect, anchor), null);
  }
  assert.equal(calcDetachedWindowPosition(metrics, { left: -Number.MAX_VALUE, top: 0 }, { ...anchor, screenX: Number.MAX_VALUE }), null);
});

test('the calculation leaves input snapshots untouched and returns a fresh position', () => {
  const before = structuredClone({ metrics, rect, anchor });
  const result = calcDetachedWindowPosition(metrics, rect, anchor);
  result.left = 0;
  assert.deepEqual({ metrics, rect, anchor }, before);
  assert.deepEqual(calcDetachedWindowPosition(metrics, rect, anchor), { left: 846, top: 485 });
});
