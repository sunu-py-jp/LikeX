import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname], bundle:true, platform:'node',format:'esm',write:false});
const {createSpreadsheetSession, copySpreadsheetCells, normalizeWorkbook} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const input = () => ({sheets:[{id:'one',name:'Sheet1',rowCount:8,columnCount:8,cells:{
  A1:{value:'Title',format:{bold:true}}, A2:{value:'Description'}, C4:{value:'Quantity'}, C5:{value:'3',format:{numberFormat:'number'},validation:{type:'number',min:0,max:100}},
  D4:{value:'Price'},D5:{value:'100'},
},merges:[{top:0,left:0,bottom:0,right:7},{top:1,left:0,bottom:1,right:7}],comments:{A1:{id:'note',text:'Keep title note'}}}]});
const column = index => ({top:0,bottom:7,left:index,right:index});

test('column copy skips partial title merges and preserves destination titles, data rules, comments and undo', () => {
  const session = createSpreadsheetSession(input()), before=session.getWorkbook();
  const payload=copySpreadsheetCells(before,'one',column(2),{partialMerges:'skip'});
  assert.equal(payload.values[0][0],''); assert.equal(payload.values[3][0],'Quantity');
  assert.deepEqual(payload.merges,[]);
  const result=session.execute({type:'cells.paste',sheetId:'one',target:{row:0,column:3},payload,partialMerges:'skip'});
  assert.equal(result.ok,true, result.message);
  const after=session.getWorkbook().sheets[0];
  assert.equal(after.cells.A1.value,'Title'); assert.equal(after.cells.A2.value,'Description');
  assert.equal(after.comments.A1.id,'note'); assert.deepEqual(after.merges,before.sheets[0].merges);
  assert.equal(after.cells.D4.value,'Quantity'); assert.equal(after.cells.D5.value,'3');
  assert.deepEqual(after.cells.D5.validation,before.sheets[0].cells.C5.validation);
  assert.deepEqual(result.results[0].write.skippedAddresses,['D1','D2']);
  assert.deepEqual(result.results[0].placement,{nextRow:8,nextColumn:4});
  assert.equal(session.undo(),true); assert.equal(session.getWorkbook().sheets[0].cells.D5.value,'100');
  assert.equal(session.redo(),true); assert.equal(session.getWorkbook().sheets[0].cells.D5.value,'3');
});

test('source merge anchors copied partially are blank, including their format and comment', () => {
  const payload=copySpreadsheetCells(normalizeWorkbook(input()),'one',column(0),{partialMerges:'skip'});
  assert.equal(payload.values[0][0],''); assert.equal(payload.displayedValues[0][0],'');
  assert.equal(payload.formats[0][0],null); assert.equal(payload.comments[0][0],null);
  assert.deepEqual(payload.merges,[]);
});

test('default copy/paste and cuts still reject partial merges without changing data', () => {
  const session=createSpreadsheetSession(input()),before=session.getWorkbook();
  assert.throws(()=>copySpreadsheetCells(before,'one',column(2)),/結合/);
  assert.throws(()=>copySpreadsheetCells(before,'one',column(2),{partialMerges:'skip',kind:'cut'}),/結合/);
  const payload=copySpreadsheetCells(before,'one',column(2),{partialMerges:'skip'});
  assert.equal(session.execute({type:'cells.paste',sheetId:'one',target:{row:0,column:3},payload}).ok,false);
  assert.equal(session.getWorkbook(),before);
  assert.throws(()=>copySpreadsheetCells(before,'one',column(2),{partialMerges:'invalid'}));
  assert.equal(session.execute({type:'cells.paste',sheetId:'one',target:{row:0,column:3},payload,partialMerges:'invalid'}).ok,false);
});

test('row copy leaves vertical destination merges intact and pastes only cells outside them', () => {
  const source={sheets:[{id:'one',name:'Sheet1',rowCount:6,columnCount:4,cells:{A1:{value:'Vertical title'}, B2:{value:'source'}, B4:{value:'old'}},merges:[{top:0,bottom:5,left:0,right:0}]}]};
  const session=createSpreadsheetSession(source), before=session.getWorkbook();
  const payload=copySpreadsheetCells(before,'one',{top:1,bottom:1,left:0,right:3},{partialMerges:'skip'});
  const result=session.execute({type:'cells.paste',sheetId:'one',target:{row:3,column:0},payload,partialMerges:'skip'});
  assert.equal(result.ok,true,result.message);
  const sheet=session.getWorkbook().sheets[0];
  assert.equal(sheet.cells.A1.value,'Vertical title'); assert.equal(sheet.cells.B4.value,'source');
  assert.deepEqual(sheet.merges,before.sheets[0].merges);
});

test('a one-cell skip paste never redirects into an out-of-range merged anchor', () => {
  const session=createSpreadsheetSession(input()),before=session.getWorkbook();
  const result=session.execute({type:'cells.paste',sheetId:'one',target:{row:0,column:2},payload:{values:[['new']]},partialMerges:'skip'});
  assert.equal(result.ok,true,result.message); assert.equal(result.changed,false); assert.equal(session.getWorkbook(),before);
  assert.deepEqual(result.results[0].write.skippedAddresses,['C1']);
});

test('complete source merges retain normal copy semantics and cannot overlap protected target merges', () => {
  const session=createSpreadsheetSession(input());
  const payload=copySpreadsheetCells(session.getWorkbook(),'one',{top:0,bottom:1,left:0,right:7},{partialMerges:'skip'});
  assert.equal(payload.merges.length,2);
  const result=session.execute({type:'cells.paste',sheetId:'one',target:{row:3,column:0},payload,partialMerges:'skip'});
  assert.equal(result.ok,true,result.message); assert.equal(session.getWorkbook().sheets[0].cells.A4.value,'Title');
  const before=session.getWorkbook();
  const conflict=session.execute({type:'cells.paste',sheetId:'one',target:{row:0,column:2},partialMerges:'skip',payload:{values:[['merge'],['']],merges:[{top:0,bottom:1,left:0,right:0}]}});
  assert.equal(conflict.ok,false); assert.equal(session.getWorkbook(),before);
});

test('mixed complete and partial destination merges remove only the completely covered merge', () => {
  const session = createSpreadsheetSession({ sheets: [{ id: 'one', name: 'Sheet1', rowCount: 8, columnCount: 8,
    cells: { A1: { value: 'protected', format: { bold: true } }, C3: { value: 'old merged value' } },
    merges: [{ top: 0, bottom: 0, left: 0, right: 7 }, { top: 2, bottom: 2, left: 2, right: 3 }],
    comments: { A1: { id: 'title-comment', text: 'keep me' } },
  }] });
  const result = session.execute({ type: 'cells.paste', sheetId: 'one', target: { row: 0, column: 2 }, partialMerges: 'skip',
    payload: { values: [['ignored', 'ignored'], ['a', 'b'], ['c', 'd'], ['e', 'f']], merges: [],
      comments: [[null, null], [null, null], [null, null], [null, null]] } });
  assert.equal(result.ok, true, result.message);
  const sheet = session.getWorkbook().sheets[0];
  assert.deepEqual(sheet.merges, [{ top: 0, bottom: 0, left: 0, right: 7 }]);
  assert.equal(sheet.cells.A1.value, 'protected'); assert.equal(sheet.cells.A1.format.bold, true);
  assert.equal(sheet.comments.A1.id, 'title-comment');
  assert.equal(sheet.cells.C3.value, 'c'); assert.equal(sheet.cells.D3.value, 'd');
  assert.deepEqual(result.results[0].write.skippedAddresses, ['C1', 'D1']);
  assert.equal(session.undo(), true); assert.equal(session.getWorkbook().sheets[0].merges.length, 2);
});

test('a protected destination anchor retains its value, format, rule and comment across every paste mode', () => {
  for (const mode of ['all', 'values', 'formulas', 'formats']) {
    const session = createSpreadsheetSession({ sheets: [{ id: 'one', name: 'Sheet1', rowCount: 3, columnCount: 4,
      cells: { A1: { value: 'title', format: { bold: true }, validation: { type: 'list', values: ['title'] } } },
      merges: [{ top: 0, bottom: 0, left: 0, right: 3 }], comments: { A1: { id: 'note', text: 'keep this' } },
    }] });
    const before = session.getWorkbook().sheets[0];
    const result = session.execute({ type: 'cells.paste', sheetId: 'one', target: { row: 0, column: 0 },
      partialMerges: 'skip', mode, onConflict: 'error', payload: {
        values: [['would violate the rule'], ['next']], formats: [[{ italic: true }], [{ italic: true }]],
        validations: [[null], [null]], comments: [[{ text: 'replace' }], [null]], merges: [],
      } });
    assert.equal(result.ok, true, `${mode}: ${result.message}`);
    const after = session.getWorkbook().sheets[0];
    assert.deepEqual(after.cells.A1, before.cells.A1); assert.deepEqual(after.comments.A1, before.comments.A1);
    assert.deepEqual(after.merges, before.merges);
    assert.deepEqual(result.results[0].write.skippedAddresses, ['A1']);
    if (mode === 'formats') assert.equal(after.cells.A2.format.italic, true);
    else assert.equal(after.cells.A2.value, 'next');
  }
});

test('partial-merge skip cannot bypass errors in unprotected cells or mutate an earlier command in a rejected batch', () => {
  const session = createSpreadsheetSession({ sheets: [{ id: 'one', name: 'Sheet1', rowCount: 4, columnCount: 4,
    cells: { A1: { value: 'title' }, C3: { value: '1', validation: { type: 'number', min: 0 } } },
    merges: [{ top: 0, bottom: 0, left: 0, right: 3 }],
  }] });
  const before = session.getWorkbook();
  const result = session.batch([
    { type: 'cells.set', sheetId: 'one', values: { D4: 'must roll back' } },
    { type: 'cells.paste', sheetId: 'one', target: { row: 0, column: 2 }, partialMerges: 'skip',
      payload: { values: [['ignored'], ['valid'], ['not a number']], merges: [] } },
  ]);
  assert.equal(result.ok, false); assert.equal(session.getWorkbook(), before);
  assert.equal(session.getHistoryState().canUndo, false);
});
