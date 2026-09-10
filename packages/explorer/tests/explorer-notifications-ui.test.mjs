import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { create } from 'react-test-renderer';
import { Tooltip } from 'radix-ui';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  absWorkingDir: packageRoot,
  stdin: {
    contents: `export { ExplorerNotifications } from './src/ui/explorer-notifications.tsx';`,
    resolveDir: packageRoot,
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-ui-dependencies', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|lucide-react|radix-ui)(\/.*)?$/ }, ({ path }) => ({
      path: import.meta.resolve(path), external: true,
    }));
  } }],
});
const { ExplorerNotifications } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const defaults = {
  notification: null, messages: [],
  onDismissNotification() {}, onDismissMessage() {}, onClearMessages() {},
};
const render = props => renderToStaticMarkup(h(Tooltip.Provider, null, h(ExplorerNotifications, { ...defaults, ...props })));

test('no messages leave no visible notification panel', () => {
  const html = render({});
  assert.equal(html.includes('<section'), false);
  assert.match(html, /role="status"/);
});

test('many invalid files share one help trigger and are not automatically read aloud', () => {
  const details = Array.from({ length: 300 }, (_, index) => ({
    message: `フォルダ/資料-${index + 1}.exe`, description: '許可されていない拡張子です',
  }));
  const html = render({ notification: {
    kind: 'error', message: '300ファイルを追加できませんでした', details,
    hint: '許可される拡張子: .csv、.md、.txt',
  } });
  assert.equal((html.match(/<section/g) ?? []).length, 1);
  assert.equal((html.match(/<li /g) ?? []).length, 300);
  assert.equal((html.match(/aria-label="通知の補足情報"/g) ?? []).length, 1);
  const heading = html.match(/<header[^>]*>(.*?)<\/header>/)?.[1];
  assert.ok(heading);
  assert.match(heading, /300ファイルを追加できませんでした/);
  assert.match(heading, /aria-label="通知の補足情報"/);
  assert.match(heading, /aria-label="通知を閉じる"/);
  assert.equal(heading.includes('資料-'), false, 'file details scroll independently of the retained title and controls');
  const announcement = html.match(/<p role="status"[^>]*>(.*?)<\/p>/)?.[1];
  assert.equal(announcement, 'エラー: 300ファイルを追加できませんでした');
  assert.equal(announcement.includes('資料-'), false);
});

test('host supplied file names and descriptions remain text', () => {
  const html = render({ messages: [{
    id: 'file', kind: 'success', message: '<script>file.txt</script>', description: '<img src=x onerror=alert(1)>',
  }] });
  assert.match(html, /&lt;script&gt;file.txt&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img '), false);
});

test('known progress is bounded and non-finite progress remains indeterminate', () => {
  for (const [progress, expected] of [[42.5, 42.5], [-5, 0], [105, 100]]) {
    const html = render({ messages: [{ id: 'upload', kind: 'progress', message: '資料.xlsx', progress }] });
    assert.match(html, new RegExp(`aria-valuenow="${expected}"`));
    assert.match(html, new RegExp(`${Math.round(expected)}%`));
  }
  for (const progress of [undefined, NaN, Infinity]) {
    const html = render({ messages: [{ id: 'upload', kind: 'progress', message: '資料.xlsx', progress }] });
    assert.equal(html.includes('aria-valuenow'), false);
    assert.match(html, /lucide-loader-circle/);
  }
});

test('a host result can replace progress with a success check without another row', async t => {
  let renderer;
  await act(() => { renderer = create(h(ExplorerNotifications, { ...defaults, messages: [
    { id: 'upload', kind: 'progress', message: '資料.xlsx', progress: 60 },
  ] })); });
  t.after(() => act(() => renderer.unmount()));
  assert.equal(renderer.root.findAllByProps({ role: 'progressbar' }).length, 1);
  assert.equal(renderer.root.findByProps({ role: 'status' }).children.join(''), '処理中: 資料.xlsx');
  await act(() => renderer.update(h(ExplorerNotifications, { ...defaults, messages: [
    { id: 'upload', kind: 'success', message: '資料.xlsx', description: 'アップロード完了' },
  ] })));
  assert.equal(renderer.root.findAllByType('article').length, 1);
  assert.equal(renderer.root.findAllByProps({ role: 'progressbar' }).length, 0);
  assert.equal(renderer.root.findByProps({ role: 'status' }).children.join(''), '完了: 資料.xlsx');
  assert.equal(renderer.root.findAllByType('svg').filter(svg => svg.props.className.includes('lucide-check')).length, 1);
});

test('individual and combined dismissal route to the correct owner', async t => {
  const calls = [];
  let renderer;
  await act(() => { renderer = create(h(ExplorerNotifications, { ...defaults,
    notification: { kind: 'error', message: '追加できませんでした' },
    messages: [{ id: 'uploaded', kind: 'success', message: '資料.xlsx' }],
    onDismissNotification: () => calls.push('internal'),
    onDismissMessage: id => calls.push(id),
    onClearMessages: () => calls.push('external-all'),
  })); });
  t.after(() => act(() => renderer.unmount()));
  const dismiss = renderer.root.findAllByType('button').filter(button => button.props['aria-label'] === '通知を閉じる');
  await act(() => dismiss[0].props.onClick());
  await act(() => dismiss[1].props.onClick());
  const clear = renderer.root.findAllByType('button').find(button => button.children.includes('すべて閉じる'));
  await act(() => clear.props.onClick());
  assert.deepEqual(calls, ['internal', 'uploaded', 'internal', 'external-all']);
});
