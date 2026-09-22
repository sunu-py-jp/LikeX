import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' }, plugins: [{name:'external-react',setup(builder){ builder.onResolve({filter:/^@likex\/core\/browser$/},()=>({path:'context-menu',namespace:'menu-test'})); builder.onLoad({filter:/.*/,namespace:'menu-test'},()=>({contents:'export function openContextMenu(options){globalThis.__likexTestMenu=options;return()=>{options.closed=true;};}',loader:'js'}));  builder.onResolve({filter:/^(react|react-dom|lucide-react)(\/.*)?$/},({path})=>({path:import.meta.resolve(path),external:true})); }}] });
const {LikeDataView,createDataView,serializeDataView} = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const original = () => createDataView({id:"data",fields:[{id:"name",name:"Name",type:"text"}],rows:[{id:"one",values:{name:"Cell content"}}]});
const change = callback => act(async () => { await callback(); });
async function mount(t, props) { const oldWindow=globalThis.window; globalThis.window={matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),addEventListener(){},removeEventListener(){}}; const ref=createRef(); let renderer; await change(()=>{renderer=create(h(LikeDataView,{ref,initialData:original(),...props}));});t.after(async()=>{await change(()=>renderer.unmount());if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;});return{ref,renderer}; }
test('server renders scoped theme/content and omits write actions without onSave',()=>{ const html=renderToStaticMarkup(h(LikeDataView,{initialData:original(),primaryColor:'#174f88',colorMode:'dark'})); assert.match(html,/data-likex-dataview/); assert.match(html,/Cell content/); assert.match(html,/data-color-mode="dark"/); assert.ok(!html.includes('class="lxv-save"')); });
test('mounted ref matches permission, feature and save-history policy',async t=>{let allow=false;const{ref,renderer}=await mount(t,{onSave:async model=>model,onEditRequest:()=>allow});await change(async()=>assert.equal(await ref.current.execute({type:"data.rename",title:"Changed"}),null));assert.notEqual(ref.current.getData().title,'Changed');allow=true;await change(()=>ref.current.execute({type:"data.rename",title:"Changed"}));assert.equal(ref.current.getData().title,'Changed');await change(()=>ref.current.save());await change(()=>ref.current.undo());assert.notEqual(ref.current.getData().title,'Changed');await change(()=>ref.current.redo());assert.equal(ref.current.getData().title,'Changed');await change(()=>renderer.update(h(LikeDataView,{ref,initialData:original(),onSave(){},features:{rename:false,history:false,import:false,export:false}})));await change(async()=>assert.equal(await ref.current.execute({...{type:"data.rename",title:"Changed"},title:'Blocked'}),null));assert.throws(()=>ref.current.exportNative(),/書き出し/);assert.equal(renderer.root.findAllByProps({'aria-label':'元に戻す'}).length,0); });
test('native imports are validated, undoable, and component APIs are readonly without onSave',async t=>{const{ref,renderer}=await mount(t,{onSave(){}});const incoming=createDataView({title:'Imported'});await change(()=>ref.current.importNative(serializeDataView(incoming)));assert.equal(ref.current.getData().title,'Imported');await change(()=>ref.current.undo());assert.notEqual(ref.current.getData().title,'Imported');const before=serializeDataView(ref.current.getData());await change(()=>ref.current.importNative('{"version":99}'));assert.equal(serializeDataView(ref.current.getData()),before);await change(()=>renderer.update(h(LikeDataView,{ref,initialData:original()})));await change(async()=>assert.equal(await ref.current.execute({type:"data.rename",title:"Changed"}),null)); });

test('row numbers derive from stable IDs across grouped query snapshots',()=>{const html=renderToStaticMarkup(h(LikeDataView,{initialData:original()}));assert.match(html,/レコード1の詳細/);assert.doesNotMatch(html,/レコード0の詳細/);});

test('normal buttons cannot submit the host form and disabling an open view feature hides its panel',async t=>{
 const html=renderToStaticMarkup(h(LikeDataView,{initialData:original(),onSave(){}}));
 assert.equal((html.match(/<button /g)||[]).length,(html.match(/<button type="button"/g)||[]).length);
 const {renderer,ref}=await mount(t,{onSave(){}});
 const button=renderer.root.findAllByType('button').find(item=>[].concat(item.props.children).includes('フィルター'));
 await change(()=>button.props.onClick());assert.equal(renderer.root.findAllByProps({'aria-label':'絞り込む列'}).length,1);
 await change(()=>renderer.update(h(LikeDataView,{ref,initialData:original(),onSave(){},features:{filter:false}})));
 assert.equal(renderer.root.findAllByProps({'aria-label':'絞り込む列'}).length,0);
});

test('field names can change while cell editing is disabled without sending an unchanged type',async t=>{
  const {ref,renderer}=await mount(t,{onSave(){},features:{editCells:false}});
  const edit=renderer.root.findAllByType('button').find(node=>node.props.children==='フィールドを編集');
  await change(()=>edit.props.onClick());
  const dialog=renderer.root.findByProps({role:'dialog'});
  const name=dialog.findAllByType('input').find(node=>node.props.required);
  await change(()=>name.props.onChange({target:{value:'Renamed'}}));
  await change(()=>renderer.root.findByProps({role:'dialog'}).findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(ref.current.getData().fields[0].name,'Renamed');
  assert.equal(ref.current.getData().rows[0].values.name,'Cell content');
  assert.equal(renderer.root.findAllByProps({role:'dialog'}).length,0);
});

function contextEvent({ input = false, selected = false } = {}) {
 const target = { closest: () => input ? {} : null, ownerDocument: { getSelection: () => ({ isCollapsed: !selected }) } };
 return { target, currentTarget: target, clientX: 120, clientY: 80, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
}
const menuItem = id => globalThis.__likexTestMenu.items.find(item => item.id === id);

test('row context actions target stable IDs through sorting and undo', async t => {
 const initialData = createDataView({ id: 'data', fields: [{ id: 'name', name: 'Name', type: 'text' }], rows: [{ id: 'one', values: { name: 'Zulu' } }, { id: 'two', values: { name: 'Alpha' } }] });
 const { ref, renderer } = await mount(t, { initialData, onSave() {}, initialQuery: { sort: [{ fieldId: 'name', direction: 'asc' }] } });
 await change(() => renderer.root.findByProps({ 'data-lxv-row': 'two' }).props.onContextMenu(contextEvent()));
 await change(() => menuItem('row.duplicate').onSelect()); assert.equal(ref.current.getData().rows.length, 3); assert.equal(ref.current.getData().rows[2].values.name, 'Alpha');
 await change(() => ref.current.undo());
 await change(() => renderer.root.findByProps({ 'data-lxv-row': 'two' }).props.onContextMenu(contextEvent()));
 await change(() => menuItem('row.delete').onSelect()); assert.deepEqual(ref.current.getData().rows.map(row => row.id), ['one']);
 await change(() => ref.current.undo()); assert.equal(ref.current.getData().rows.length, 2);
});
test('field context view actions work readonly while feature switches hide unavailable operations', async t => {
 const { renderer, ref } = await mount(t, { features: { fields: false, group: false, columnVisibility: false } });
 await change(() => renderer.root.findByProps({ 'data-lxv-field': 'name' }).props.onContextMenu(contextEvent()));
 assert.deepEqual(globalThis.__likexTestMenu.items.map(item => item.id), ['field.sort.asc', 'field.sort.desc']);
 await change(() => menuItem('field.sort.desc').onSelect()); assert.deepEqual(ref.current.getQuery().sort, [{ fieldId: 'name', direction: 'desc' }]);
 await change(() => renderer.root.findByProps({ 'data-lxv-row': 'one' }).props.onContextMenu(contextEvent())); assert.equal(menuItem('row.delete').disabled, true);
});
test('row context writes honor edit permission, stale models and native input menus', async t => {
 let allowed = false; const { renderer, ref } = await mount(t, { onSave() {}, onEditRequest: () => allowed });
 const open = () => renderer.root.findByProps({ 'data-lxv-row': 'one' }).props.onContextMenu(contextEvent());
 await change(open); await change(() => menuItem('row.delete').onSelect()); assert.equal(ref.current.getData().rows.length, 1);
 allowed = true; await change(open); const stale = menuItem('row.delete'), oldMenu = globalThis.__likexTestMenu;
 await change(() => ref.current.execute({ type: 'cell.set', rowId: 'one', fieldId: 'name', value: 'Changed' }));
 assert.equal(oldMenu.closed, true); await change(() => stale.onSelect()); assert.equal(ref.current.getData().rows[0].values.name, 'Changed');
 for (const options of [{ input: true }, { selected: true }]) {
  globalThis.__likexTestMenu = null; const event = contextEvent(options);
  await change(() => renderer.root.findByProps({ 'data-lxv-row': 'one' }).props.onContextMenu(event)); assert.equal(event.defaultPrevented, false); assert.equal(globalThis.__likexTestMenu, null);
 }
});
