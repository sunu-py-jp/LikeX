import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: 'export { default as Spreadsheet } from "./src"; export * from "./src/api/resolve-features"; export * from "./src/commands/stage-spreadsheet-commands"; export { normalizeWorkbook } from "./src/model";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'feature-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { Spreadsheet, resolveSpreadsheetFeatures, stageSpreadsheetCommands, normalizeWorkbook } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const initialWorkbook = () => ({ sheets: ['main', 'other'].map(id => ({ id, name: id, rowCount: 10, columnCount: 5,
  cells: { A1: { value: 'existing' }, B1: { value: '=1+2', format: { bold: true } } } })) });
async function mount(t, overrides = {}) {
  const ref = createRef();
  let renderer;
  let props = { initialWorkbook: initialWorkbook(), onSave: () => {}, ...overrides, ref };
  await act(async () => { renderer = create(createElement(Spreadsheet, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { ref, get root() { return renderer.root; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Spreadsheet, props))); } };
}
const labels = root => root.findAll(node => typeof node.type === 'string' && node.props['aria-label']).map(node => node.props['aria-label']);
const optionValues = select => select.findAllByType('option').map(option => option.props.value);
const commands = [
  ['insertRows', 'rows.insert', 'insert-row', { index: 2 }],
  ['deleteRows', 'rows.delete', 'delete-row', { index: 2 }],
  ['insertColumns', 'columns.insert', 'insert-column', { index: 2 }],
  ['deleteColumns', 'columns.delete', 'delete-column', { index: 2 }],
  ['createSheet', 'sheets.add', null, {}],
  ['renameSheet', 'sheets.rename', 'rename', { name: 'renamed' }],
  ['deleteSheet', 'sheets.delete', 'delete', {}],
];

test('features default on and disabled master switches dominate explicitly enabled children', () => {
  assert.ok(Object.values(resolveSpreadsheetFeatures()).every(value => value === true));
  const features = resolveSpreadsheetFeatures({ clipboard: false, copy: true, cut: true, paste: true,
    rowColumnOperations: false, insertRows: true, deleteRows: true, insertColumns: true, deleteColumns: true,
    sheets: false, createSheet: true, renameSheet: true, deleteSheet: true });
  for (const key of ['clipboard', 'copy', 'cut', 'paste', 'rowColumnOperations', 'insertRows', 'deleteRows', 'insertColumns', 'deleteColumns', 'sheets', 'createSheet', 'renameSheet', 'deleteSheet'])
    assert.equal(features[key], false, key);
  const independent = resolveSpreadsheetFeatures({ copy: false, deleteRows: false, createSheet: false });
  assert.equal(independent.cut, true); assert.equal(independent.paste, true);
  assert.equal(independent.insertRows, true); assert.equal(independent.deleteColumns, true);
  assert.equal(independent.sheets, true); assert.equal(independent.renameSheet, true);
});

test('every fine-grained structure feature hides its GUI action and rejects the matching external command', async t => {
  const view = await mount(t);
  for (const [feature, type, option, payload] of commands) {
    await view.update({ features: { [feature]: false } });
    const before = view.ref.current.getWorkbook();
    let result;
    await act(async () => { result = await view.ref.current.execute({ type, ...(type === 'sheets.add' ? {} : { sheetId: 'main' }), ...payload }); });
    assert.equal(result.code, 'FEATURE_DISABLED', feature);
    assert.strictEqual(view.ref.current.getWorkbook(), before, feature);
    if (feature === 'createSheet') assert.equal(labels(view.root).includes('シートを追加'), false);
    else if (feature === 'renameSheet') {
      await act(async () => view.root.findByProps({ 'data-lxs-sheet-id': 'main' }).props.onDoubleClick());
      assert.equal(labels(view.root).includes('シート名'), false);
    } else if (feature === 'deleteSheet') {
      const tab = { dataset: { lxsSheetId: 'main' }, closest: selector => selector === '[data-lxs-sheet-id]' ? tab : null };
      await act(async () => view.root.findByType('section').props.onContextMenu({ target: tab, clientX: 0, clientY: 0, preventDefault() {} }));
      assert.equal(view.root.findAllByProps({ role: 'menuitem' }).some(item => item.children[0] === '削除'), false);
    }
    else {
      const select = view.root.findByProps({ 'aria-label': '行と列の操作' });
      assert.equal(optionValues(select).includes(option), false, feature);
      assert.ok(optionValues(select).length > 1, 'independent sibling actions remain');
    }
  }
  assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 0);
});

test('disabled structure groups prevent partial batches and keep the workbook unchanged', () => {
  const workbook = normalizeWorkbook(initialWorkbook());
  for (const [feature, type, , payload] of commands) {
    const master = type.startsWith('sheets.') ? 'sheets' : 'rowColumnOperations';
    const result = stageSpreadsheetCommands(workbook, [{ type: 'cells.set', sheetId: 'main', values: { A1: 'partial' } },
      { type, ...(type === 'sheets.add' ? {} : { sheetId: 'main' }), ...payload }],
    resolveSpreadsheetFeatures({ [master]: false, [feature]: true }), () => 'generated-id');
    assert.equal(result.code, 'FEATURE_DISABLED', feature);
    assert.equal(result.commandIndex, 1);
    assert.equal('workbook' in result, false);
    assert.equal(workbook.sheets[0].cells.A1.value, 'existing');
  }
});

test('copy, cut and paste controls can each disappear independently and readonly keeps permitted copy', async t => {
  const view = await mount(t);
  for (const [feature, label] of [['copy', 'コピー'], ['cut', '切り取り'], ['paste', '貼り付け']]) {
    await view.update({ features: { [feature]: false } });
    for (const [, other] of [['copy', 'コピー'], ['cut', '切り取り'], ['paste', '貼り付け']])
      assert.equal(labels(view.root).includes(other), other !== label);
  }
  await view.update({ features: { clipboard: false, copy: true, cut: true, paste: true } });
  for (const label of ['コピー', '切り取り', '貼り付け']) assert.equal(labels(view.root).includes(label), false);
  await view.update({ features: {}, onSave: undefined });
  assert.equal(labels(view.root).includes('コピー'), true);
  assert.equal(labels(view.root).includes('切り取り'), false);
  assert.equal(labels(view.root).includes('貼り付け'), false);
});

test('sheet management can be disabled while sheet navigation remains available', async t => {
  const view = await mount(t, { features: { createSheet: false, renameSheet: false, deleteSheet: false } });
  assert.equal(labels(view.root).includes('シートを追加'), false);
  assert.equal(labels(view.root).includes('シートの操作'), false);
  const other = view.root.findAllByProps({ role: 'tab' }).find(tab => tab.children[0] === 'other');
  await act(async () => { other.props.onDoubleClick(); other.props.onClick(); });
  assert.equal(labels(view.root).includes('シート名'), false);
  assert.equal(view.root.findByProps({ role: 'grid' }).props['aria-label'], 'other');
  await view.update({ features: { sheets: false } });
  assert.equal(labels(view.root).includes('ワークシート'), false);
});

test('save false leaves editing enabled but prevents all persistence entry points', async t => {
  let saves = 0;
  const view = await mount(t, { onSave: () => { saves++; }, features: { save: false } });
  assert.equal(view.root.findAllByProps({ className: 'lxs-save' }).length, 0);
  await act(async () => {
    assert.equal((await view.ref.current.execute({ type: 'cells.set', sheetId: 'main', values: { A1: 'draft' } })).ok, true);
    assert.equal(await view.ref.current.save(), false);
    view.root.findByProps({ role: 'region' }).props.onKeyDown({ key: 's', ctrlKey: true, nativeEvent: {}, target: { closest: () => null }, preventDefault() {} });
  });
  assert.equal(saves, 0);
  assert.equal(view.ref.current.getWorkbook().sheets[0].cells.A1.value, 'draft');
});

test('all disabled feature controls disappear without removing pre-existing data', async t => {
  const features = Object.fromEntries(Object.keys(resolveSpreadsheetFeatures()).map(key => [key, false]));
  const view = await mount(t, { features });
  const controls = labels(view.root);
  for (const label of ['コピー', '切り取り', '貼り付け', '元に戻す', 'やり直す', '関数を挿入', '文字色', '背景色', '左揃え', '中央揃え', '右揃え', '上揃え', '上下中央', '下揃え',
    'セルを結合', '結合を解除', '行と列の操作', '画像を挿入', '図形を挿入', 'テキストボックスを挿入', 'コメントを挿入', 'ワークシート', 'セルの値・数式'])
    assert.equal(controls.includes(label), false, label);
  assert.equal(view.root.findAllByProps({ role: 'separator' }).length, 0);
  assert.equal(view.ref.current.getWorkbook().sheets[0].cells.B1.value, '=1+2');
  assert.equal(view.ref.current.getWorkbook().sheets[0].cells.B1.format.bold, true);
  assert.equal(view.root.findAllByProps({ 'aria-label': 'B1 3' }).length, 1);
});

test('a sheet rename retains its input while permission is pending or denied, then can be retried', async t => {
  let decide;
  const view = await mount(t, { onEditRequest: () => new Promise(resolve => { decide = resolve; }) });
  const tab = view.root.findAllByProps({ role: 'tab' }).find(item => item.children[0] === 'main');
  await act(async () => tab.props.onDoubleClick());
  await act(async () => view.root.findByProps({ 'aria-label': 'シート名' }).props.onChange({ target: { value: 'Renamed sheet' } }));
  await act(async () => view.root.findByProps({ 'aria-label': 'シート名' }).props.onBlur());
  assert.equal(view.ref.current.getEditState().mode, 'requesting');
  assert.equal(view.root.findByProps({ 'aria-label': 'シート名' }).props.value, 'Renamed sheet');
  assert.equal(view.root.findByProps({ 'aria-label': 'シート名' }).props.readOnly, true);
  await act(async () => decide(false));
  assert.equal(view.ref.current.getWorkbook().sheets[0].name, 'main');
  assert.equal(view.root.findByProps({ 'aria-label': 'シート名' }).props.value, 'Renamed sheet');
  await act(async () => view.root.findByProps({ 'aria-label': 'シート名' }).props.onBlur());
  await act(async () => decide(true));
  assert.equal(view.ref.current.getWorkbook().sheets[0].name, 'Renamed sheet');
  assert.equal(labels(view.root).includes('シート名'), false);
});

test('a pending comment edit survives denied permission and cancellation ignores a late grant', async t => {
  let decide;
  const view = await mount(t, { onEditRequest: () => new Promise(resolve => { decide = resolve; }) });
  await act(async () => view.root.findByProps({ 'aria-label': 'コメントを挿入' }).props.onClick());
  await act(async () => view.root.findByProps({ 'aria-label': 'A1 のコメントを編集' }).props.onChange({ target: { value: 'Keep this draft' } }));
  await act(async () => view.root.findByProps({ className: 'lxs-comment-apply' }).props.onClick());
  assert.equal(view.ref.current.getEditState().mode, 'requesting');
  assert.equal(view.root.findByProps({ 'aria-label': 'A1 のコメントを編集' }).props.value, 'Keep this draft');
  await act(async () => decide(false));
  assert.equal(view.ref.current.getWorkbook().sheets[0].comments?.A1, undefined);
  assert.equal(view.root.findByProps({ 'aria-label': 'A1 のコメントを編集' }).props.value, 'Keep this draft');
  await act(async () => view.root.findByProps({ className: 'lxs-comment-apply' }).props.onClick());
  await act(async () => view.root.findByProps({ 'aria-label': 'A1 のコメントを編集' }).props.onKeyDown({ key: 'Escape', nativeEvent: {}, stopPropagation() {}, preventDefault() {} }));
  await act(async () => decide(true));
  assert.equal(labels(view.root).includes('A1 のコメントを編集'), false);
  assert.equal(view.ref.current.getWorkbook().sheets[0].comments?.A1, undefined);
});
