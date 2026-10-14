import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({
  stdin: { contents: `export { SpreadsheetGrid } from './ui/spreadsheet-grid';
    export { useSpreadsheet } from './state/use-spreadsheet';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { SpreadsheetGrid, useSpreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const event = (patch = {}) => ({ button: 0, buttons: 1, pointerId: 1, detail: 0, shiftKey: false, ctrlKey: false,
  metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {}, ...patch });

async function mount(t, { rowHeights, initialZoom } = {}) {
  let controller, renderer, taskId = 0;
  const tasks = new Map();
  const host = { setTimeout(callback) { tasks.set(++taskId, callback); return taskId; }, clearTimeout: id => tasks.delete(id),
    addEventListener() {}, removeEventListener() {} };
  const document = { defaultView: host, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const node = () => ({ ownerDocument: document, style: {}, scrollHeight: 18, scrollTop: 0, scrollLeft: 0, clientHeight: 224, clientWidth: 640,
    closest: () => null, addEventListener() {}, removeEventListener() {}, contains: target => target?.ownerDocument === document,
    focus() { document.activeElement = this; }, setSelectionRange() {}, select() {}, setPointerCapture() {}, releasePointerCapture() {} });
  const scroller = node(), target = node();
  const initialWorkbook = { sheets: [{ id: 'sheet', name: 'Sheet', rowCount: 300, columnCount: 40,
    rowHeights, cells: { A1: { value: 'first' }, AN300: { value: 'last' } } }] };
  function Probe() {
    controller = useSpreadsheet({ initialWorkbook, initialZoom, onSave() {} });
    return createElement(SpreadsheetGrid, { controller });
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: element => element.props.className === 'lxs-grid-scroll' ? scroller : node() }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { renderer, tasks, get c() { return controller; },
    labels: () => renderer.root.findAllByProps({ className: 'lxs-row-label' }),
    backdrop: () => renderer.root.findByProps({ className: 'lxs-row-labels' }),
    cells: () => renderer.root.findAllByProps({ role: 'gridcell' }),
    rowHeader: row => renderer.root.findByProps({ 'data-lxs-row-header': row }),
    async scroll(top, left = 0) {
      scroller.scrollTop = top; scroller.scrollLeft = left;
      await act(async () => renderer.root.findByProps({ className: 'lxs-grid-scroll' }).props.onScroll({ currentTarget: scroller }));
    },
    async resize(kind, patch = {}) {
      await act(async () => renderer.root.findByProps({ 'aria-label': '1行の高さ' }).props[kind](event({ currentTarget: target, ...patch })));
    },
  };
}

test('row numbers and every column label exist before offscreen cells are rendered', async t => {
  const ui = await mount(t);
  assert.equal(ui.c.renderingMode, 'viewport');
  assert.equal(ui.tasks.size, 0, 'the default mode does not schedule the full cell grid');
  assert.equal(ui.labels().length, 300);
  assert.deepEqual(ui.labels().at(-1).children, ['300']);
  assert.equal(ui.cells().some(cell => cell.props['data-lxs-row'] === 299), false);
  assert.ok(ui.cells().length < 300 * 40 / 4);
  const columns = ui.renderer.root.findAllByProps({ role: 'columnheader' });
  assert.equal(columns.length, 41, 'all columns and the corner are mounted');
  assert.deepEqual(columns.at(-1).findByType('button').children, ['AN']);
  assert.equal(ui.backdrop().props['aria-hidden'], 'true');
  assert.equal(ui.backdrop().findAllByType('button').length, 0, 'the fallback does not duplicate interactive or accessible headers');
  assert.equal(ui.renderer.root.findAllByProps({ role: 'rowheader' }).some(header => header.props['data-lxs-row-header'] === 299), false);
});

test('fast viewport changes and selection reuse row labels without retaining offscreen cells', async t => {
  const ui = await mount(t);
  const before = ui.labels().map(label => label.props);
  await ui.scroll(28 * 260, 2100);
  assert.equal(ui.tasks.size, 0);
  assert.equal(ui.cells().some(cell => cell.props['data-lxs-row'] === 260), true);
  assert.equal(ui.cells().some(cell => cell.props['data-lxs-row'] === 10), false);
  assert.ok(ui.labels().every((label, index) => label.props === before[index]), 'scrolling must not rebuild the full strip');
  await act(async () => ui.c.select({ row: 260, column: 35 }));
  assert.match(ui.rowHeader(260).props.className, /lxs-header-selected/);
  assert.ok(ui.labels().every((label, index) => label.props === before[index]), 'selection changes only the real headers');
  await ui.scroll(0);
  assert.equal(ui.cells().some(cell => cell.props['data-lxs-row'] === 270), false);
  assert.equal(ui.labels().length, 300);
  assert.equal(ui.tasks.size, 0);
});

test('row labels track custom heights, zoomed resize previews, commits and undo', async t => {
  const ui = await mount(t, { rowHeights: { 0: 42, 1: 17, 80: 55 }, initialZoom: 200 });
  assert.deepEqual(ui.labels().slice(0, 3).map(label => [label.props.style.top, label.props.style.height]), [[0, 42], [42, 17], [59, 28]]);
  const firstRow = ui.rowHeader(0).parent;
  assert.equal(firstRow.props.style.top, ui.labels()[0].props.style.top + 28, 'label positions account for the column-header strip');
  const initial = ui.labels()[0].props;
  await act(async () => ui.c.setZoom(150));
  assert.strictEqual(ui.labels()[0].props, initial, 'zoom scales the existing logical geometry');
  assert.equal(ui.renderer.root.findByProps({ className: 'lxs-grid-scroll' }).props.style.zoom, 1.5);
  await ui.resize('onPointerDown', { clientY: 10 });
  await ui.resize('onPointerMove', { clientY: 40 });
  assert.equal(ui.c.activeSheet.rowHeights[0], 42, 'preview does not yet mutate the model');
  assert.equal(ui.labels()[0].props.style.height, 62, '30 display pixels add 20 logical pixels at 150%');
  assert.equal(ui.labels()[1].props.style.top, 62);
  assert.equal(ui.rowHeader(0).parent.props.style.height, 62);
  await ui.resize('onPointerUp', { clientY: 40 });
  assert.equal(ui.c.activeSheet.rowHeights[0], 62);
  assert.equal(ui.labels()[1].props.style.top, 62);
  await act(async () => ui.c.undo());
  assert.equal(ui.labels()[0].props.style.height, 42);
  assert.equal(ui.labels()[1].props.style.top, 42);
});

test('real row and column headers retain keyboard selection and resizing', async t => {
  const ui = await mount(t);
  await act(async () => ui.rowHeader(4).findByType('button').props.onClick(event()));
  assert.deepEqual([ui.c.selection.anchor, ui.c.selection.focus].sort((a, b) => a.column - b.column), [{ row: 4, column: 0 }, { row: 4, column: 39 }]);
  const column = ui.renderer.root.findByProps({ 'data-lxs-column-header': 2 });
  await act(async () => column.findByType('button').props.onClick(event()));
  assert.deepEqual([ui.c.selection.anchor, ui.c.selection.focus].sort((a, b) => a.row - b.row), [{ row: 0, column: 2 }, { row: 299, column: 2 }]);
  await ui.resize('onKeyDown', { key: 'ArrowDown' });
  assert.equal(ui.c.activeSheet.rowHeights[0], 36);
  assert.equal(ui.labels()[0].props.style.height, 36);
});
