import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `export { default as Explorer } from './src/explorer.tsx';`, resolveDir: packageRoot },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'transparent-menu-primitives', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'menu-order' }));
    builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'menu-order' }));
    builder.onLoad({ filter: /.*/, namespace: 'menu-order' }, ({ path }) => ({ resolveDir: packageRoot, loader: 'tsx', contents: path === 'portal'
      ? 'export const createPortal = children => children;'
      : `import { createElement, cloneElement, isValidElement } from 'react';
        function family(kind) {
          return Object.fromEntries(['Root', 'Provider', 'Portal', 'Trigger', 'Content', 'Item', 'Separator', 'ItemIndicator',
            'RadioGroup', 'RadioItem', 'CheckboxItem', 'Title', 'Description', 'Close', 'Overlay', 'Cancel', 'Action'].map(part => [part,
            ({ children, asChild, ...props }) => {
              if (part === 'Root' && ['dialog', 'alert'].includes(kind) && props.open === false) return null;
              if (['Provider', 'Portal'].includes(part)) return children;
              if (asChild && isValidElement(children)) return cloneElement(children, props);
              return createElement('mock-' + kind + '-' + part.toLowerCase(), props, children);
            }
          ]));
        }
        export const Tooltip = family('tooltip'), DropdownMenu = family('dropdown'), ContextMenu = family('context'),
          Dialog = family('dialog'), AlertDialog = family('alert');`,
    }));
  } }],
});
const { Explorer } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const file = { id: 'alpha', parent: 'root', name: 'Alpha.txt', kind: 'file', size: 4, mime: 'text/plain',
  source: { kind: 'existing', id: 'alpha' }, createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z', favorite: 0 };
const customItems = [
  { id: 'first', label: 'AIに指示', onSelect() {} },
  { id: 'second', label: '外部サービスを開く', onSelect() {} },
];
const noEntryBuiltins = Object.fromEntries(['preview', 'details', 'copy', 'move', 'rename', 'favorites', 'download', 'delete'].map(key => [key, false]));
const tokens = menu => menu.findAll(node => ['mock-context-item', 'mock-context-separator'].includes(node.type))
  .map(node => node.type === 'mock-context-separator' ? '|' : node.children.filter(child => typeof child === 'string').join(''));

async function mount(t, supplied = {}) {
  let renderer;
  await act(async () => { renderer = create(h(Explorer, {
    initialEntries: [file], onSave() {}, ui: { rowActions: false }, getContextMenuItems: () => customItems, ...supplied,
  })); });
  t.after(() => act(() => renderer.unmount()));
  const entryRoot = renderer.root.findAllByType('mock-context-root').find(node => {
    const content = node.findAllByType('mock-context-content');
    return content.length === 1 && !content[0].props['data-explorer-background-menu'];
  });
  assert.ok(entryRoot, 'the file has a context menu');
  await act(async () => entryRoot.props.onOpenChange(true));
  return { renderer, entryRoot, menu: entryRoot.findByType('mock-context-content') };
}

test('custom entry actions retain provider order immediately above the delete group', async t => {
  const view = await mount(t);
  assert.deepEqual(tokens(view.menu), [
    '開く', '詳細を表示', '|', 'コピー', '切り取り', '移動先を選択', 'コピー先を選択', '名前を変更',
    'お気に入りに追加', 'ダウンロード', '|', 'AIに指示', '外部サービスを開く', '|', '削除',
  ]);
});

test('disabled deletion and read-only entry menus end with custom actions and no trailing separator', async t => {
  for (const options of [{ features: { delete: false } }, { readOnly: true }]) {
    await t.test(JSON.stringify(options), async subtest => {
      const view = await mount(subtest, options);
      const labels = tokens(view.menu);
      assert.equal(labels.includes('削除'), false);
      assert.deepEqual(labels.slice(-3), ['|', 'AIに指示', '外部サービスを開く']);
    });
  }
});

test('custom-only menus have no separators and custom plus delete menus have one', async t => {
  for (const allowDelete of [false, true]) await t.test(String(allowDelete), async subtest => {
    const view = await mount(subtest, { features: { ...noEntryBuiltins, delete: allowDelete } });
    assert.deepEqual(tokens(view.menu), ['AIに指示', '外部サービスを開く', ...(allowDelete ? ['|', '削除'] : [])]);
  });
});

test('empty custom providers preserve built-in groups without a blank menu group', async t => {
  const view = await mount(t, { getContextMenuItems: () => [], features: { ...noEntryBuiltins, preview: true, delete: true } });
  assert.deepEqual(tokens(view.menu), ['開く', '|', '削除']);
});

test('background custom actions remain after create and upload groups', async t => {
  const view = await mount(t);
  const backgroundRoot = view.renderer.root.findAllByType('mock-context-root').find(node =>
    node.findAllByType('mock-context-content').some(content => content.props['data-explorer-background-menu']));
  await act(async () => backgroundRoot.props.onOpenChange(true));
  const menu = backgroundRoot.findAllByType('mock-context-content').find(content => content.props['data-explorer-background-menu']);
  assert.deepEqual(tokens(menu), [
    '新しいファイル', '新しいフォルダ', '|', 'ファイルをアップロード', 'フォルダをアップロード', '|', 'AIに指示', '外部サービスを開く',
  ]);
});
