import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ stdin: { contents: 'export * from "./src/model-entry";', resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { normalizeWorkbook, applySpreadsheetCommands, createSpreadsheetSession, setCellValues } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheetId = 'sheet-1';
const initial = (extra = {}) => normalizeWorkbook({ sheets: [{ id: sheetId, name: 'Data', rowCount: 20, columnCount: 10,
  cells: { A1: { value: 'old', format: { bold: true, borders: { bottom: { width: 1, color: '#123456' } } } }, B1: { value: '=IF(1=1,"",0)' },
    C1: { value: '', format: { background: '#abcdef' } }, A2: { value: 'yes', validation: { type: 'list', values: ['yes','no'] } } },
  comments: { A1: { id: 'note', text: 'retain' } }, ...extra }] });
const run = (book, commands, features) => applySpreadsheetCommands(book, commands.map(command => ({ sheetId, ...command })), features ? { features } : undefined);
const first = result => { assert.equal(result.ok, true, result.message); return result.workbook.sheets[0]; };

test('write conflict error rejects an entire batch and reports all occupied unequal targets', () => {
  const book = initial();
  const result = run(book, [{ type: 'cells.set', values: { D4: 'should roll back' } },
    { type: 'cells.set', values: { A1: 'new', B1: 'x', C1: 'empty formatted' }, onConflict: 'error' }]);
  assert.equal(result.ok, false); assert.equal(result.code, 'WRITE_CONFLICT'); assert.equal(result.commandIndex, 1);
  assert.deepEqual(result.conflicts, ['A1','B1']); assert.equal(result.workbook, undefined);
  assert.equal(book.sheets[0].cells.D4, undefined);
});
test('skip preserves existing values and formatting; formulas count as occupied and styled blanks do not', () => {
  const result = run(initial(), [{ type: 'cells.set', values: { A1:'new', B1:'new', C1:'added' }, onConflict:'skip' }]);
  const sheet = first(result); assert.equal(sheet.cells.A1.value,'old'); assert.equal(sheet.cells.B1.value,'=IF(1=1,"",0)');
  assert.equal(sheet.cells.C1.value,'added'); assert.equal(sheet.cells.C1.format.background,'#abcdef');
  assert.deepEqual(result.results[0].write,{changedCount:1,skippedCount:2,skippedAddresses:['A1','B1']});
});
test('identical writes are no-ops even with error, while clearing an occupied target is a conflict', () => {
  const same = run(initial(), [{type:'cells.set', values:{A1:'old'}, onConflict:'error'}]);
  first(same); assert.equal(same.changed,false);
  assert.equal(run(initial(),[{type:'cells.set',values:{A1:''},onConflict:'error'}]).code,'WRITE_CONFLICT');
  assert.throws(() => setCellValues(initial(),sheetId,{A1:'new'},{onConflict:'error'}),/既存/);
});
test('invalid conflict policies and duplicate canonical addresses are rejected before writes', () => {
  assert.equal(run(initial(),[{type:'cells.set',values:{A1:'new'},onConflict:'ignore'}]).code,'INVALID_COMMAND');
  assert.equal(run(initial(),[{type:'cells.set',values:{A1:'one',a1:'two'}}]).ok,false);
});
test('values clear retains formatting, validation, comments and cell positions', () => {
  const sheet = first(run(initial(),[{type:'cells.clear',range:'A1:C2'}]));
  assert.equal(sheet.cells.A1.value,''); assert.equal(sheet.cells.A1.format.bold,true); assert.equal(sheet.comments.A1.text,'retain');
  assert.equal(sheet.cells.A2.validation.type,'list'); assert.equal(sheet.rowCount,20); assert.equal(sheet.columnCount,10);
});
test('cell deletion removes records and comments without shifting adjacent content', () => {
  const sheet = first(run(initial(),[{type:'cells.delete',range:'A1'}]));
  assert.equal(sheet.cells.A1,undefined); assert.equal(sheet.comments.A1,undefined);
  assert.equal(sheet.cells.A2.value,'yes'); assert.equal(sheet.cells.B1.value,'=IF(1=1,"",0)');
});
test('clear all removes conditional formatting only within the cleared rectangle', () => {
  const book = initial({ conditionalFormats: [{id:'rule',type:'text',operator:'contains',value:'old',format:{background:'#abcdef'},
    ranges:[{top:0,left:0,bottom:2,right:2}]}] });
  const sheet = first(run(book,[{type:'cells.clear',range:'B2',mode:'all'}]));
  const ranges = sheet.conditionalFormats[0].ranges;
  const contains = (r,c) => ranges.some(area => r>=area.top&&r<=area.bottom&&c>=area.left&&c<=area.right);
  assert.equal(contains(1,1),false); assert.equal(contains(0,0),true); assert.equal(contains(2,2),true);
});
test('clear-all respects feature flags and rejects partial merge deletion', () => {
  assert.equal(run(initial(),[{type:'cells.delete',range:'A1'}],{formatting:false}).code,'FEATURE_DISABLED');
  const merged = initial({ cells:{A1:{value:'merged'}},merges:[{top:0,left:0,bottom:0,right:1}] });
  assert.equal(run(merged,[{type:'cells.delete',range:'A1'}]).ok,false);
  const sheet = first(run(merged,[{type:'cells.delete',range:'A1:B1'}])); assert.equal(sheet.merges?.length ?? 0,0);
});
test('clear/delete are undoable and no-op clear does not add history', () => {
  const session = createSpreadsheetSession(initial());
  assert.equal(session.execute({type:'cells.delete',sheetId,range:'A1'}).ok,true); assert.equal(session.getCell(sheetId,'A1'),undefined);
  assert.equal(session.undo(),true); assert.equal(session.getCell(sheetId,'A1').value,'old');
  assert.equal(session.getCellComment(sheetId,'A1').id,'note'); assert.equal(session.redo(),true);
  const before = session.getHistoryState(); assert.equal(session.execute({type:'cells.clear',sheetId,range:'A1'}).changed,false);
  assert.deepEqual(session.getHistoryState(),before);
});
test('paste skip preserves comments and all formatting on skipped cells', () => {
  const result = run(initial(),[{type:'cells.paste',target:{row:0,column:0},onConflict:'skip',payload:{values:[['new','new','filled']],
    formats:[[{italic:true},{italic:true},{italic:true}]],comments:[[null,null,{text:'new note'}]]}}]);
  const sheet=first(result); assert.equal(sheet.cells.A1.format.bold,true); assert.equal(sheet.cells.A1.format.italic,undefined);
  assert.equal(sheet.comments.A1.text,'retain'); assert.equal(sheet.cells.C1.value,'filled'); assert.equal(sheet.comments.C1.text,'new note');
  assert.equal(result.results[0].write.skippedCount,2);
});
test('fill skip preserves occupied destinations and reports them', () => {
  const book=initial({cells:{A1:{value:'1'},A2:{value:'9',format:{bold:true}}}});
  const result=run(book,[{type:'cells.fill',source:{top:0,left:0,bottom:0,right:0},target:{top:0,left:0,bottom:2,right:0},mode:'series',onConflict:'skip'}]);
  const sheet=first(result); assert.equal(sheet.cells.A2.value,'9'); assert.equal(sheet.cells.A2.format.bold,true); assert.equal(sheet.cells.A3.value,'3');
  assert.deepEqual(result.results[0].write.skippedAddresses,['A2']);
});
test('replace supports skip and error without partially changing matches', () => {
  const skipped=run(initial(),[{type:'cells.replace',query:{text:'old'},replacement:'new',onConflict:'skip'}]);
  assert.equal(first(skipped).cells.A1.value,'old'); assert.equal(skipped.changed,false);
  const failed=run(initial(),[{type:'cells.replace',query:{text:'old'},replacement:'new',onConflict:'error'}]); assert.equal(failed.code,'WRITE_CONFLICT');
});
test('cut move skip leaves the entire source and destination intact', () => {
  const book=initial({cells:{A1:{value:'source'},B1:{value:'occupied'}}});
  const result=run(book,[{type:'cells.move',source:{sheetId,top:0,left:0,bottom:0,right:0},target:{row:0,column:1},onConflict:'skip'}]);
  assert.equal(first(result).cells.A1.value,'source'); assert.equal(result.changed,false); assert.equal(result.results[0].write.skippedCount,1);
});
test('overlapping moves do not treat their own source as a conflict', () => {
  const book=initial({cells:{A1:{value:'1'},B1:{value:'2'}}});
  const result=run(book,[{type:'cells.move',source:{sheetId,top:0,left:0,bottom:0,right:1},target:{row:0,column:1},onConflict:'error'}]);
  const sheet=first(result); assert.equal(sheet.cells.A1,undefined); assert.equal(sheet.cells.B1.value,'1'); assert.equal(sheet.cells.C1.value,'2');
});

test('clear all cannot bypass a disabled checkbox feature', () => {
  const book = initial({cells:{A1:{value:'TRUE',validation:{type:'checkbox'}}}});
  const result = run(book,[{type:'cells.delete',range:'A1'}],{checkboxes:false});
  assert.equal(result.code,'FEATURE_DISABLED'); assert.equal(book.sheets[0].cells.A1.validation.type,'checkbox');
});

test('cross-sheet move reports source and destination value changes', () => {
  const book = normalizeWorkbook({sheets:[
    {id:sheetId,name:'Source',cells:{A1:{value:'moved'}},rowCount:10,columnCount:5},
    {id:'target',name:'Target',cells:{},rowCount:10,columnCount:5},
  ]});
  const result = run(book,[{type:'cells.move',sheetId:'target',source:{sheetId,top:0,left:0,bottom:0,right:0},target:{row:0,column:0}}]);
  assert.equal(result.ok,true,result.message);
  assert.equal(result.workbook.sheets[0].cells.A1,undefined);
  assert.equal(result.workbook.sheets[1].cells.A1.value,'moved');
  assert.equal(result.results[0].write.changedCount,2);
});

test('replace applies canonical address selection consistently with its conflict policy', () => {
  const replaced = run(initial(),[{type:'cells.replace',query:{text:'old'},replacement:'new',addresses:['$a$1']}]);
  assert.equal(first(replaced).cells.A1.value,"'new");
  const skipped = run(initial(),[{type:'cells.replace',query:{text:'old'},replacement:'new',addresses:['a1'],onConflict:'skip'}]);
  assert.equal(first(skipped).cells.A1.value,'old'); assert.deepEqual(skipped.results[0].write.skippedAddresses,['A1']);
});
