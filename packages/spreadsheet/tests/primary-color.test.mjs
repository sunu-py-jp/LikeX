import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { default: Spreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const workbook = { sheets: [{ id: 'main', name: 'Main', rowCount: 4, columnCount: 4,
  cells: { A1: { value: 'Original', format: { color: '#cc3300', background: '#ffeeaa' } } },
  drawings: [{ id: 'shape', type: 'shape', shape: 'rectangle', anchor: { row: 1, column: 1, offsetX: 0, offsetY: 0 },
    width: 80, height: 40, fill: '#e8f3ec', stroke: '#217346', strokeWidth: 2 }],
}] };
const variables = ['--lxs-primary', '--lxs-on-primary', '--lxs-primary-hover', '--lxs-accent', '--lxs-selection'];

async function mount(t, supplied = {}) {
  let renderer;
  const ref = createRef();
  let props = { ref, initialWorkbook: workbook, onSave() {}, ...supplied };
  await act(async () => { renderer = create(createElement(Spreadsheet, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { ref, get root() { return renderer.root; },
    get section() { return renderer.root.findByType('section'); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Spreadsheet, props))); },
  };
}

const luminance = color => color.slice(1).match(/../g).map(value => {
  const channel = parseInt(value, 16) / 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (first, second) => {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};

test('omitted or invalid primary colors leave the existing default CSS and host style in control', async t => {
  const style = { height: 420, '--lxs-accent': '#123456' };
  const ui = await mount(t, { style });
  assert.deepEqual(ui.section.props.style, style);
  for (const primaryColor of ['', '#12', '#1234', 'red', 'var(--brand)', 'url(example)', '#12345678']) {
    await ui.update({ primaryColor });
    assert.deepEqual(ui.section.props.style, style);
  }
  await ui.update({ primaryColor: ' #aBc ' });
  assert.equal(ui.section.props.style['--lxs-primary'], '#aabbcc');
  assert.equal(ui.section.props.style['--lxs-accent'], '#123456', 'explicit host styles retain precedence');
  assert.equal(ui.section.props.style.height, 420);
  await ui.update({ primaryColor: undefined });
  assert.deepEqual(ui.section.props.style, style, 'removing the prop removes all computed color overrides');
});

test('dynamic colors are instance-local and never alter workbook formatting, dirty state or history', async t => {
  const changes = [], dirty = [];
  const first = await mount(t, { primaryColor: '#2563eb', onChange: value => changes.push(value), onDirtyChange: value => dirty.push(value) });
  const second = await mount(t, { primaryColor: '#f97316' });
  const untouched = second.ref.current.getWorkbook();
  const secondStyle = { ...second.section.props.style };
  await act(async () => { assert.equal(first.ref.current.execute({ type: 'cells.set', sheetId: 'main', values: { B1: 'Edited' } }).ok, true); });
  const draft = first.ref.current.getWorkbook();
  const history = first.ref.current.getHistoryState();
  const changedCount = changes.length;
  for (const primaryColor of ['#9333ea', '#fff', undefined]) {
    await first.update({ primaryColor });
    assert.deepEqual(first.ref.current.getWorkbook(), draft);
    assert.deepEqual(first.ref.current.getHistoryState(), history);
    assert.deepEqual(second.ref.current.getWorkbook(), untouched);
    assert.deepEqual(second.section.props.style, secondStyle);
    const cell = first.root.findAllByProps({ role: 'gridcell' }).find(item => item.props['data-lxs-column'] === 0 && item.props['data-lxs-row'] === 0);
    assert.equal(cell.props.style.color, '#cc3300');
    assert.equal(cell.props.style.backgroundColor, '#ffeeaa');
  }
  assert.equal(changes.length, changedCount);
  assert.deepEqual(dirty, [false, true]);
  assert.deepEqual(draft.sheets[0].drawings, first.ref.current.getWorkbook().sheets[0].drawings);
  assert.equal(variables.some(name => Object.hasOwn(first.section.props.style ?? {}, name)), false);
});

test('light and dark modes keep labels and selected states readable with light or dark primary colors', async t => {
  const ui = await mount(t, { primaryColor: '#2563eb' });
  for (const primaryColor of ['#2563eb', '#ffffff', '#000000', '#ffcc00']) {
    for (const colorMode of ['light', 'dark']) {
      await ui.update({ primaryColor, colorMode });
      const style = ui.section.props.style;
      assert.equal(ui.section.props['data-color-mode'], colorMode);
      assert.equal(style['--lxs-primary'], primaryColor);
      assert.ok(contrast(style['--lxs-primary'], style['--lxs-on-primary']) >= 4.5);
      assert.ok(contrast(style['--lxs-primary-hover'], style['--lxs-on-primary']) >= 4.5);
      assert.ok(contrast(style['--lxs-accent'], style['--lxs-selection']) >= 4.5);
      assert.ok(contrast(style['--lxs-accent'], colorMode === 'dark' ? '#333f37' : '#f5f7f6') >= 4.5);
    }
  }
});

test('system color-mode changes recompute only the view palette and explicit style still wins', async t => {
  const previousWindow = globalThis.window;
  const listeners = new Set();
  const media = { matches: false, addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener) };
  globalThis.window = { matchMedia: () => media };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const ui = await mount(t, { colorMode: 'system', primaryColor: '#2563eb', style: { '--lxs-primary-hover': '#001122' } });
  const before = ui.ref.current.getWorkbook();
  const light = { ...ui.section.props.style };
  await act(async () => { media.matches = true; for (const listener of listeners) listener(); });
  assert.equal(ui.section.props['data-color-mode'], 'dark');
  assert.notEqual(ui.section.props.style['--lxs-accent'], light['--lxs-accent']);
  assert.notEqual(ui.section.props.style['--lxs-selection'], light['--lxs-selection']);
  assert.equal(ui.section.props.style['--lxs-primary'], '#2563eb');
  assert.equal(ui.section.props.style['--lxs-primary-hover'], '#001122');
  assert.deepEqual(ui.ref.current.getWorkbook(), before);
  await ui.update({ colorMode: 'light' });
  assert.deepEqual(ui.section.props.style, light);
  assert.equal(listeners.size, 0);
});
