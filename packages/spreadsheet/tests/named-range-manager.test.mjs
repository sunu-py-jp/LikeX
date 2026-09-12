import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { StrictMode, act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const output = await build({ stdin: { contents: `
  export { useSpreadsheet } from './src/state/use-spreadsheet';
  export { useNamedRangeManager } from './src/ui/named-ranges/use-named-range-manager';
  export { SpreadsheetNamedRanges, SpreadsheetNamedRangePanel, NamedRangeDialog } from './src/ui/spreadsheet-named-ranges';
  export { selectionBounds } from './src/state/selection';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'render-real-named-range-forms', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    // The renderer has no DOM portal container. Only replace its shell; keep
    // the real ribbon, panel, form, manager and command/permission handlers.
    builder.onResolve({ filter: /\/spreadsheet-dialog$/ }, () => ({ path: 'dialog', namespace: 'inline-dialog' }));
    builder.onLoad({ filter: /.*/, namespace: 'inline-dialog' }, () => ({ contents: `
      import { createElement } from 'react';
      export const SpreadsheetDialog = ({ title, children, actions, onClose }) =>
        createElement('section', { role: 'dialog', 'aria-label': title }, children, actions,
          createElement('button', { 'aria-label': '閉じる', onClick: onClose }, '×'));
    `, loader: 'js' }));
  } }] });
const { useSpreadsheet, useNamedRangeManager, SpreadsheetNamedRanges, SpreadsheetNamedRangePanel, NamedRangeDialog,
  selectionBounds } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const initialWorkbook = () => ({
  sheets: [
    { id: 'one', name: '売上', rowCount: 12, columnCount: 8,
      cells: { A1: { value: '商品', format: { bold: true } }, B2: { value: '1200' } } },
    { id: 'two', name: '計画', rowCount: 12, columnCount: 8, cells: { C3: { value: '2400' } } },
  ],
  namedRanges: [
    { id: 'sales', name: 'SalesRange', sheetId: 'one', range: { top: 0, left: 0, bottom: 1, right: 1 } },
    { id: 'plan', name: 'PlanRange', sheetId: 'two', range: { top: 2, left: 2, bottom: 4, right: 3 } },
  ],
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : (node?.children ?? []).map(text).join('');
const controls = (root, type, label) => root.findAllByType(type)
  .filter(node => node.props['aria-label'] === label || text(node) === label);
const control = (root, type, label) => {
  const matches = controls(root, type, label);
  assert.equal(matches.length, 1, `expected one ${type}: ${label}`);
  return matches[0];
};
async function click(root, label) {
  const button = control(root, 'button', label);
  assert.equal(!!button.props.disabled, false, `${label} should be enabled`);
  await act(async () => { button.props.onClick({ preventDefault() {}, stopPropagation() {} }); });
}
async function change(root, label, value) {
  const field = root.findAllByType('label').find(node => text(node).startsWith(label));
  assert.ok(field, `missing field: ${label}`);
  const input = field.findAll(node => ['input', 'select', 'textarea'].includes(node.type))[0];
  assert.ok(input, `missing input: ${label}`);
  await act(async () => input.props.onChange({ target: { value }, currentTarget: { value } }));
}
function fieldValue(root, label) {
  const field = root.findAllByType('label').find(node => text(node).startsWith(label));
  assert.ok(field, `missing field: ${label}`);
  return field.findAll(node => ['input', 'select', 'textarea'].includes(node.type))[0].props.value;
}

async function mount(t, overrides = {}, strict = false) {
  let c, manager, renderer, unmounted = false;
  const events = [], changes = [];
  let props = { initialWorkbook: initialWorkbook(), onSave: workbook => workbook,
    onEvent: event => events.push(event), onChange: workbook => changes.push(workbook), ...overrides };
  function Probe() {
    c = useSpreadsheet(props);
    manager = useNamedRangeManager(c);
    return createElement('div', null,
      createElement(SpreadsheetNamedRanges, { controller: c, manager }),
      createElement(SpreadsheetNamedRangePanel, { controller: c, manager }),
      manager.dialogTarget && createElement(NamedRangeDialog, {
        controller: c, target: manager.dialogTarget, onClose: manager.closeDialog,
      }));
  }
  const tree = () => strict ? createElement(StrictMode, null, createElement(Probe)) : createElement(Probe);
  await act(async () => { renderer = create(tree()); });
  const unmount = async () => {
    if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); }
  };
  t.after(unmount);
  return { get c() { return c; }, get manager() { return manager; }, get root() { return renderer.root; }, events, changes, unmount,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(tree())); },
    async run(command) { await act(async () => assert.equal((await c.executeCommand(command)).ok, true)); },
    dialog: () => renderer.root.findByProps({ role: 'dialog' }),
  };
}

test('the ribbon opens separate add and management surfaces; adding captures the selected range and is undoable', async t => {
  const ui = await mount(t);
  assert.equal(text(control(ui.root, 'button', '名前付き範囲を追加')).includes('追加'), true);
  assert.equal(text(control(ui.root, 'button', '名前付き範囲を管理')).includes('管理'), true);
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
  await act(async () => ui.c.selectRange({ row: 3, column: 1 }, { row: 5, column: 3 }));
  await click(ui.root, '名前付き範囲を追加');
  assert.equal(fieldValue(ui.dialog(), '範囲名'), '');
  assert.equal(fieldValue(ui.dialog(), 'セル範囲'), 'B4:D6');
  assert.equal(ui.dialog().findAllByType('select').length, 0, 'adding does not offer an unrelated definition picker');
  await change(ui.dialog(), '範囲名', 'PlannedRange');
  await click(ui.dialog(), '追加');
  const added = ui.c.workbook.namedRanges.find(item => item.name === 'PlannedRange');
  assert.equal(added.sheetId, 'one');
  assert.deepEqual(added.range, { top: 3, left: 1, bottom: 5, right: 3 });
  assert.equal(ui.c.dirty, true);
  assert.equal(ui.changes.length, 1);
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
  await act(async () => assert.equal(await ui.c.undo(), true));
  assert.deepEqual(ui.c.workbook.namedRanges, initialWorkbook().namedRanges);
  assert.equal(ui.c.dirty, false);
  await act(async () => assert.equal(await ui.c.redo(), true));
  assert.equal(ui.c.workbook.namedRanges.find(item => item.name === 'PlannedRange').id, added.id);
});

test('management lists the whole workbook and cross-sheet navigation changes selection without dirty history', async t => {
  const ui = await mount(t);
  const before = ui.c.getWorkbook();
  await click(ui.root, '名前付き範囲を管理');
  assert.equal(ui.manager.open, true);
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
  assert.match(text(ui.root), /SalesRange/);
  assert.match(text(ui.root), /PlanRange/);
  assert.match(text(ui.root), /売上/);
  assert.match(text(ui.root), /計画/);
  assert.match(text(ui.root), /C3:D5/);
  await click(ui.root, 'PlanRangeへ移動');
  assert.equal(ui.c.activeSheet.id, 'two');
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 2, left: 2, bottom: 4, right: 3 });
  assert.equal(ui.c.getWorkbook(), before);
  assert.equal(ui.c.dirty, false);
  assert.equal(ui.c.canUndo, false);
  assert.equal(ui.changes.length, 0);
  await click(ui.root, 'SalesRangeへ移動');
  assert.equal(ui.c.activeSheet.id, 'one');
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 0, left: 0, bottom: 1, right: 1 });
  assert.equal(ui.events.filter(event => event.type === 'change').length, 0);
});

test('opening add commits a pending cell editor before capturing the dialog revision', async t => {
  const ui = await mount(t);
  await act(async () => {
    ui.c.select({ row: 3, column: 1 });
    ui.c.beginEdit({ row: 3, column: 1 }, 'commit before naming');
  });
  await click(ui.root, '名前付き範囲を追加');
  assert.equal(ui.c.editing, null);
  assert.equal(ui.c.workbook.sheets[0].cells.B4.value, 'commit before naming');
  assert.equal(fieldValue(ui.dialog(), 'セル範囲'), 'B4');
  await change(ui.dialog(), '範囲名', 'CommittedCell');
  await click(ui.dialog(), '追加');
  assert.ok(ui.c.workbook.namedRanges.some(item => item.name === 'CommittedCell'));
  assert.equal(ui.changes.length, 2);
});

test('editing a card prefills its own sheet definition, preserves its ID and deletes only the definition by default', async t => {
  const ui = await mount(t);
  await click(ui.root, '名前付き範囲を管理');
  await click(ui.root, 'PlanRangeを編集');
  assert.equal(fieldValue(ui.dialog(), '範囲名'), 'PlanRange');
  assert.equal(fieldValue(ui.dialog(), 'セル範囲'), 'C3:D5');
  assert.equal(fieldValue(ui.dialog(), '削除時のセル'), 'none');
  await change(ui.dialog(), '範囲名', 'RevisedPlan');
  await change(ui.dialog(), 'セル範囲', 'C3:E6');
  await click(ui.dialog(), '更新');
  const updated = ui.c.workbook.namedRanges.find(item => item.id === 'plan');
  assert.equal(updated.name, 'RevisedPlan');
  assert.equal(updated.sheetId, 'two');
  assert.deepEqual(updated.range, { top: 2, left: 2, bottom: 5, right: 4 });
  assert.ok(control(ui.root, 'button', 'RevisedPlanへ移動'));
  await click(ui.root, 'RevisedPlanを編集');
  await click(ui.dialog(), '削除');
  assert.equal(ui.c.workbook.namedRanges.some(item => item.id === 'plan'), false);
  assert.equal(ui.c.workbook.sheets[1].cells.C3.value, '2400');
  assert.equal(controls(ui.root, 'button', 'RevisedPlanへ移動').length, 0);
  await act(async () => assert.equal(await ui.c.undo(), true));
  assert.deepEqual(ui.c.workbook.namedRanges.find(item => item.id === 'plan'), updated);
  assert.ok(control(ui.root, 'button', 'RevisedPlanへ移動'));
});

test('open management cards follow structural range changes and removal without reopening', async t => {
  const ui = await mount(t);
  await click(ui.root, '名前付き範囲を管理');
  await ui.run({ type: 'rows.insert', sheetId: 'two', index: 0, count: 2 });
  assert.match(text(ui.root), /C5:D7/);
  await click(ui.root, 'PlanRangeへ移動');
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 4, left: 2, bottom: 6, right: 3 });
  await ui.run({ type: 'sheets.rename', sheetId: 'two', name: '来期計画' });
  assert.match(text(ui.root), /来期計画/);
  await ui.run({ type: 'sheets.delete', sheetId: 'two' });
  assert.equal(controls(ui.root, 'button', 'PlanRangeへ移動').length, 0);
  assert.ok(control(ui.root, 'button', 'SalesRangeへ移動'));
});

for (const strict of [false, true]) test(`adding opens after a name edit and structural insertion are both undone (StrictMode: ${strict})`, async t => {
  const ui = await mount(t, {}, strict);
  await click(ui.root, '名前付き範囲を管理');
  await click(ui.root, 'SalesRangeへ移動');
  await click(ui.root, 'SalesRangeを編集');
  await change(ui.dialog(), '範囲名', 'ChangedSales');
  await click(ui.dialog(), '更新');
  await ui.run({ type: 'rows.insert', sheetId: 'one', index: 1 });
  assert.deepEqual(ui.c.workbook.namedRanges[0].range, { top: 0, left: 0, bottom: 2, right: 1 });
  await act(async () => assert.equal(await ui.c.undo(), true));
  await act(async () => assert.equal(await ui.c.undo(), true));
  assert.deepEqual(ui.c.workbook.namedRanges, initialWorkbook().namedRanges);
  assert.ok(control(ui.root, 'button', 'SalesRangeへ移動'));
  assert.equal(!!control(ui.root, 'button', '名前付き範囲を追加').props.disabled, false);
  await click(ui.root, '名前付き範囲を追加');
  assert.equal(fieldValue(ui.dialog(), '範囲名'), '');
  assert.equal(fieldValue(ui.dialog(), 'セル範囲'), 'A1:B2');
});

test('disabling named ranges closes management and hides its controls without removing definitions', async t => {
  const ui = await mount(t);
  await click(ui.root, '名前付き範囲を管理');
  await click(ui.root, 'SalesRangeを編集');
  const before = ui.c.getWorkbook();
  await ui.update({ features: { namedRanges: false } });
  assert.equal(controls(ui.root, 'button', '名前付き範囲を追加').length, 0);
  assert.equal(controls(ui.root, 'button', '名前付き範囲を管理').length, 0);
  assert.equal(controls(ui.root, 'button', 'SalesRangeへ移動').length, 0);
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
  assert.equal(ui.c.getWorkbook(), before);
  await ui.update({ features: { namedRanges: true } });
  assert.equal(ui.manager.open, false);
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
});

test('readonly management permits navigation while withholding add, edit and delete actions', async t => {
  const ui = await mount(t, { readOnly: true });
  assert.equal(controls(ui.root, 'button', '名前付き範囲を追加').length, 0);
  await click(ui.root, '名前付き範囲を管理');
  assert.equal(controls(ui.root, 'button', 'PlanRangeを編集').length, 0);
  await click(ui.root, 'PlanRangeへ移動');
  assert.equal(ui.c.activeSheet.id, 'two');
  assert.equal(ui.c.dirty, false);
  assert.equal(ui.c.canUndo, false);
  assert.equal(ui.changes.length, 0);
});

test('disabling sheet navigation keeps all cards visible but disables other-sheet navigation and editing', async t => {
  const ui = await mount(t, { features: { sheets: false } });
  const before = ui.c.getWorkbook();
  await click(ui.root, '名前付き範囲を管理');
  assert.equal(control(ui.root, 'button', 'PlanRangeへ移動').props.disabled, true);
  assert.equal(control(ui.root, 'button', 'PlanRangeを編集').props.disabled, true);
  assert.equal(!!control(ui.root, 'button', 'SalesRangeへ移動').props.disabled, false);
  assert.equal(!!control(ui.root, 'button', 'SalesRangeを編集').props.disabled, false);
  await act(async () => {
    const event = { preventDefault() {}, stopPropagation() {} };
    control(ui.root, 'button', 'PlanRangeへ移動').props.onClick(event);
    control(ui.root, 'button', 'PlanRangeを編集').props.onClick(event);
  });
  assert.equal(ui.c.activeSheet.id, 'one');
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
  await click(ui.root, 'SalesRangeへ移動');
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 0, left: 0, bottom: 1, right: 1 });
  assert.equal(ui.c.getWorkbook(), before);
  assert.equal(ui.c.dirty, false);
  assert.equal(ui.c.canUndo, false);
});

test('an edit captured before a newer workbook change cannot overwrite that definition', async t => {
  const ui = await mount(t);
  await click(ui.root, '名前付き範囲を管理');
  await click(ui.root, 'SalesRangeを編集');
  await change(ui.dialog(), '範囲名', 'OldIntent');
  await ui.run({ type: 'namedRanges.update', sheetId: 'one', namedRangeId: 'sales', name: 'NewerName', range: 'A1:C3' });
  const before = ui.c.getWorkbook();
  await act(async () => control(ui.dialog(), 'button', '更新').props.onClick());
  assert.equal(ui.c.getWorkbook(), before);
  assert.equal(ui.c.workbook.namedRanges[0].name, 'NewerName');
  assert.match(text(ui.dialog().findByProps({ role: 'alert' })), /状態が変わりました/);
});

for (const boundary of ['cancel', 'feature off', 'readonly', 'unmount']) {
  test(`a pending named-range edit cannot publish after ${boundary}`, async t => {
    const permission = deferred();
    let context;
    const ui = await mount(t, { onEditRequest(_request, operation) { context = operation; return permission.promise; } });
    await click(ui.root, '名前付き範囲を管理');
    await click(ui.root, 'SalesRangeを編集');
    await change(ui.dialog(), '範囲名', 'PendingName');
    const before = ui.c.getWorkbook();
    await click(ui.dialog(), '更新');
    assert.equal(ui.c.requesting, true);
    assert.equal(context.signal.aborted, false);
    if (boundary === 'cancel') await click(ui.dialog(), 'キャンセル');
    if (boundary === 'feature off') await ui.update({ features: { namedRanges: false } });
    if (boundary === 'readonly') await ui.update({ readOnly: true });
    if (boundary === 'unmount') await ui.unmount();
    assert.equal(context.signal.aborted, true);
    await act(async () => permission.resolve(true));
    assert.equal(ui.c.getWorkbook(), before);
    assert.equal(ui.changes.length, 0);
    assert.equal(ui.c.canUndo, false);
    assert.equal(ui.c.getEditState().mode, 'view');
  });
}

test('a newer permission baseline invalidates the captured edit instead of applying old coordinates', async t => {
  const permission = deferred();
  const ui = await mount(t, { onEditRequest: () => permission.promise });
  await click(ui.root, '名前付き範囲を管理');
  await click(ui.root, 'SalesRangeを編集');
  await change(ui.dialog(), '範囲名', 'OldIntent');
  await click(ui.dialog(), '更新');
  const newer = initialWorkbook();
  newer.namedRanges[0] = { ...newer.namedRanges[0], name: 'ServerName', range: { top: 4, left: 0, bottom: 5, right: 1 } };
  await act(async () => permission.resolve({ allowed: true, workbook: newer }));
  assert.deepEqual(ui.c.workbook.namedRanges, newer.namedRanges);
  assert.equal(ui.c.dirty, false);
  assert.equal(ui.c.canUndo, false);
  assert.equal(ui.changes.length, 0);
  assert.equal(ui.c.workbook.namedRanges.some(item => item.name === 'OldIntent'), false);
});

test('revoking sheet navigation while a different-sheet edit awaits permission prevents its write', async t => {
  const permission = deferred();
  const ui = await mount(t, { onEditRequest: () => permission.promise });
  await click(ui.root, '名前付き範囲を管理');
  await click(ui.root, 'PlanRangeを編集');
  await change(ui.dialog(), '範囲名', 'PendingPlan');
  const before = ui.c.getWorkbook();
  await click(ui.dialog(), '更新');
  assert.equal(ui.c.requesting, true);
  await ui.update({ features: { sheets: false } });
  await act(async () => permission.resolve(true));
  assert.equal(ui.c.workbook.namedRanges.find(item => item.id === 'plan').name, 'PlanRange');
  assert.equal(ui.c.getWorkbook(), before);
  assert.equal(ui.changes.length, 0);
  assert.equal(ui.c.canUndo, false);
});
