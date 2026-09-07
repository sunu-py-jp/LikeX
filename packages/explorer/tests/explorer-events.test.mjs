import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { useExplorerController } from './src/state/use-explorer-controller.ts';
      export { FAVORITES, RECENT } from './src/state/view-state.ts';
    `,
    resolveDir: packageRoot,
    sourcefile: 'test-explorer-events.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'shared-react-instance',
    setup(builder) {
      builder.onResolve({ filter: /^(react|react-test-renderer|lucide-react)(\/.*)?$/ }, ({ path }) => ({
        path: import.meta.resolve(path), external: true,
      }));
    },
  }],
});
const { useExplorerController, FAVORITES, RECENT } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);

const entry = (id, name, parent = 'root', kind = 'file') => ({
  id, parent, name, kind, size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '',
  createdAt: '2026-09-05T23:00:00.000Z', updatedAt: '2026-09-05T23:00:00.000Z',
  favorite: id === 'alpha' ? 1 : 0,
  source: kind === 'file' ? { kind: 'existing', id: `content-${id}` } : null,
});
const initialEntries = () => [
  entry('target', 'Target', 'root', 'folder'),
  entry('alpha', 'Alpha.TXT'), entry('beta', 'Beta.txt'),
  entry('child', 'Child.txt', 'target'),
];
const byId = (hook, id) => hook.current.entries.find(item => item.id === id);
const eventsOf = (hook, type) => hook.events.filter(event => event.type === type);
const change = async callback => { await act(async () => { await callback(); }); };

async function mountController(t, supplied = {}) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const listeners = new Set();
  const anchors = [];
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: (type, handler) => { if (type === 'keydown') listeners.add(handler); },
      removeEventListener: (type, handler) => { if (type === 'keydown') listeners.delete(handler); },
      querySelectorAll: () => [],
      getElementById: () => null,
      body: { appendChild() {} },
      createElement(tag) {
        assert.equal(tag, 'a');
        const anchor = { href: '', download: '', clicks: 0, removed: false,
          click() { this.clicks++; }, remove() { this.removed = true; } };
        anchors.push(anchor);
        return anchor;
      },
    },
  });
  const events = [];
  let props = { initialEntries: initialEntries(), onSave() {}, onEvent: event => events.push(event), ...supplied };
  let latest;
  let renderer;
  let unmounted = false;
  function Probe({ options }) {
    latest = useExplorerController(options);
    return null;
  }
  const element = () => createElement(StrictMode, null, createElement(Probe, { options: props }));
  async function unmount() {
    if (!renderer || unmounted) return;
    unmounted = true;
    await change(() => renderer.unmount());
  }
  t.after(async () => {
    try {
      await unmount();
      assert.equal(listeners.size, 0);
    } finally {
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else delete globalThis.document;
    }
  });
  await change(() => { renderer = create(element()); });
  return {
    get current() { return latest; }, events, anchors, unmount,
    async update(patch) {
      props = { ...props, ...patch };
      await change(() => renderer.update(element()));
    },
  };
}

test('StrictMode mount, unrelated renders and observer replacement do not emit initial state', async t => {
  const hook = await mountController(t);
  assert.deepEqual(hook.events, []);
  await change(() => hook.current.setNotification({ kind: 'info', message: 'Unrelated' }));
  assert.deepEqual(hook.events, []);
  const replacementEvents = [];
  await hook.update({ onEvent: event => replacementEvents.push(event) });
  assert.deepEqual(replacementEvents, []);
  await change(() => hook.current.navigate('target'));
  assert.equal(replacementEvents.filter(event => event.type === 'navigate').length, 1);
  assert.deepEqual(hook.events, [], 'subsequent actions use the current observer');
});

test('view signatures are reused while typing or notifying, including large selections without an observer', async t => {
  const files = Array.from({ length: 2000 }, (_, index) => entry(`item-${index}`, `Item ${index}.txt`));
  const hook = await mountController(t, { initialEntries: files, onEvent: undefined });
  await change(() => hook.current.setSelected(files.map(file => file.id)));
  const selected = hook.current.selected;
  const visible = hook.current.visible;
  let selectionSerializations = 0;
  const stringify = JSON.stringify;
  t.mock.method(JSON, 'stringify', (...args) => {
    if (args[0] === selected) selectionSerializations++;
    return Reflect.apply(stringify, JSON, args);
  });
  await change(() => hook.current.setNotification({ kind: 'info', message: 'Unrelated state' }));
  await hook.update({ title: 'Updated host title' });
  assert.equal(hook.current.selected, selected);
  assert.equal(hook.current.visible, visible);
  assert.equal(selectionSerializations, 0, 'an unchanged 2000-item selection is not serialized on unrelated renders');

  await change(() => hook.current.startRename(['item-0']));
  const renameSelection = hook.current.selected;
  let renameSerializations = 0;
  t.mock.method(JSON, 'stringify', (...args) => {
    if (args[0] === renameSelection) renameSerializations++;
    return Reflect.apply(stringify, JSON, args);
  });
  await change(() => hook.current.setRenameValue('Draft one'));
  await change(() => hook.current.setRenameValue('Draft two'));
  assert.equal(hook.current.selected, renameSelection);
  assert.equal(hook.current.visible, visible);
  assert.equal(renameSerializations, 0);
  assert.equal(hook.current.dirty, false, 'uncommitted rename text still does not change the draft');
});

test('attaching or restoring an observer never replays view changes made while it was absent', async t => {
  const hook = await mountController(t, { onEvent: undefined });
  await change(() => hook.current.navigate('target'));
  await change(() => hook.current.setSelected(['child']));
  const observed = [];
  const observer = event => observed.push(event);
  await hook.update({ onEvent: observer });
  assert.deepEqual(observed, []);
  await change(() => hook.current.navigate('root'));
  assert.equal(observed.filter(event => event.type === 'navigate').length, 1);
  await hook.update({ onEvent: undefined });
  await change(() => hook.current.navigate(FAVORITES));
  await change(() => hook.current.changeView('large'));
  await change(() => hook.current.setSelected(['alpha']));
  const count = observed.length;
  await hook.update({ onEvent: observer });
  await change(() => hook.current.setNotification({ kind: 'info', message: 'No replay' }));
  assert.equal(observed.length, count);
  await change(() => hook.current.navigate('target'));
  assert.equal(observed.filter(event => event.type === 'navigate').length, 2);
});

test('observer mutations cannot corrupt memoized view signatures or cause later phantom events', async t => {
  const events = [];
  const hook = await mountController(t, { onEvent(event) {
    events.push(event.type);
    if (event.type === 'navigate') event.location.name = 'Host mutation';
    if (event.type === 'view') event.sort.key = 'size';
  } });
  await change(() => hook.current.navigate('target'));
  await change(() => hook.current.changeView('large'));
  const navigateCount = events.filter(type => type === 'navigate').length;
  const viewCount = events.filter(type => type === 'view').length;
  await change(() => hook.current.setSelected(['child']));
  await change(() => hook.current.setDetailId('child'));
  assert.equal(events.filter(type => type === 'navigate').length, navigateCount);
  assert.equal(events.filter(type => type === 'view').length, viewCount);
  assert.equal(hook.current.title, 'Target');
  assert.deepEqual(hook.current.sort, { key: 'name', asc: true });
});

test('navigation reports resolved folder and special locations once per actual change', async t => {
  const hook = await mountController(t, { rootLabel: '記事一覧' });
  await change(() => hook.current.navigate('root'));
  assert.deepEqual(eventsOf(hook, 'navigate'), []);
  await change(() => hook.current.navigate('target'));
  assert.deepEqual(eventsOf(hook, 'navigate'), [{
    type: 'navigate', location: { kind: 'folder', id: 'target', name: 'Target', path: '/Target' },
  }]);
  await change(() => hook.current.navigate('target'));
  assert.equal(eventsOf(hook, 'navigate').length, 1);
  await change(() => hook.current.navigate(FAVORITES));
  await change(() => hook.current.navigate(RECENT));
  await change(() => hook.current.navigate('root'));
  assert.deepEqual(eventsOf(hook, 'navigate').slice(1).map(event => event.location), [
    { kind: 'favorites', id: null, name: 'お気に入り', path: null },
    { kind: 'recent', id: null, name: '最近更新したファイル', path: null },
    { kind: 'folder', id: 'root', name: '記事一覧', path: '/' },
  ]);
});

test('selection emits the effective visible selection, deduplicates no-ops and batches updates', async t => {
  const hook = await mountController(t);
  await change(() => hook.current.setSelected(['alpha', 'alpha', 'missing']));
  const first = eventsOf(hook, 'selection');
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].ids, ['alpha']);
  assert.equal(first[0].entries[0].path, '/Alpha.TXT');
  assert.equal(first[0].entries[0].extension, 'txt');
  await change(() => hook.current.setSelected(['alpha']));
  assert.equal(eventsOf(hook, 'selection').length, 1);
  await change(() => { hook.current.setSelected([]); hook.current.setSelected(['beta']); });
  assert.equal(eventsOf(hook, 'selection').length, 2);
  assert.deepEqual(eventsOf(hook, 'selection').at(-1).ids, ['beta']);
  await change(() => hook.current.navigate('target'));
  assert.deepEqual(eventsOf(hook, 'selection').at(-1), { type: 'selection', ids: [], entries: [] });
});

test('tabs emit their current titles and active ID, without events for no-op selects or closes', async t => {
  const hook = await mountController(t);
  const firstId = hook.current.activeTabId;
  let secondId;
  await change(() => { secondId = hook.current.addTab(); });
  assert.deepEqual(eventsOf(hook, 'tabs'), [{
    type: 'tabs', activeTabId: secondId,
    tabs: [{ id: firstId, title: 'ファイル' }, { id: secondId, title: 'ファイル' }],
  }]);
  await change(() => { hook.current.selectTab(secondId); hook.current.selectTab('missing'); hook.current.closeTab('missing'); });
  assert.equal(eventsOf(hook, 'tabs').length, 1);
  await change(() => hook.current.navigate('target'));
  assert.deepEqual(eventsOf(hook, 'tabs').at(-1).tabs, [
    { id: firstId, title: 'ファイル' }, { id: secondId, title: 'Target' },
  ]);
  await change(() => hook.current.selectTab(firstId));
  assert.equal(eventsOf(hook, 'tabs').at(-1).activeTabId, firstId);
  await change(() => hook.current.closeTab(secondId));
  assert.deepEqual(eventsOf(hook, 'tabs').at(-1), {
    type: 'tabs', activeTabId: firstId, tabs: [{ id: firstId, title: 'ファイル' }],
  });
  const count = eventsOf(hook, 'tabs').length;
  await change(() => hook.current.closeTab(firstId));
  assert.equal(eventsOf(hook, 'tabs').length, count);
});

test('view emits every effective display setting once and ignores equal values', async t => {
  const hook = await mountController(t);
  const expected = { type: 'view', mode: 'details', compact: false, query: '', sort: { key: 'name', asc: true } };
  const settings = [
    [() => hook.current.changeView('large'), { mode: 'large' }],
    [() => hook.current.changeCompact(true), { compact: true }],
    [() => hook.current.setQuery('Alpha'), { query: 'Alpha' }],
    [() => hook.current.setSort({ key: 'size', asc: false }), { sort: { key: 'size', asc: false } }],
  ];
  for (let index = 0; index < settings.length; index++) {
    const [update, patch] = settings[index];
    await change(update);
    Object.assign(expected, patch);
    assert.equal(eventsOf(hook, 'view').length, index + 1);
    assert.deepEqual(eventsOf(hook, 'view').at(-1), expected);
    await change(update);
    assert.equal(eventsOf(hook, 'view').length, index + 1);
  }
  await change(() => {
    hook.current.changeView('medium'); hook.current.changeCompact(false);
    hook.current.setQuery(''); hook.current.setSort({ key: 'name', asc: true });
  });
  assert.equal(eventsOf(hook, 'view').length, settings.length + 1, 'one committed render produces one view event');
});

test('details emits an item description on open and null on close, without no-op events', async t => {
  const hook = await mountController(t);
  await change(() => hook.current.setDetailId('alpha'));
  assert.equal(eventsOf(hook, 'details').length, 1);
  assert.equal(eventsOf(hook, 'details')[0].entry.path, '/Alpha.TXT');
  await change(() => hook.current.setDetailId('alpha'));
  assert.equal(eventsOf(hook, 'details').length, 1);
  await change(() => hook.current.setDetailId(null));
  assert.deepEqual(eventsOf(hook, 'details').at(-1), { type: 'details', entry: null });
  await change(() => hook.current.setDetailId('missing'));
  assert.equal(eventsOf(hook, 'details').length, 2);
});

test('clipboard and preview events describe each explicit operation, including repeated opens', async t => {
  const externalRequests = [];
  const hook = await mountController(t);
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  await change(() => hook.current.copyToClipboard('move', ['beta']));
  assert.deepEqual(eventsOf(hook, 'clipboard'), [
    { type: 'clipboard', action: 'copy', ids: ['alpha'] },
    { type: 'clipboard', action: 'copy', ids: ['alpha'] },
    { type: 'clipboard', action: 'move', ids: ['beta'] },
  ]);
  await change(() => hook.current.openEntry(byId(hook, 'alpha')));
  await change(() => hook.current.openEntry(byId(hook, 'alpha')));
  assert.deepEqual(eventsOf(hook, 'preview').map(event => event.external), [false, false]);
  assert.equal(hook.current.preview.id, 'alpha');
  await hook.update({ onPreviewRequest: request => externalRequests.push(request) });
  await change(() => hook.current.openEntry(byId(hook, 'alpha')));
  assert.equal(eventsOf(hook, 'preview').at(-1).external, true);
  assert.equal(eventsOf(hook, 'preview').at(-1).request.path, '/Alpha.TXT');
  assert.equal(externalRequests.length, 1);
  assert.equal(hook.current.preview, undefined);
  await change(() => hook.current.openEntry(byId(hook, 'target')));
  assert.equal(eventsOf(hook, 'preview').length, 3, 'opening a folder is navigation');
});

test('download emits start then success or error, with isolated file metadata', async t => {
  const readCalls = [];
  t.mock.method(URL, 'createObjectURL', () => 'blob:explorer-test');
  const hook = await mountController(t, { readFile: async item => { readCalls.push(item); return new Blob(['text']); } });
  await change(() => hook.current.download(byId(hook, 'alpha')));
  assert.deepEqual(eventsOf(hook, 'download').map(event => event.status), ['start', 'success']);
  assert.equal(eventsOf(hook, 'download')[0].request.path, '/Alpha.TXT');
  assert.equal(readCalls.length, 1);
  assert.equal(hook.anchors[0].download, 'Alpha.TXT');
  assert.equal(hook.anchors[0].clicks, 1);
  assert.equal(hook.anchors[0].removed, true);
  await hook.update({ readFile: async () => { throw new Error('Storage unavailable'); } });
  await change(() => hook.current.download(byId(hook, 'beta')));
  assert.deepEqual(eventsOf(hook, 'download').map(event => event.status), ['start', 'success', 'start', 'error']);
  assert.equal(eventsOf(hook, 'download').at(-1).message, 'Storage unavailable');
  assert.equal(hook.anchors.length, 1);
});

test('pending downloads use the current observer and stop notifying after removal or unmount', async t => {
  for (const transition of ['replace', 'remove', 'unmount']) {
    for (const outcome of ['success', 'error']) {
      await t.test(`${transition} before ${outcome}`, async t => {
        t.mock.method(URL, 'createObjectURL', () => 'blob:explorer-test');
        const previousEvents = [];
        const currentEvents = [];
        let resolveRead;
        let rejectRead;
        const pendingRead = new Promise((resolve, reject) => {
          resolveRead = resolve;
          rejectRead = reject;
        });
        const hook = await mountController(t, {
          readFile: () => pendingRead,
          onEvent: event => previousEvents.push(event),
        });
        let download;
        await change(() => { download = hook.current.download(byId(hook, 'alpha')); });
        assert.deepEqual(previousEvents.map(event => event.status), ['start']);
        if (transition === 'replace') {
          await hook.update({ onEvent: event => currentEvents.push(event) });
        } else if (transition === 'remove') {
          await hook.update({ onEvent: undefined });
        } else {
          await hook.unmount();
        }
        assert.deepEqual(currentEvents, [], 'changing the observer does not replay start');
        await change(async () => {
          if (outcome === 'success') resolveRead(new Blob(['text']));
          else rejectRead(new Error('Pending read failed'));
          await download;
        });
        assert.deepEqual(previousEvents.filter(event => event.type === 'download').map(event => event.status), ['start'], 'the old observer never receives completion');
        assert.equal(previousEvents.filter(event => event.type === 'download-cancelled').length, transition === 'unmount' ? 1 : 0);
        if (transition === 'replace') {
          assert.deepEqual(currentEvents.map(event => event.status), [outcome]);
          assert.equal(currentEvents[0].type, 'download');
          assert.equal(currentEvents[0].request.id, 'alpha');
          if (outcome === 'error') assert.equal(currentEvents[0].message, 'Pending read failed');
        } else {
          assert.deepEqual(currentEvents, []);
        }
        assert.equal(hook.anchors.length, transition !== 'unmount' && outcome === 'success' ? 1 : 0);
      });
    }
  }
});

test('mutating observer payloads cannot change selection, tabs, view, clipboard or draft files', async t => {
  t.mock.method(URL, 'createObjectURL', () => 'blob:explorer-test');
  const reads = [];
  const mutateItem = item => {
    if (!item) return;
    item.name = 'Observer changed the name'; item.parent = 'missing';
    if (item.source) item.source.id = 'observer-content';
  };
  const hook = await mountController(t, {
    readFile: async sourceId => { reads.push(sourceId); return new Blob(['text']); },
    onEvent(event) {
      if (event.type === 'selection') { event.ids.push('beta'); event.entries.forEach(mutateItem); }
      if (event.type === 'tabs') { event.tabs[0].title = 'Observer title'; event.tabs.push({ id: 'fake', title: 'Fake' }); }
      if (event.type === 'view') event.sort.key = 'size';
      if (event.type === 'navigate') { event.location.id = 'missing'; event.location.name = 'Observer folder'; }
      if (event.type === 'details') mutateItem(event.entry);
      if (event.type === 'clipboard') event.ids.push('beta');
      if (event.type === 'preview' || event.type === 'download') mutateItem(event.request);
    },
  });
  const original = structuredClone(hook.current.entries);
  await change(() => hook.current.setSelected(['alpha']));
  assert.deepEqual(hook.current.selected, ['alpha']);
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  assert.deepEqual(hook.current.clipboard.ids, ['alpha']);
  await change(() => hook.current.setDetailId('alpha'));
  assert.equal(hook.current.details.name, 'Alpha.TXT');
  await change(() => hook.current.openEntry(byId(hook, 'alpha')));
  assert.equal(hook.current.preview.name, 'Alpha.TXT');
  await change(() => hook.current.download(byId(hook, 'alpha')));
  assert.equal(reads[0], 'content-alpha');
  assert.equal(hook.anchors[0].download, 'Alpha.TXT');
  await change(() => hook.current.changeCompact(true));
  assert.deepEqual(hook.current.sort, { key: 'name', asc: true });
  await change(() => hook.current.addTab());
  assert.equal(hook.current.tabs.length, 2);
  assert.equal(hook.current.tabs[0].title, 'ファイル');
  await change(() => hook.current.navigate('target'));
  assert.equal(hook.current.location, 'target');
  assert.deepEqual(hook.current.entries, original);
  assert.equal(hook.current.dirty, false);
});

test('observer synchronous throws and asynchronous rejections do not prevent operations', async t => {
  for (const asynchronous of [false, true]) {
    await t.test(asynchronous ? 'async rejection' : 'synchronous throw', async t => {
      t.mock.method(URL, 'createObjectURL', () => 'blob:explorer-test');
      const observed = [];
      const previews = [];
      const hook = await mountController(t, {
        readFile: async () => new Blob(['text']),
        onPreviewRequest: request => previews.push(request),
        onEvent(event) {
          observed.push(event.type);
          if (asynchronous) return Promise.reject(new Error('Observer failed'));
          throw new Error('Observer failed');
        },
      });
      await change(() => hook.current.setSelected(['alpha']));
      await change(() => hook.current.copyToClipboard('copy', ['alpha']));
      await change(() => hook.current.openEntry(byId(hook, 'alpha')));
      await change(() => hook.current.setDetailId('alpha'));
      await change(() => hook.current.changeView('large'));
      await change(() => hook.current.download(byId(hook, 'alpha')));
      await change(() => hook.current.addTab());
      await change(() => hook.current.navigate('target'));
      assert.equal(hook.current.location, 'target');
      assert.equal(hook.current.tabs.length, 2);
      assert.deepEqual(hook.current.clipboard.ids, ['alpha']);
      assert.equal(previews.length, 1);
      assert.equal(hook.anchors[0].clicks, 1);
      for (const type of ['selection', 'clipboard', 'preview', 'details', 'view', 'download', 'tabs', 'navigate']) {
        assert.ok(observed.includes(type), `${type} was dispatched without interrupting the operation`);
      }
      assert.equal(hook.current.notification?.kind, 'info');
    });
  }
});

test('disabled feature routes produce no notifications or external side effects', async t => {
  let reads = 0;
  let previews = 0;
  const hook = await mountController(t, {
    features: { favorites: false, recent: false, copy: false, move: false, preview: false,
      download: false, details: false, search: false, sort: false, tabs: false, pathInput: false },
    selection: { mode: 'none' },
    view: { allowedModes: ['details'] },
    readFile: async () => { reads++; return new Blob(['text']); },
    onPreviewRequest: () => { previews++; },
  });
  await change(() => {
    hook.current.navigate(FAVORITES); hook.current.navigate(RECENT); hook.current.navigatePath('/Target');
    hook.current.setSelected(['alpha']); hook.current.setQuery('Alpha');
    hook.current.setSort({ key: 'size', asc: false }); hook.current.changeView('large'); hook.current.changeCompact(true);
    hook.current.addTab(); hook.current.selectTab('missing'); hook.current.closeTab(hook.current.activeTabId);
    hook.current.setDetailId('alpha'); hook.current.copyToClipboard('copy', ['alpha']);
    hook.current.copyToClipboard('move', ['alpha']); hook.current.openEntry(byId(hook, 'alpha'));
  });
  await change(() => hook.current.download(byId(hook, 'alpha')));
  assert.deepEqual(hook.events, []);
  assert.equal(reads, 0); assert.equal(previews, 0); assert.equal(hook.anchors.length, 0);
});
