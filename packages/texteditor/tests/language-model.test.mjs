import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers/build.mjs';
import { fileURLToPath } from 'node:url';

const built = await build({ entryPoints: [fileURLToPath(new URL('../src/model-entry.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'core-source', setup(build) { build.onResolve({ filter: /^@likex\/core(?:\/.*)?$/ }, ({ path }) => ({ path: fileURLToPath(new URL(`../../core/src/${path === '@likex/core' ? 'index' : path.slice('@likex/core/'.length)}.ts`, import.meta.url)) })); } }],
});
const { resolveTextEditorMode: resolve, createTextEditorModel: create, importTextEditorText: importText,
  exportTextEditorText: exportText, normalizeTextEditorModel: normalize, parseTextEditorModel: parse,
  serializeTextEditorModel: serialize, executeTextEditorCommands: execute } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

test('auto detection supports known case-insensitive extensions without reading source', () => {
  for (const [fileName, expected] of [
    ['C:\\notes\\SETTINGS.JSON', 'json'], ['/tmp/settings.YaMl', 'yaml'], ['config.yml', 'yaml'],
    ['memo.MD', 'markdown'], ['memo.markdown', 'markdown'], ['schema.xsd', 'xml'], ['icon.svg', 'xml'],
    ['feed.XML', 'xml'], ['report.txt', 'text'], ['debug.log', 'text'],
  ]) assert.equal(resolve({ fileName }), expected, fileName);
  for (const fileName of ['/tmp/config.json/README', 'README', 'file.json.bak', 'template.html', 'config.jsonc', '.json'])
    assert.equal(resolve({ fileName }), 'text', fileName);
  assert.equal(create({ text: '{"validJson": true}' }).mode, 'text');
  assert.equal(create({ text: '# A Markdown-looking line' }).mode, 'text');
});

test('specific MIME wins over extension while generic MIME does not hide filename hints', () => {
  for (const [mimeType, expected] of [
    ['Application/JSON; charset=utf-8', 'json'], ['application/ld+json', 'json'], ['application/problem+json', 'json'],
    ['text/xml', 'xml'], ['image/svg+xml', 'xml'], ['application/vnd.example+xml', 'xml'],
    ['application/yaml', 'yaml'], ['text/x-yaml', 'yaml'], ['text/markdown', 'markdown'],
  ]) assert.equal(resolve({ fileName: 'unrelated.txt', mimeType }), expected, mimeType);
  for (const mimeType of ['text/plain', 'application/octet-stream', '', 'unsupported/mime', 'invalid+json', 'invalid/path/type+xml'])
    assert.equal(resolve({ fileName: 'data.json', mimeType }), 'json', mimeType);
  assert.equal(resolve({ fileName: 'note.md', mimeType: 'application/xml' }), 'xml');
});

test('explicit modes override all hints, with saved mode as the auto fallback only', () => {
  for (const mode of ['text', 'markdown', 'json', 'xml', 'yaml'])
    assert.equal(resolve({ mode, fileName: 'data.json', mimeType: 'application/xml', fallbackMode: 'yaml' }), mode);
  assert.equal(resolve({ mode: 'auto', fileName: 'data.json', fallbackMode: 'markdown' }), 'json');
  assert.equal(resolve({ fileName: 'unknown', fallbackMode: 'markdown' }), 'markdown');
  assert.equal(resolve({ fileName: 'note.txt', fallbackMode: 'markdown' }), 'text');
  assert.equal(resolve({ mimeType: 'text/plain', fallbackMode: 'yaml' }), 'yaml');
  assert.equal(resolve(), 'text');
});

test('create and import consume metadata and persist a concrete mode without changing source', () => {
  const source = '  <!-- literal -->\r\n{ "日本": [true, 1, null] }\r\n';
  const initial = importText(source, { id: 'metadata', title: '表示名', fileName: 'settings.json', mimeType: 'text/plain', mode: 'auto' });
  assert.equal(initial.mode, 'json'); assert.equal(initial.title, '表示名'); assert.equal(exportText(initial), source);
  assert.equal(create({ title: 'file.yaml', text: source }).mode, 'yaml');
  assert.equal(create({ title: 'file.xml', fileName: 'settings.json', text: source }).mode, 'json');
  assert.equal(create({ title: 'file.xml', mode: 'text', text: source }).mode, 'text');
  assert.equal(Object.hasOwn(initial, 'fileName'), false); assert.equal(Object.hasOwn(initial, 'mimeType'), false);
  for (const mode of ['text', 'markdown', 'json', 'xml', 'yaml']) {
    const updated = execute(initial, { type: 'document.update', mode });
    assert.equal(updated.id, initial.id); assert.equal(updated.text, source); assert.equal(updated.mode, mode);
    assert.deepEqual(parse(serialize(updated)), updated);
    assert.equal(serialize(parse(serialize(updated))), serialize(updated));
  }
  assert.equal(initial.mode, 'json');
});

test('native mode remains authoritative during parse and auto cannot leak into saved models or commands', () => {
  const explicit = create({ id: 'plain', title: 'data.json', mode: 'text', text: '{}' });
  assert.equal(parse(serialize(explicit)).mode, 'text');
  assert.throws(() => normalize({ ...explicit, mode: 'auto' }), /モード/);
  assert.throws(() => execute(explicit, [{ type: 'text.set', text: 'partial' }, { type: 'document.update', mode: 'auto' }]), /モード/);
  assert.equal(explicit.text, '{}');
});

test('metadata validation rejects hostile accessors, unsupported values and oversized hints', () => {
  let reads = 0;
  assert.throws(() => resolve({ get fileName() { reads++; return 'data.json'; } }), /getter/);
  assert.throws(() => create({ get mimeType() { reads++; return 'application/json'; } }), /getter/);
  assert.equal(reads, 0);
  for (const mode of [null, 'JSON', 'html', false]) assert.throws(() => resolve({ mode }), /モード/);
  assert.throws(() => resolve({ fallbackMode: 'auto' }), /モード/);
  assert.throws(() => resolve({ fileName: 'x'.repeat(1001) }), /ファイル名/);
  assert.throws(() => resolve({ mimeType: 'text/plain\0' }), /MIME/);
  assert.throws(() => create({ fileName: null }), /ファイル名/);
  assert.throws(() => importText('', { mimeType: null }), /MIME/);
  assert.throws(() => resolve({ metadata: {} }), /未対応/);
});
