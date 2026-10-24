import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `
export { SpreadsheetFilterChoices, SpreadsheetFilterButtons } from './src/ui/grid/spreadsheet-filter-buttons';
export { SpreadsheetFilterToolbar } from './src/ui/spreadsheet-filter-toolbar';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'filter-ui-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'react', setup(builder) {
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'inline-portal' }));
    builder.onLoad({ filter: /.*/, namespace: 'inline-portal' }, () => ({ contents: 'export const createPortal = children => children;', loader: 'js' }));
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }] });
const { SpreadsheetFilterChoices, SpreadsheetFilterButtons, SpreadsheetFilterToolbar } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

async function render(t, component, props) {
  let renderer;
  await act(async () => { renderer = create(createElement(component, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get root() { return renderer.root; }, async update(next) { props = { ...props, ...next }; await act(async () => renderer.update(createElement(component, props))); } };
}
const button = (ui, label) => ui.root.findAllByType('button').find(item => item.children.join('') === label);

test('filter checklist preserves blank selections and distinguishes none from clearing a condition', async t => {
  const applied = [], values = ['', '東京', '大阪'];
  const ui = await render(t, SpreadsheetFilterChoices, { values, initialValues: ['東京'], disabled: false,
    onApply: value => applied.push(value), onClear: () => applied.push('clear'), onClose() {} });
  const checks = () => ui.root.findAllByType('input').filter(item => item.props.type === 'checkbox');
  assert.deepEqual(checks().map(item => item.props.checked), [false, false, true, false]);
  await act(async () => checks()[1].props.onChange({ currentTarget: { checked: true } }));
  await act(async () => button(ui, '適用').props.onClick());
  assert.deepEqual(applied.at(-1), ['', '東京']);
  await act(async () => checks()[0].props.onChange({ currentTarget: { checked: false } }));
  await act(async () => button(ui, '適用').props.onClick());
  assert.deepEqual(applied.at(-1), []);
  await act(async () => checks()[0].props.onChange({ currentTarget: { checked: true } }));
  await act(async () => button(ui, '適用').props.onClick());
  assert.equal(applied.at(-1), null);
  await act(async () => button(ui, '条件をクリア').props.onClick());
  assert.equal(applied.at(-1), 'clear');
});

test('search scopes select-all to matching values without losing selections outside the search', async t => {
  let applied;
  const ui = await render(t, SpreadsheetFilterChoices, { values: ['', 'Alpha', 'alphabet', 'Beta'], initialValues: ['Beta'], disabled: false,
    onApply: value => { applied = value; }, onClear() {}, onClose() {} });
  await act(async () => ui.root.findByProps({ type: 'search' }).props.onChange({ currentTarget: { value: 'ALP' } }));
  assert.equal(ui.root.findAllByType('input').filter(item => item.props.type === 'checkbox').length, 3);
  const all = ui.root.findAllByType('input').find(item => item.props.type === 'checkbox');
  await act(async () => all.props.onChange({ currentTarget: { checked: true } }));
  await act(async () => button(ui, '適用').props.onClick());
  assert.deepEqual(applied, ['Alpha', 'alphabet', 'Beta']);
  await act(async () => ui.root.findByProps({ type: 'search' }).props.onChange({ currentTarget: { value: '空白' } }));
  assert.equal(ui.root.findAllByProps({ className: 'lxs-filter-choice' }).length, 1);
});

test('criteria use the same case-insensitive value identity as imported Excel filters', async t => {
  let applied;
  const ui = await render(t, SpreadsheetFilterChoices, { values: ['APPLE', 'Orange'], initialValues: ['apple'], disabled: false,
    onApply: value => { applied = value; }, onClear() {}, onClose() {} });
  const choices = ui.root.findAllByProps({ className: 'lxs-filter-choice' });
  assert.equal(choices[0].findByType('input').props.checked, true);
  assert.equal(choices[1].findByType('input').props.checked, false);
  await act(async () => button(ui, '適用').props.onClick());
  assert.deepEqual(applied, ['APPLE']);
});

test('applying an empty header-only checklist preserves an explicit empty condition', async t => {
  let applied = 'unchanged';
  const ui = await render(t, SpreadsheetFilterChoices, { values: [], initialValues: [], disabled: false,
    onApply: value => { applied = value; }, onClear() {}, onClose() {} });
  await act(async () => button(ui, '適用').props.onClick());
  assert.deepEqual(applied, []);
});

test('large filter lists mount in bounded batches and expose a keyboard-accessible continuation', async t => {
  const values = Array.from({ length: 10_000 }, (_, i) => String(i));
  const ui = await render(t, SpreadsheetFilterChoices, { values, disabled: false, onApply() {}, onClear() {}, onClose() {} });
  const choices = () => ui.root.findAllByProps({ className: 'lxs-filter-choice' });
  assert.equal(choices().length, 100);
  await act(async () => button(ui, 'さらに 100 件を表示').props.onClick());
  assert.equal(choices().length, 200);
  await act(async () => ui.root.findByProps({ 'aria-label': '表示する値' }).props.onScroll({ currentTarget: { scrollHeight: 6000, scrollTop: 5800, clientHeight: 224 } }));
  assert.equal(choices().length, 300);
  await act(async () => ui.root.findByProps({ type: 'search' }).props.onChange({ currentTarget: { value: '9999' } }));
  assert.equal(choices().length, 1);
  await ui.update({ disabled: true });
  assert.equal(button(ui, '適用').props.disabled, true);
  assert.ok(ui.root.findAllByType('input').every(item => item.props.disabled));
});

function controller() {
  const autoFilter = { range: { top: 2, left: 1, bottom: 8, right: 2 }, columns: [{ column: 2, values: ['東京'] }] };
  return { activeSheet: { id: 'main', cells: { B3: { value: '地域' }, C3: { value: '人数' } } },
    calculated: { main: { B3: '地域', C3: 0 } }, selection: { anchor: { row: 2, column: 1 }, focus: { row: 8, column: 2 } },
    features: { filters: true }, filters: { autoFilter, disabled: false, toggle() {}, clear() {}, setValues() {}, getValues: () => ['東京'] },
    selectionApi: { getSelection: () => ({ sheetId: 'main' }) }, filterViewApi: { getFilterView: () => autoFilter },
    getRevision: () => 0, reportError(error) { throw error; } };
}

test('header controls follow the selected header coordinates and retain keyboard access in read-only views', async t => {
  const c = controller(); c.readOnly = true;
  const ui = await render(t, SpreadsheetFilterButtons, { controller: c, columnOffsets: [48, 128, 208, 288], rowOffsets: [28, 56, 84, 112, 140] });
  const headers = ui.root.findAllByType('button');
  assert.equal(headers.length, 2);
  assert.deepEqual(headers[0].props.style, { left: 188, top: 92, width: 20, height: 20 });
  assert.equal(headers[0].props['aria-label'], '地域のフィルター');
  assert.equal(headers[1].props['aria-label'], '0のフィルター');
  assert.equal(headers[1].props['data-filtered'], true);
  assert.equal(headers[0].props.disabled, false);
  let stopped = false;
  headers[0].props.onPointerDown({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  const element = { closest: () => null };
  await act(async () => headers[0].props.onKeyDown({ key: 'ArrowDown', nativeEvent: {}, currentTarget: element, preventDefault() {}, stopPropagation() {} }));
  assert.equal(ui.root.findAllByType('button')[0].props['aria-expanded'], true);
  await ui.update({ controller: { ...c, features: { filters: false } } });
  assert.equal(ui.root.findAllByType('button').length, 0);
});

test('ribbon filter actions reflect active conditions and block creating a disjoint filter range', async t => {
  const c = controller(); let toggled = 0, cleared = 0;
  c.filters.toggle = () => { toggled++; }; c.filters.clear = () => { cleared++; };
  const ui = await render(t, SpreadsheetFilterToolbar, { controller: c });
  const toggle = () => ui.root.findAllByType('button').find(item => item.props['aria-label'] === 'フィルター');
  assert.equal(toggle().props['aria-pressed'], true);
  await act(async () => toggle().props.onClick());
  await act(async () => ui.root.findByProps({ 'aria-label': 'フィルター条件をクリア' }).props.onClick());
  assert.equal(toggled, 1); assert.equal(cleared, 1);
  await ui.update({ controller: { ...c, filters: { ...c.filters, autoFilter: undefined }, selection: { ...c.selection, ranges: [c.selection, c.selection] } } });
  assert.equal(toggle().props.disabled, true);
  assert.equal(ui.root.findByProps({ 'aria-label': 'フィルター条件をクリア' }).props.disabled, true);
});

test('a menu cannot apply to a sheet or filter changed synchronously through the host API', async t => {
  const c = controller(), calls = [];
  c.filters.setValues = (...args) => calls.push(args);
  let sheetId = 'main', filter = c.filters.autoFilter, revision = 0;
  c.selectionApi.getSelection = () => ({ sheetId }); c.filterViewApi.getFilterView = () => filter;
  c.getRevision = () => revision;
  const ui = await render(t, SpreadsheetFilterButtons, { controller: c, columnOffsets: [48, 128, 208, 288], rowOffsets: [28, 56, 84, 112, 140] });
  const element = { closest: () => ({}) };
  await act(async () => ui.root.findAllByType('button')[0].props.onClick({ currentTarget: element, stopPropagation() {} }));
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 1);
  sheetId = 'other';
  await act(async () => button(ui, '適用').props.onClick());
  assert.deepEqual(calls, []);
  sheetId = 'main'; filter = { ...filter };
  await act(async () => button(ui, '適用').props.onClick());
  assert.deepEqual(calls, []);
  filter = c.filters.autoFilter; revision++;
  await act(async () => button(ui, '適用').props.onClick());
  assert.deepEqual(calls, []);
  let prevented = false;
  await act(async () => ui.root.findByProps({ role: 'dialog' }).props.onKeyDown({ key: 'Escape', nativeEvent: {}, stopPropagation() {}, preventDefault() { prevented = true; } }));
  assert.equal(prevented, true); assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
});

test('menu choices deduplicate different spellings of an imported criterion before applying', async t => {
  const c = controller(), calls = [];
  c.filters.getValues = () => ['APPLE', 'Orange'];
  c.filters.autoFilter.columns = [{ column: 1, values: ['apple'] }];
  c.filters.setValues = (...args) => calls.push(args);
  const ui = await render(t, SpreadsheetFilterButtons, { controller: c, columnOffsets: [48, 128, 208, 288], rowOffsets: [28, 56, 84, 112, 140] });
  await act(async () => ui.root.findAllByType('button')[0].props.onClick({ currentTarget: { closest: () => ({}) }, stopPropagation() {} }));
  assert.equal(ui.root.findAllByProps({ className: 'lxs-filter-choice' }).length, 2);
  await act(async () => button(ui, '適用').props.onClick());
  assert.deepEqual(calls, [[1, ['APPLE']]]);
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
});
