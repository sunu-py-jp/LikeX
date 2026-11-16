import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `
  export * from './src/ui/grid/cell-colors';
  export * from './src/ui/grid/named-colors';
  export * from './src/ui/grid/cell-style';
  export * from './src/model/css-color';
  export { xlsxColor } from './src/export/xlsx/xml';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'cell-colors-test.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { adaptCellColors, adaptDataBarColor, cellFormatStyle, collapseSharedCellBorders, resolveCssColor, xlsxColor, CSS_NAMED_COLORS } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const rgb = value => resolveCssColor(Object.hasOwn(CSS_NAMED_COLORS, value.trim().toLowerCase()) ?
  CSS_NAMED_COLORS[value.trim().toLowerCase()] : value).rgb.match(/../g).map(channel => parseInt(channel, 16));
const composite = (value, background, opacity = 1) => rgb(value).map((channel, index) =>
  Math.round(background[index] + (channel - background[index]) * resolveCssColor(value).alpha * opacity));
const luminance = color => color.reduce((sum, value, index) => {
  const channel = value / 255;
  return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index];
}, 0);
const contrast = (first, second) => (Math.max(luminance(first), luminance(second)) + .05) /
  (Math.min(luminance(first), luminance(second)) + .05);
const sheetBackground = rgb('#1e2421');
const effectiveFill = style => style.backgroundColor ? composite(style.backgroundColor, sheetBackground) : sheetBackground;

test('light sheet mode preserves the exact authored style and never mutates either mode input', () => {
  const style = Object.freeze({ color: '#217346', backgroundColor: '#e8f3ec', fontWeight: 700,
    fontSize: 18, textAlign: 'right', borderBottom: '3px double #212121', borderLeft: 0, borderBottomWidth: 2 });
  const snapshot = { ...style };
  assert.equal(adaptCellColors(style, 'light', { error: true, dataBarColor: '#f00' }), style);
  assert.equal(adaptDataBarColor('rgba(100, 10, 10, .8)', 'light'), 'rgba(100, 10, 10, .8)');
  const dark = adaptCellColors(style, 'dark');
  assert.deepEqual(style, snapshot);
  assert.notEqual(dark, style);
  for (const key of ['fontWeight', 'fontSize', 'textAlign', 'borderLeft', 'borderBottomWidth']) assert.equal(dark[key], style[key]);
  assert.equal(dark.borderBottom.split(' ').slice(0, 2).join(' '), '3px double');
});

test('dark sheet adjusts authored and default foregrounds against their effective backgrounds', () => {
  for (const background of [undefined, '#ffffff', '#e8f3ec', '#ffcc00', '#183e2a', '#000000', 'navy',
    'rgba(255, 255, 255, .5)', '#ffeeaa80', 'hsl(120 50% 80%)', 'oklch(90% .1 50)']) {
    for (const color of [undefined, '#217346', '#526359', '#000', '#fff', '#dc2626', 'red', 'rgb(10% 15% 20%)']) {
      const style = adaptCellColors({ backgroundColor: background, color }, 'dark');
      const fill = effectiveFill(style);
      assert.ok(contrast(composite(style.color, fill), fill) >= 4.5, `${color} on ${background}: ${JSON.stringify(style)}`);
    }
  }
  assert.equal(adaptCellColors({}, 'dark').color, '#e9efeb');
  assert.equal(adaptCellColors({ color: '#e9efeb', backgroundColor: '#183e2a' }, 'dark').color, '#e9efeb');
  assert.equal(adaptCellColors({ backgroundColor: '#183e2a' }, 'dark').backgroundColor, '#183e2a');
});

test('all standard CSS named colors receive the same display adaptation as their RGB values', () => {
  assert.equal(Object.keys(CSS_NAMED_COLORS).length, 148);
  assert.equal(CSS_NAMED_COLORS.darkslategray, '#2f4f4f');
  assert.equal(CSS_NAMED_COLORS.seagreen, '#2e8b57');
  assert.equal(CSS_NAMED_COLORS.aliceblue, '#f0f8ff');
  for (const [name, hex] of Object.entries(CSS_NAMED_COLORS)) {
    const namedText = adaptCellColors({ color: name }, 'dark');
    const hexText = adaptCellColors({ color: hex }, 'dark');
    assert.deepEqual(rgb(namedText.color), rgb(hexText.color), `${name} text`);
    assert.ok(contrast(rgb(namedText.color), sheetBackground) >= 4.5, name);
    const namedFill = adaptCellColors({ backgroundColor: name, color: 'darkslategray', borderBottom: `2px solid ${name}` }, 'dark');
    const hexFill = adaptCellColors({ backgroundColor: hex, color: '#2f4f4f', borderBottom: `2px solid ${hex}` }, 'dark');
    assert.deepEqual(rgb(namedFill.backgroundColor), rgb(hexFill.backgroundColor), `${name} fill`);
    assert.deepEqual(rgb(namedFill.borderBottom.slice('2px solid '.length)), rgb(hexFill.borderBottom.slice('2px solid '.length)), `${name} border`);
    assert.ok(contrast(rgb(namedFill.color), effectiveFill(namedFill)) >= 4.5, `${name} fill contrast`);
    assert.equal(adaptDataBarColor(name, 'dark'), adaptDataBarColor(hex, 'dark'), `${name} data bar`);
  }
  assert.equal(adaptCellColors({ color: '  DarkSlateGray ' }, 'dark').color,
    adaptCellColors({ color: '#2f4f4f' }, 'dark').color);
  for (const value of ['transparent', 'currentColor', 'not-a-color', 'constructor', 'toString', 'var(--text)']) {
    assert.equal(adaptCellColors({ color: value, backgroundColor: value }, 'dark').color, value);
    assert.equal(adaptCellColors({ color: value, backgroundColor: value }, 'dark').backgroundColor, value);
  }
  for (const value of ['darkslategray', 'seagreen', 'aliceblue'])
    assert.deepEqual(xlsxColor(value, '123456'), { rgb: '123456', alpha: 1 }, 'display expansion must not change existing Office fallback');
});

test('explicit fills retain hue, alpha and fill presence; transparent and unresolved CSS retain their meaning', () => {
  const fill = adaptCellColors({ backgroundColor: '#ffcc00' }, 'dark').backgroundColor;
  const [red, green, blue] = rgb(fill);
  assert.ok(red < 255 && green < 204);
  assert.equal(blue, 0);
  assert.ok(Math.abs(green / red - .8) < .01);
  assert.equal(Object.hasOwn(adaptCellColors({}, 'dark'), 'backgroundColor'), false);
  for (const backgroundColor of ['transparent', '#1230', 'rgba(255, 255, 255, 0)', 'var(--authored-fill)', 'currentColor'])
    assert.equal(adaptCellColors({ backgroundColor }, 'dark').backgroundColor, backgroundColor);
  for (const color of ['transparent', '#fff0', 'var(--authored-text)', 'currentColor'])
    assert.equal(adaptCellColors({ color }, 'dark').color, color);
  for (const backgroundColor of ['#ffffff80', 'rgb(255 255 255 / 20%)'])
    assert.equal(resolveCssColor(adaptCellColors({ backgroundColor }, 'dark').backgroundColor).alpha, resolveCssColor(backgroundColor).alpha);
  const translucentText = adaptCellColors({ color: 'rgba(0, 0, 0, .5)' }, 'dark');
  assert.equal(resolveCssColor(translucentText.color).alpha, .5);
  assert.ok(contrast(composite(translucentText.color, sheetBackground), sheetBackground) >= 4.5);
});

test('negative red and implicit errors stay red and readable without changing authored formats', () => {
  const format = Object.freeze({ numberFormat: 'number', negativeFormat: 'red', color: '#217346' });
  for (const style of [adaptCellColors(cellFormatStyle(format, -12), 'dark'), adaptCellColors({}, 'dark', { error: true })]) {
    assert.ok(contrast(rgb(style.color), sheetBackground) >= 4.5);
    const [red, green, blue] = rgb(style.color);
    assert.ok(red > green && red > blue);
  }
  assert.equal(format.color, '#217346');
  assert.equal(adaptCellColors({ color: '#e9efeb' }, 'dark', { error: true }).color, '#e9efeb', 'explicit text still wins over the error class');
});

test('selected blank cells keep authored title, subtitle and error text readable on the selection fill', () => {
  const selection = rgb('#284d38');
  for (const color of [undefined, '#217346', '#526359', '#dc2626']) {
    const style = adaptCellColors({ color }, 'dark', { selected: true });
    assert.ok(contrast(composite(style.color, selection), selection) >= 4.5);
    assert.equal(Object.hasOwn(style, 'backgroundColor'), false, 'selection remains a CSS presentation state');
  }
});

test('shared borders collapse using authored colors before contrast conversion and preserve geometry', () => {
  const format = { borders: { top: { width: 2, style: 'dashed', color: '#000' }, left: { width: 3, style: 'double', color: '#222' },
    right: { width: 1, style: 'dotted', color: '#111' }, bottom: { width: 2, style: 'solid', color: 'rgba(0, 0, 0, .8)' } } };
  const original = cellFormatStyle(format, 'text');
  const collapsed = collapseSharedCellBorders(original, { top: 1, bottom: 1, left: 1, right: 1 }, (row, column) =>
    row === 0 ? { borders: { bottom: format.borders.top } } : column === 0 ? { borders: { right: format.borders.left } } : undefined);
  const dark = adaptCellColors(collapsed, 'dark');
  assert.equal(dark.borderTop, 0);
  assert.equal(dark.borderLeft, 0);
  for (const [edge, prefix] of [['borderRight', '1px dotted '], ['borderBottom', '2px solid ']]) {
    assert.ok(dark[edge].startsWith(prefix));
    const color = dark[edge].slice(prefix.length);
    assert.ok(contrast(composite(color, sheetBackground), sheetBackground) >= 3);
  }
  assert.equal(original.borderTop, '2px dashed #000');
  const mismatched = collapseSharedCellBorders(original, { top: 1, bottom: 1, left: 1, right: 1 }, () =>
    ({ borders: { bottom: { ...format.borders.top, color: '#010101' } } }));
  assert.notEqual(adaptCellColors(mismatched, 'dark').borderTop, 0, 'similar display colors cannot collapse distinct source edges');
  assert.equal(adaptCellColors({ borderBottom: '2px solid transparent', borderTop: 0 }, 'dark').borderBottom, '2px solid transparent');
});

test('conditional data bars leave both the covered and uncovered text readable', () => {
  for (const backgroundColor of [undefined, '#e8f3ec', '#ffcc00', '#ff0000', '#000']) {
    for (const source of ['#ffffff', '#000000', '#ffcc00', '#217346', '#3b82f6', '#dc2626', 'rgba(255, 100, 0, .5)']) {
      const dataBarColor = adaptDataBarColor(source, 'dark');
      const style = adaptCellColors({ backgroundColor, color: '#217346' }, 'dark', { dataBarColor });
      const fill = effectiveFill(style), barFill = composite(dataBarColor, fill, .3);
      assert.ok(contrast(composite(style.color, fill), fill) >= 4.5);
      assert.ok(contrast(composite(style.color, barFill), barFill) >= 4.5, `${source} on ${backgroundColor}`);
      assert.equal(resolveCssColor(dataBarColor).alpha, resolveCssColor(source).alpha);
    }
  }
});

test('the extracted CSS parser keeps Office conversion identical and cached styles remain independent', () => {
  assert.equal(resolveCssColor, xlsxColor);
  const source = { color: '#217346', backgroundColor: '#e8f3ec', fontSize: 10 };
  const initial = adaptCellColors(source, 'dark');
  for (let index = 0; index < 2100; index++) adaptCellColors({ color: `#${index.toString(16).padStart(6, '0')}` }, 'dark');
  assert.deepEqual(adaptCellColors(source, 'dark'), initial, 'cache eviction cannot change rendering');
  assert.equal(adaptCellColors({ ...source, fontSize: 30 }, 'dark').fontSize, 30);
  assert.equal(source.color, '#217346');
});
