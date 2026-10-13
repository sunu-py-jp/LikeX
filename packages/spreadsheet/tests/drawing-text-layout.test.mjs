import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: 'export { DrawingText } from "./ui/drawings/drawing-text";', resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { DrawingText } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

// Deterministic full-width glyph metrics for the browser cases: CSS dimensions
// keep fractions, while client/scroll dimensions round to integer layout pixels.
async function mount(t, patch = {}) {
  const drawing = { id: 'label', type: 'text', anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 },
    width: 48, height: 32, text: '消費税区分名称', fontSize: 16, color: '#FF0000', background: 'transparent',
    textInsets: { left: 0, right: 0, top: 0, bottom: 0 }, textWrap: 'none', textOverflow: 'clip', textVerticalOverflow: 'clip', textAutoFit: 'shrink', ...patch };
  const { left, right, top, bottom } = drawing.textInsets;
  const width = drawing.width - left - right, height = drawing.height - top - bottom;
  const text = { style: { fontSize: '', width: '' } };
  const metrics = () => {
    const fontSize = parseFloat(text.style.fontSize) || drawing.fontSize * (drawing.textFontScale ?? 1);
    const columns = drawing.textWrap === 'none' ? drawing.text.length : Math.max(1, Math.floor(width / fontSize));
    return { width: Math.min(columns, drawing.text.length) * fontSize, height: Math.ceil(drawing.text.length / columns) * fontSize * 1.4 };
  };
  Object.defineProperties(text, {
    scrollWidth: { get: () => Math.round(Math.max(width, metrics().width)) },
    scrollHeight: { get: () => Math.round(metrics().height) },
  });
  const box = { clientWidth: Math.round(drawing.width), clientHeight: Math.round(drawing.height),
    ownerDocument: { defaultView: { getComputedStyle: element => element === text
      ? { width: `${text.style.width === 'fit-content' ? metrics().width : width}px`, height: `${metrics().height}px` }
      : { boxSizing: 'border-box', width: `${drawing.width}px`, height: `${drawing.height}px`,
        paddingLeft: `${left}px`, paddingRight: `${right}px`, paddingTop: `${top}px`, paddingBottom: `${bottom}px` } } } };
  let renderer;
  await act(async () => { renderer = create(createElement(DrawingText, { drawing }), { createNodeMock: element => element.type === 'span' ? text : box }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { fontSize: renderer.root.findByType('span').props.style.fontSize, width, height, text };
}

test('fractional DrawingML insets do not shrink text that already fits', async t => {
  const result = await mount(t, { width: 30.4, text: '税', textInsets: { left: 0.3, right: 0.3, top: 0, bottom: 0 } });
  assert.equal(result.fontSize, 16);
  assert.equal(result.text.style.width, '', 'the measurement must restore the normal text alignment width');
  assert.equal(result.text.style.fontSize, '');
});

test('shrink-to-fit leaves no fractional horizontal overrun for any alignment', async t => {
  for (const textAlign of ['left', 'center', 'right']) {
    const result = await mount(t, { textAlign });
    assert.ok(result.fontSize * 7 <= result.width, `${textAlign}: all seven glyphs fit`);
    assert.ok(result.fontSize * 7 > result.width - 0.1, 'the font stays close to the largest size that fits');
  }
});

test('wrapped shrink-to-fit respects fractional line height and the stored font scale', async t => {
  const result = await mount(t, { width: 55, height: 35, textWrap: 'wrap' });
  assert.ok(result.fontSize * 1.4 * 2 <= result.height, 'both lines fit without a clipped bottom edge');
  assert.ok(result.fontSize * 1.4 * 2 > result.height - 0.1);
  const scaled = await mount(t, { width: 200, textFontScale: 0.75 });
  assert.equal(scaled.fontSize, 12, 'the saved scale remains the upper bound');
});
