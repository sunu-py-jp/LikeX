import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
  export { ExplorerProvider, createExplorerStore } from './src/state/explorer-context.tsx';
  export { ExplorerDialogs } from './src/ui/explorer-dialogs.tsx';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react-and-transparent-dialogs', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'preview-test' }));
  builder.onLoad({ filter: /.*/, namespace: 'preview-test' }, () => ({ loader: 'tsx', resolveDir: packageRoot, contents: `
    import { createContext, createElement, cloneElement, isValidElement, useContext } from 'react';
    function family(kind) {
      const Context = createContext(null);
      return Object.fromEntries(['Root', 'Portal', 'Trigger', 'Content', 'Item', 'Title', 'Description', 'Close', 'Overlay', 'Cancel', 'Action'].map(part => [part,
        ({ children, open, asChild, ...props }) => {
          const root = useContext(Context);
          if (part === 'Root') return open === false ? null : createElement(Context.Provider, { value: props },
            createElement('test-' + kind + '-root', props, children));
          if (part === 'Close' || part === 'Cancel') props.onClick = () => root?.onOpenChange?.(false);
          if (asChild && isValidElement(children)) return cloneElement(children, props);
          return createElement('test-' + kind + '-' + part.toLowerCase(), props, children);
        }]));
    }
    export const Tooltip = family('tooltip'), Dialog = family('dialog'), AlertDialog = family('alert'),
      DropdownMenu = family('dropdown'), ContextMenu = family('context');
  ` }));
} }] });
const { useExplorerWorkspace, useExplorerViewController, ExplorerProvider, createExplorerStore, ExplorerDialogs } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-preview-integration.mjs').toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entry = (id, name = `${id}.txt`, parent = 'root', kind = 'file') => ({
  id, name, parent, kind, extension: kind === 'file' ? name.split('.').at(-1).toLowerCase() : '',
  size: kind === 'file' ? 4 : 0, mime: kind === 'file' ? 'text/plain' : '', favorite: 0,
  source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
});
const initialEntries = () => [entry('alpha'), entry('beta'), entry('folder', 'Folder', 'root', 'folder')];
const text = node => typeof node === 'string' ? node : node.children.map(text).join('');
async function mount(t, supplied = {}, ui = false, strict = false) {
  let latest, workspace, renderer, unmounted = false;
  const events = [], reads = [];
  const ownerDocument = { defaultView: Object.assign(new EventTarget(), { closed: false }),
    addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [], getElementById: () => null };
  let props = { initialEntries: initialEntries(), onSave: () => {},
    readFile: async id => { reads.push(id); return new Blob(['body']); }, onEvent: event => events.push(event), ...supplied };
  function Probe({ options }) {
    workspace = useExplorerWorkspace(options);
    latest = useExplorerViewController(options, workspace, 'main', ownerDocument);
    return ui ? h(ExplorerProvider, { value: latest }, h(ExplorerDialogs)) : null;
  }
  const tree = () => strict ? h(StrictMode, null, h(Probe, { options: props })) : h(Probe, { options: props });
  await change(() => { renderer = create(tree()); });
  async function unmount() { if (unmounted) return; unmounted = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { get current() { return latest; }, get workspace() { return workspace; }, get root() { return renderer.root; },
    events, reads, ownerDocument, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
    async open(id = 'alpha') { await change(() => latest.openEntry(latest.entries.find(item => item.id === id))); },
  };
}

test('preview handler decisions preserve host takeover and explicitly select default synchronously or asynchronously', async t => {
  for (const asynchronous of [false, true]) for (const result of [undefined, 'handled', 'default']) {
    await t.test(`${asynchronous ? 'async' : 'sync'} ${String(result)}`, async t => {
      const calls = [];
      const app = await mount(t, { onPreviewRequest: request => { calls.push(request); return asynchronous ? Promise.resolve(result) : result; } });
      await change(() => {
        app.current.openEntry(app.current.entries[0]);
        assert.equal(calls.length, 1, 'host handler runs in the original user activation');
      });
      assert.equal(app.current.preview?.id, result === 'default' ? 'alpha' : undefined);
      assert.equal(app.current.dirty, false);
      assert.deepEqual(app.reads, []);
      assert.deepEqual(app.events.filter(event => event.type === 'preview').map(event => event.external), [true]);
    });
  }
});

test('late default decisions cannot reopen a superseded, closed, disabled, or unmounted preview', async t => {
  const transitions = {
    close: app => change(() => app.current.setPreviewId(null)),
    navigate: app => change(() => app.current.navigate('folder')),
    anotherFile: app => app.open('beta'),
    deniedFile: app => app.open('denied'),
    tab: app => change(() => app.current.addTab()),
    directTab: app => change(() => app.workspace.tabs.forWindow('main').addTab()),
    featureCycle: async app => { await app.update({ features: { preview: false } }); await app.update({ features: { preview: true } }); },
    permissionCycle: async app => { await app.update({ getEntryPermissions: () => ({ preview: false }) }); await app.update({ getEntryPermissions: undefined }); },
    closedWindow: app => { app.ownerDocument.defaultView.closed = true; },
    pagehide: app => { app.ownerDocument.defaultView.dispatchEvent(new Event('pagehide')); },
    unmount: app => app.unmount(),
    deleted: app => change(() => app.current.act('delete', ['alpha'])),
  };
  for (const [name, transition] of Object.entries(transitions)) await t.test(name, async t => {
    const pending = deferred();
    const app = await mount(t, { initialEntries: [...initialEntries(), entry('denied')],
      getEntryPermissions: request => request.id === 'denied' ? { preview: false } : {},
      onPreviewRequest: request => request.id === 'alpha' ? pending.promise : 'default' });
    await app.open();
    await transition(app);
    await change(() => pending.resolve('default'));
    assert.equal(app.current.preview?.id, name === 'anotherFile' ? 'beta' : undefined);
  });
});

test('default fallback rechecks current permissions and uses current entry metadata', async t => {
  const pending = deferred();
  let allowed = true;
  const app = await mount(t, { onPreviewRequest: () => pending.promise,
    getEntryPermissions: () => ({ preview: allowed ? true : { allowed: false, message: 'Current preview denied' } }) });
  await app.open();
  allowed = false;
  await change(() => pending.resolve('default'));
  assert.equal(app.current.preview, undefined);
  assert.equal(app.current.notification.message, 'Current preview denied');
  allowed = true;
  const next = deferred();
  await app.update({ onPreviewRequest: () => next.promise });
  await app.open();
  await change(() => app.current.act('rename', ['alpha'], { name: 'latest.txt' }));
  await change(() => app.current.act('move', ['alpha'], { parent: 'folder' }));
  await change(() => next.resolve('default'));
  assert.equal(app.current.preview.name, 'latest.txt');
  assert.equal(app.current.preview.parent, 'folder');
});

test('host preview navigation keeps a new asynchronous fallback in its target folder', async t => {
  const ref = createRef();
  const pending = deferred();
  const app = await mount(t, { ref, initialEntries: [...initialEntries(), entry('nested', 'nested.txt', 'folder')],
    onPreviewRequest: () => pending.promise });
  await change(() => assert.deepEqual(ref.current.previewFile({ id: 'nested' }), { ok: true }));
  assert.equal(app.current.location, 'folder');
  assert.equal(app.current.preview, undefined);
  await change(() => pending.resolve('default'));
  assert.equal(app.current.preview?.id, 'nested');
});

test('a preview requested after opening a tab in the same batch belongs to that tab', async t => {
  const pending = deferred();
  const app = await mount(t, { onPreviewRequest: () => pending.promise });
  const previousTab = app.current.activeTabId;
  await change(() => {
    app.current.addTab();
    app.current.openEntry(app.current.entries[0]);
  });
  assert.notEqual(app.current.activeTabId, previousTab);
  await change(() => pending.resolve('default'));
  assert.equal(app.current.preview?.id, 'alpha');
});

test('StrictMode effect replay preserves the one initial asynchronous default preview', async t => {
  const pending = deferred();
  let calls = 0;
  const app = await mount(t, { selectedFile: 'alpha', selectedFileMode: 'preview',
    onPreviewRequest: () => { calls++; return pending.promise; } }, false, true);
  assert.equal(calls, 1);
  assert.equal(app.current.preview, undefined);
  await change(() => pending.resolve('default'));
  assert.equal(app.current.preview?.id, 'alpha');
  assert.equal(calls, 1);
});

test('synchronous preview observers can change current metadata before host dispatch', async t => {
  let app;
  const requests = [];
  app = await mount(t, { onEvent: event => {
    if (event.type === 'preview') app.workspace.draft.apply({ action: 'rename', ids: ['alpha'], name: 'current.txt' });
  }, onPreviewRequest: request => { requests.push(request); return 'default'; } });
  await app.open();
  assert.equal(requests[0].name, 'current.txt');
  assert.equal(requests[0].path, '/current.txt');
  assert.equal(app.current.preview.name, 'current.txt');
});

test('custom preview content bypasses all built-in loading while retaining dialog title, actions and closing', async t => {
  let resolves = 0;
  const app = await mount(t, { renderPreview: () => h('article', { 'data-custom-preview': true }, 'host content'),
    resolvePreviewSource: () => { resolves++; throw new Error('must not resolve'); } }, true);
  await app.open();
  assert.equal(app.root.findAllByProps({ 'data-custom-preview': true }).length, 1);
  assert.match(text(app.root), /alpha\.txt/);
  assert.match(text(app.root), /ダウンロード/);
  assert.deepEqual(app.reads, []); assert.equal(resolves, 0);
  await app.update({ features: { download: false } });
  assert.equal(text(app.root).includes('ダウンロード'), false);
  await change(() => app.root.findByType('test-dialog-root').props.onOpenChange(false));
  assert.equal(app.current.preview, undefined);
});

test('null and undefined preview renderers use the built-in body while false remains empty', async t => {
  for (const result of [null, undefined, false, 'element']) await t.test(String(result), async t => {
    const app = await mount(t, { renderPreview: context => result === 'element' ? context.defaultPreview : result }, true);
    await app.open();
    assert.equal(app.reads.length, result === false ? 0 : 1);
    assert.equal(text(app.root).includes('body'), result !== false);
  });
});

test('render payloads and default element props never expose live draft entries', async t => {
  let context;
  const app = await mount(t, { renderPreview: value => {
    context = value;
    Reflect.set(value.entry, 'name', 'changed.txt');
    Reflect.set(value.entry.source, 'id', 'changed-body');
    Reflect.set(value.defaultPreview.props.entry, 'parent', 'folder');
    Reflect.set(value.defaultPreview.props.entry.source, 'id', 'changed-default');
    return false;
  } }, true);
  const before = structuredClone(app.current.entries);
  await app.open();
  assert.notEqual(context.entry, app.current.entries[0]);
  assert.notEqual(context.defaultPreview.props.entry, app.current.entries[0]);
  assert.notEqual(context.entry, context.defaultPreview.props.entry);
  assert.deepEqual(app.current.entries, before);
  assert.deepEqual(app.reads, []);
});

test('processing state and updated host labels reach preview renderers without data edits', async t => {
  const contexts = [];
  let labels = 0;
  const app = await mount(t, { processingEntryIds: ['beta'], renderPreview: context => {
    contexts.push(context); return h('span', null, context.processingLabel ?? 'ready');
  }, getProcessingLabel: request => { labels++; assert.equal(request.path, '/alpha.txt'); return 'converting'; } }, true);
  await app.open();
  assert.equal(contexts.at(-1).processing, false); assert.equal(labels, 0);
  const before = app.current.entries;
  await app.update({ processingEntryIds: ['alpha'] });
  assert.equal(contexts.at(-1).processing, true);
  assert.equal(contexts.at(-1).processingLabel, 'converting');
  await app.update({ getProcessingLabel: () => 'finishing' });
  assert.equal(contexts.at(-1).processingLabel, 'finishing');
  await app.update({ getProcessingLabel: () => { throw new Error('host label failed'); } });
  assert.equal(contexts.at(-1).processingLabel, '処理状況を確認できません');
  await app.update({ processingEntryIds: [] });
  assert.equal(contexts.at(-1).processing, false);
  assert.equal(contexts.at(-1).processingLabel, undefined);
  assert.equal(app.current.entries, before); assert.equal(app.current.dirty, false);
  assert.deepEqual(app.reads, []);
});

test('host preview callback identity changes publish to selector subscribers', () => {
  const before = { renderPreview: () => null, resolvePreviewSource: () => null, getProcessingLabel: () => 'first', previewOptions: {} };
  const after = { renderPreview: () => false, resolvePreviewSource: () => undefined, getProcessingLabel: () => 'second', previewOptions: { pdfSandbox: false } };
  const store = createExplorerStore(before);
  for (const key of Object.keys(before)) assert.equal(store.getSnapshot()[key], before[key]);
  store.publish(after);
  for (const key of Object.keys(after)) assert.equal(store.getSnapshot()[key], after[key]);
});
