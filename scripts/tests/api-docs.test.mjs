import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml, relativeUrl, renderMarkdown, selectMarkdown } from '../api-docs/render.mjs';
import { renderPage } from '../api-docs/template.mjs';

function codeText(html) {
  const code = html.match(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/)?.[1];
  assert.notEqual(code, undefined, 'Expected a rendered code block');
  return code.replace(/<span class="syntax-[^"]+">/g, '').replaceAll('</span>', '')
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'").replaceAll('&amp;', '&');
}

test('Markdown source HTML is displayed as text instead of executing markup', () => {
  const { html } = renderMarkdown('<script>alert("x")</script>\n\n<img src="x" onerror="alert(1)">');
  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
});

test('explicit source anchors remain destinations for existing guide links', () => {
  const { html } = renderMarkdown('<a id="initial-file"></a>\n\n## 最初のファイルを選択する');
  assert.match(html, /<a id="initial-file"><\/a>/);
  assert.doesNotMatch(html, /&lt;a id=/);
});

test('heading IDs stay unique when several source documents form one page', () => {
  const usedIds = new Map();
  const first = renderMarkdown('## 保存と `onSave`', { usedIds });
  const second = renderMarkdown('## 保存と `onSave`', { usedIds });
  assert.equal(first.headings[0].id, '保存と-onsave');
  assert.equal(second.headings[0].id, '保存と-onsave-1');
  assert.match(second.html, /href="#%E4%BF%9D%E5%AD%98%E3%81%A8-onsave-1"/);
});

test('syntax highlighting preserves TSX source exactly when copied', () => {
  const code = 'const label = "<保存> & \\"確認\\"";\n// コメント\nexport const view = <button aria-label="保存">保存</button>;';
  const { html } = renderMarkdown('```tsx\n' + code + '\n```');
  assert.equal(codeText(html), code);
  assert.doesNotMatch(html, /<button aria-label="保存">/);
});

test('link rewriters can remove a URL without discarding its readable label', () => {
  const seen = [];
  const { html } = renderMarkdown('[**リンク**](javascript:alert%281%29)\n\n![画像](data:text/html,bad)', {
    rewriteLink(href) { seen.push(href); return null; },
  });
  assert.deepEqual(seen, ['javascript:alert%281%29', 'data:text/html,bad']);
  assert.match(html, /<strong>リンク<\/strong>/);
  assert.doesNotMatch(html, /(?:href|src)=/);
});

test('rewritten URLs and source titles cannot add HTML attributes', () => {
  const { html } = renderMarkdown('[資料](./saving.md "保存の説明")', {
    rewriteLink: () => 'https://example.test/?q=" onclick="alert(1)&a=1',
  });
  assert.match(html, /href="https:\/\/example\.test\/\?q=&quot; onclick=&quot;alert\(1\)&amp;a=1"/);
  assert.match(html, /title="保存の説明"/);
});

test('relative navigation works between folders and from a page to the index', () => {
  assert.equal(relativeUrl('explorer/search/index.html', 'spreadsheet/search/index.html'), '../../spreadsheet/search/index.html');
  assert.equal(relativeUrl('explorer/search/index.html', 'index.html'), '../../index.html');
  assert.equal(relativeUrl('index.html', 'explorer/search/index.html'), 'explorer/search/index.html');
});

test('section selection includes child headings and complete code blocks', () => {
  const markdown = '# 編集\n\n## コピー\n本文\n### 例\n```md\n## コード内の見出し\n```\n末尾\n\n## 検索\n別の本文';
  const selected = selectMarkdown(markdown, ['コピー']);
  assert.match(selected, /^## コピー/);
  assert.match(selected, /### 例/);
  assert.match(selected, /```md\n## コード内の見出し\n```\n末尾/);
  assert.doesNotMatch(selected, /## 検索/);
});

test('section selection does not treat tilde-fenced example headings as sections', () => {
  const markdown = '# 編集\n\n## コピー\n~~~md\n## 検索\n~~~\nコピーの続き\n\n## 検索\n検索の本文';
  const selected = selectMarkdown(markdown, ['コピー']);
  assert.match(selected, /~~~md\n## 検索\n~~~\nコピーの続き/);
  assert.doesNotMatch(selected, /検索の本文/);
});

test('section selection carries the stable anchor immediately before its heading', () => {
  const selected = selectMarkdown('# 導入\n\n## 前の節\n前の本文\n\n<a id="initial-file"></a>\n\n## 初期選択\n選択の本文\n\n## 次の節\n次の本文', ['初期選択']);
  assert.match(selected, /<a id="initial-file"><\/a>\n\n## 初期選択/);
  assert.doesNotMatch(selected, /前の本文|次の本文/);
});

test('removing guide navigation does not alter the same text inside an example', () => {
  const markdown = '# 導入\n\n[ドキュメント一覧](./README.md)\n\n```md\n[ドキュメント一覧](./README.md)\n```';
  assert.equal(selectMarkdown(markdown).match(/\[ドキュメント一覧\]/g)?.length, 1);
  assert.match(selectMarkdown(markdown), /```md\n\[ドキュメント一覧\]\(\.\/README\.md\)\n```/);
});

test('a renamed or missing selected section fails with the missing title', () => {
  assert.throws(() => selectMarkdown('## 新しい節名\n説明', ['以前の節名']), /Missing Markdown section: 以前の節名/);
});

test('page templates escape metadata and mark the current feature in its component menu', () => {
  const page = {
    id: 'explorer/search', component: 'explorer', output: 'explorer/search/index.html',
    title: '<検索>', summary: '"説明" & <設定>', section: '操作',
    sources: ['packages/explorer/src/docs/search.md'], headings: [], html: '<p>本文</p>',
  };
  const html = renderPage(page, [page]);
  assert.match(html, /<h1>&lt;検索&gt;<\/h1>/);
  assert.match(html, /content="&quot;説明&quot; &amp; &lt;設定&gt;"/);
  assert.match(html, /<details[^>]+data-component="explorer" open>/);
  assert.match(html, /href="index\.html" aria-current="page"/);
  assert.match(html, /<li class="nav-section" data-nav-section>操作<\/li>/);
  assert.equal(escapeHtml('"&<>\''), '&quot;&amp;&lt;&gt;&#39;');
});


test('state diagrams retain allowed, rejected, and repeated edit transitions as readable tables', () => {
  const { html } = renderMarkdown('```mermaid\nstateDiagram-v2\n[*] --> view\nview --> requesting: 編集要求\nrequesting --> edit: 許可\nrequesting --> view: 拒否\nedit --> edit: 保存失敗\n```');
  assert.match(html, /<caption>編集モードの遷移<\/caption>/);
  assert.match(html, /<td>requesting<\/td><td>拒否<\/td><td>view<\/td>/);
  assert.match(html, /<td>edit<\/td><td>保存失敗<\/td><td>edit<\/td>/);
  assert.doesNotMatch(html, /<pre/);
});

test('relationship diagrams resolve shared-node labels and reject unsupported syntax', () => {
  const { html } = renderMarkdown('```mermaid\nflowchart TD\nW[Workbook] --> R[resources.images]\nD[drawings] -->|resourceId| R\n```');
  assert.match(html, /<td>drawings<\/td><td>resourceId<\/td><td>resources.images<\/td>/);
  assert.throws(() => renderMarkdown('```mermaid\nflowchart TD\nA -.-> B\n```'), /Unsupported documentation relationship/);
});
