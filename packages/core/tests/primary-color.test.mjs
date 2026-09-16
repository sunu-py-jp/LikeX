import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrimaryColorPalette } from '../src/primary-color.ts';

const luminance = color => color.slice(1).match(/../g).map(channel => {
  const value = parseInt(channel, 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test('missing and invalid primary colors leave component defaults intact', () => {
  for (const value of [undefined, '', '#ff', '#12345678', 'red', 'var(--brand)', 'url(example)', null, 12]) {
    assert.equal(createPrimaryColorPalette(value, 'light'), undefined);
  }
  assert.equal(createPrimaryColorPalette(' #aBc ', 'light').primary, '#aabbcc');
});

test('primary colors stay exact while filled controls and active labels retain contrast', () => {
  for (const mode of ['light', 'dark']) {
    for (const color of ['#000000', '#ffffff', '#ffff00', '#ff0000', '#00ff00', '#0000ff', '#2563eb', '#217346', '#c64f2c', '#808080']) {
      const palette = createPrimaryColorPalette(color, mode);
      assert.equal(palette.primary, color);
      assert.ok(ratio(palette.primary, palette.onPrimary) >= 4.5, `${mode} ${color} filled label`);
      assert.ok(ratio(palette.primaryHover, palette.onPrimary) >= 4.5, `${mode} ${color} hover label`);
      assert.ok(ratio(palette.accent, mode === 'dark' ? '#333f37' : '#f5f7f6') >= 4.5, `${mode} ${color} active label`);
      assert.ok(ratio(palette.accent, palette.selection) >= 4.5, `${mode} ${color} selected label`);
    }
  }
});

test('theme changes are independent and never mutate another palette', () => {
  const first = createPrimaryColorPalette('#2563eb', 'light');
  const snapshot = { ...first };
  const dark = createPrimaryColorPalette('#2563eb', 'dark');
  createPrimaryColorPalette('#d97706', 'light');
  assert.deepEqual(first, snapshot);
  assert.notEqual(first.accent, dark.accent);
  assert.notEqual(first.selection, dark.selection);
  assert.equal(first.primary, dark.primary);
});
