import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [new URL('../src/ooxml.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { readOfficeRelationships } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const archive = body => ({ has: path => ['xl/_rels/workbook.xml.rels', 'xl/ok.xml'].includes(path),
  read: async () => new TextEncoder().encode(`<Relationships>${body}</Relationships>`) });
const rel = (id, target, extra = '') => `<Relationship Id="${id}" Type="example/type" Target="${target}" ${extra}/>`;

test('relationship recovery is opt-in, reports missing targets, and retains unrelated targets', async () => {
  const source = archive(rel('bad', 'missing.xml') + rel('good', 'ok.xml') + rel('remote', 'https://example.com', 'TargetMode="External"'));
  await assert.rejects(readOfficeRelationships(source, 'xl/workbook.xml'), /参照先がありません/);
  const missing = [];
  const result = await readOfficeRelationships(source, 'xl/workbook.xml', { onMissingTarget: item => missing.push(item) });
  assert.deepEqual([...result.keys()], ['good', 'remote']);
  assert.equal(missing[0].target, 'xl/missing.xml'); assert.equal(Object.isFrozen(missing[0]), true);
  await assert.rejects(readOfficeRelationships(source, 'xl/workbook.xml', { onMissingTarget() { throw new Error('essential'); } }), /essential/);
});

test('optional recovery still validates paths, XML, and IDs of omitted relationships', async () => {
  const options = { onMissingTarget() {} };
  await assert.rejects(readOfficeRelationships(archive(rel('same', 'missing.xml') + rel('same', 'ok.xml')), 'xl/workbook.xml', options), /参照情報/);
  await assert.rejects(readOfficeRelationships(archive(rel('bad', '../../escape')), 'xl/workbook.xml', options), /パッケージ外/);
  await assert.rejects(readOfficeRelationships(archive('<broken>'), 'xl/workbook.xml', options));
});
