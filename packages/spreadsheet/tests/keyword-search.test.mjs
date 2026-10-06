import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { searchSpreadsheet, normalizeWorkbook, findSpreadsheetCells } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sample = () => normalizeWorkbook({ sheets: [
  { id:'sales', name:'売上', rowCount:20, columnCount:8, cells:{ B5:{value:'会議'}, A1:{value:'顧客 A+B'}, C2:{value:'顧客会議'}, D2:{value:'=2+3'}, E2:{value:'1200',format:{numberFormat:'number',decimalPlaces:0}} } },
  { id:'other', name:'履歴', rowCount:20, columnCount:8, cells:{ A1:{value:'顧客'} } },
] });

test('sheet AND returns contributing cells in sheet/row/column order; cell AND stays local', () => {
  const book=sample(), query={keywords:['顧客','会議']};
  const found=searchSpreadsheet(book,query);
  assert.deepEqual(found.matches.map(hit=>[hit.sheetId,hit.address]), [['sales','A1'],['sales','C2'],['sales','B5']]);
  assert.equal(found.truncated,false);
  assert.deepEqual(found.matches[0], {sheetId:'sales',sheetName:'売上',address:'A1',value:'顧客 A+B',text:'顧客 A+B',matches:[{keyword:'顧客',from:0,to:2}]});
  assert.deepEqual(searchSpreadsheet(book,query,{matchBy:'cell'}).matches.map(hit=>hit.address),['C2']);
  assert.deepEqual(searchSpreadsheet(book,{...query,operator:'or'}).matches.map(hit=>hit.sheetId),['sales','sales','sales','other']);
  const split=structuredClone(book); delete split.sheets[0].cells.C2; delete split.sheets[0].cells.A1;
  assert.equal(searchSpreadsheet(split,query).matches.length,0,'AND must not combine sheets');
});

test('range and sheet scopes constrain the AND group, and limit is applied after predicate evaluation', () => {
  const query={keywords:['顧客','会議']}, book=sample();
  assert.equal(searchSpreadsheet(book,query,{sheetId:'sales',range:'A1:B1'}).matches.length,0);
  assert.equal(searchSpreadsheet(book,query,{sheetId:'sales',range:'C2'}).matches.length,1);
  const limited=searchSpreadsheet(book,query,{limit:1});
  assert.equal(limited.truncated,true); assert.equal(limited.matches[0].address,'A1');
  assert.equal(searchSpreadsheet(book,query,{limit:3}).truncated,false);
});

test('formatted values, raw formulas and case settings share existing display rules', () => {
  const book=sample();
  assert.deepEqual(searchSpreadsheet(book,{keywords:['1,200']}).matches.map(hit=>hit.address),['E2']);
  assert.equal(searchSpreadsheet(book,{keywords:['5']},{sheetId:'sales',range:'D2'}).matches[0].value,'=2+3');
  assert.equal(searchSpreadsheet(book,{keywords:['2+3']},{lookIn:'formulas'}).matches[0].address,'D2');
  assert.equal(searchSpreadsheet(book,{keywords:['a+b']}).matches.length,1);
  assert.equal(searchSpreadsheet(book,{keywords:['a+b'],matchCase:true}).matches.length,0);
  assert.equal(findSpreadsheetCells(book,{text:'A.B',useRegex:true}).length,1,'existing regex remains available');
});

test('invalid selectors and query fail without mutating input, including empty search', () => {
  const book=structuredClone(sample()), before=JSON.stringify(book);
  for (const options of [null, {matchBy:'book'}, {limit:0}, {limit:1.5}, {limit:10001}, {lookIn:'comments'}, {sheetId:'absent'}, {range:'A1'}, {sheetId:'sales',range:'A100'}])
    assert.throws(()=>searchSpreadsheet(book,{keywords:[]},options));
  assert.throws(()=>searchSpreadsheet(undefined,{keywords:['a']}));
  assert.throws(()=>searchSpreadsheet(book,{keywords:['']}));
  const result=searchSpreadsheet(book,{keywords:['顧客']});
  assert.equal(JSON.stringify(book),before); assert.equal(Object.isFrozen(book),false);
  assert.equal(Object.isFrozen(result.matches[0].matches),true);
  assert.deepEqual(searchSpreadsheet(book,{keywords:[]}),{matches:[],truncated:false});
});
