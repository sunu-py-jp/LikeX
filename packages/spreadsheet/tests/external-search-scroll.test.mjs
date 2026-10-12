import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ entryPoints: [new URL('../src/ui/spreadsheet-external-search-dialog.tsx', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'delayed-floating-portal', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /\/spreadsheet-floating-window$/ }, () => ({ path: 'floating', namespace: 'delayed-portal' }));
    builder.onLoad({ filter: /.*/, namespace: 'delayed-portal' }, () => ({ loader: 'js', contents: `
      import {useEffect,useState,createElement as h} from 'react';
      export function SpreadsheetFloatingWindow({children}) {
        const [stage,setStage] = useState(0);
        useEffect(() => {globalThis.__externalSearchPortalStage=setStage},[]);
        return stage ? h('portal-window',{'data-ready':stage===2},children) : null;
      }` }));
  } }] });
const { SpreadsheetExternalSearchDialog } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('selected row reveals after delayed portal/frame layout and on reopen, without resetting manual scroll or navigating the workbook', async t => {
  const pending = new Map(), scrolled = [], cancelled = [], navigation = [];
  let serial = 0, listScrollTop = 0, frameReady = false;
  const view = { requestAnimationFrame(callback) { const id = ++serial; pending.set(id, callback); return id; },
    cancelAnimationFrame(id) { pending.delete(id); cancelled.push(id); } };
  const results = Array.from({ length: 60 }, (_, index) => ({ id: String(index + 1), target: { sheetId: 'main', range: `A${index + 1}` } }));
  const workbook = { sheets: [{ id: 'main', name: 'Main', rowCount: 100, columnCount: 5, cells: {} }] };
  let controller = { workbook, externalSearchResults: results, externalSearch: { results },
    searchPanel: { externalResultId: '60', externalError: null }, editing: null, pendingObjectEdit: false,
    chooseExternalSearchResult: id => navigation.push(id), closeSearch() {}, openLocalSearch() {} };
  let renderer;
  const render = () => h(SpreadsheetExternalSearchDialog, { controller });
  await act(async () => { renderer = create(render(), { createNodeMock(element) {
    if (element.type !== 'button') return null;
    const location = element.props.children[0].props.children;
    return { ownerDocument: { defaultView: view }, scrollIntoView(options) {
      assert.equal(frameReady, true, 'scroll only after the window has a usable frame');
      assert.deepEqual(options, { block: 'nearest' }); scrolled.push(location); listScrollTop = Number(location.split('A')[1]) * 70;
    } };
  } }); });
  t.after(async () => { await act(async () => renderer.unmount()); delete globalThis.__externalSearchPortalStage; });
  const mountPortal = async () => {
    await act(async () => globalThis.__externalSearchPortalStage(1));
    assert.equal(pending.size, 1, 'attachment schedules reveal even though the parent selected id did not change');
    await act(async () => globalThis.__externalSearchPortalStage(2)); frameReady = true;
  };
  const flushFrames = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()); };
  assert.equal(renderer.toJSON(), null); assert.deepEqual(scrolled, []);
  await mountPortal(); assert.deepEqual(scrolled, []); flushFrames();
  assert.deepEqual(scrolled, ['Main!A60']); assert.ok(listScrollTop > 0); assert.deepEqual(navigation, []);
  listScrollTop = 50;
  controller = { ...controller, workbook: { ...workbook }, externalSearchResults: [...results] };
  await act(async () => renderer.update(render())); flushFrames();
  assert.equal(listScrollTop, 50, 'ordinary updates retain the user scroll'); assert.equal(scrolled.length, 1);
  await act(async () => renderer.update(null)); frameReady = false; listScrollTop = 0;
  await act(async () => renderer.update(render()));
  await mountPortal(); flushFrames(); assert.deepEqual(scrolled, ['Main!A60', 'Main!A60']);
  controller = { ...controller, searchPanel: { externalResultId: '1', externalError: null } };
  await act(async () => renderer.update(render())); assert.equal(pending.size, 1);
  await act(async () => renderer.update(null)); assert.equal(pending.size, 0);
  flushFrames(); assert.equal(scrolled.length, 2, 'unmounted rows never apply a queued reveal'); assert.ok(cancelled.length > 0);
  assert.deepEqual(navigation, [], 'list reveal does not select another cell or sheet');
});
