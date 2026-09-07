import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { importTypeScript } from "./import-typescript.mjs";
const {validName, uniqueName, descendants, selectionRoots, validateDestination, pathOf} = await importTypeScript("../src/model/entries.ts");
const node=(id,parent,name,kind='folder')=>({id,parent,name,kind,size:0,mime:'',blobKey:null,content:null,createdAt:'',updatedAt:'',favorite:0});
const entries=[node('a','root','設計書'),node('b','a','基本設計'),node('c','b','sample.txt','file'),node('d','root','資料')];
test('folders cannot move or copy into themselves or descendants',()=>{
 assert.throws(()=>validateDestination(entries,[entries[0]],'a'));
 assert.throws(()=>validateDestination(entries,[entries[0]],'b'));
 assert.doesNotThrow(()=>validateDestination(entries,[entries[0]],'d'));
});
test('file and missing destinations are rejected',()=>{
 assert.throws(()=>validateDestination(entries,[entries[0]],'c'));
 assert.throws(()=>validateDestination(entries,[entries[0]],'missing'));
});
test('a selected ancestor includes descendants exactly once',()=>{
 assert.deepEqual(selectionRoots(entries,['a','b','c']).map(x=>x.id),['a']);
 assert.deepEqual(descendants(entries,'a').map(x=>x.id),['a','b','c']);
});
test('copy and upload preserve extensions without overwriting siblings',()=>{
 const files=[node('1','root','Report.CSV','file'),node('2','root','report (2).csv','file')];
 assert.equal(uniqueName(files,'root','report.csv'),'report (3).csv');
 assert.equal(uniqueName(files,'root','Report.CSV','1'),'Report.CSV');
});
test('invalid path and reserved names cannot become entries',()=>{
 for(const value of ['', '..', '../x','a/b','a\\b','CON.txt','trailing.','a\u0000b'])assert.throws(()=>validName(value),value);
 assert.equal(validName(' 議事録_20260905.md '),'議事録_20260905.md');
});
test('nested breadcrumb order follows parent chain',()=>{
 assert.deepEqual(pathOf(entries,'c').map(x=>x.name),['設計書','基本設計','sample.txt']);
});
test('date labels stay on the Japanese calendar day across server and browser time zones', () => {
 const timestamps = [
  '2026-09-05T14:59:59.999Z',
  '2026-09-05T15:00:00.000Z',
  '2026-09-06T00:00:00.000+09:00',
  '2026-09-05T09:00:00.000-07:00',
  '2026-12-31T15:00:00.000Z',
 ];
 const expected = ['2026/09/05', '2026/09/06', '2026/09/06', '2026/09/06', '2027/01/01'];
 const script = `
  import { importTypeScript } from ${JSON.stringify(new URL('./import-typescript.mjs', import.meta.url).href)};
  const { stamp } = await importTypeScript('../src/model/entries.ts');
  console.log(JSON.stringify({
   timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
   labels: ${JSON.stringify(timestamps)}.map(stamp),
  }));
 `;
 for (const timeZone of ['UTC', 'Asia/Tokyo']) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
   env: { ...process.env, TZ: timeZone },
   encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.timeZone, timeZone);
  assert.deepEqual(output.labels, expected, timeZone);
 }
});
