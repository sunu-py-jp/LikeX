import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' }, plugins: [{name:'external-react',setup(builder){ builder.onResolve({filter:/^@likex\/core\/browser$/},()=>({path:'context-menu',namespace:'menu-test'})); builder.onLoad({filter:/.*/,namespace:'menu-test'},()=>({contents:'export function openContextMenu(options){globalThis.__likexTestMenu=options;return()=>{options.closed=true;};}',loader:'js'}));  builder.onResolve({filter:/^(react|react-dom|lucide-react)(\/.*)?$/},({path})=>({path:import.meta.resolve(path),external:true})); }}] });
const {LikeBoard,createBoard,serializeBoard} = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const original = () => createBoard({id:"board",columns:[{id:"todo",title:"To do",cards:[{id:"one",title:"Card content"}]}]});
const change = callback => act(async () => { await callback(); });
async function mount(t, props) { const oldWindow=globalThis.window; globalThis.window={matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),addEventListener(){},removeEventListener(){}}; const ref=createRef(); let renderer; await change(()=>{renderer=create(h(LikeBoard,{ref,initialBoard:original(),...props}));});t.after(async()=>{await change(()=>renderer.unmount());if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;});return{ref,renderer}; }
test('server renders scoped theme/content and omits write actions without onSave',()=>{ const html=renderToStaticMarkup(h(LikeBoard,{initialBoard:original(),primaryColor:'#174f88',colorMode:'dark'})); assert.match(html,/data-likex-board/); assert.match(html,/Card content/); assert.match(html,/data-color-mode="dark"/); assert.ok(!html.includes('class="lxb-save"')); });
test('mounted ref matches permission, feature and save-history policy',async t=>{let allow=false;const{ref,renderer}=await mount(t,{onSave:async model=>model,onEditRequest:()=>allow});await change(async()=>assert.equal(await ref.current.execute({type:"board.rename",title:"Changed"}),null));assert.notEqual(ref.current.getBoard().title,'Changed');allow=true;await change(()=>ref.current.execute({type:"board.rename",title:"Changed"}));assert.equal(ref.current.getBoard().title,'Changed');await change(()=>ref.current.save());await change(()=>ref.current.undo());assert.notEqual(ref.current.getBoard().title,'Changed');await change(()=>ref.current.redo());assert.equal(ref.current.getBoard().title,'Changed');await change(()=>renderer.update(h(LikeBoard,{ref,initialBoard:original(),onSave(){},features:{rename:false,history:false,import:false,export:false}})));await change(async()=>assert.equal(await ref.current.execute({...{type:"board.rename",title:"Changed"},title:'Blocked'}),null));assert.throws(()=>ref.current.exportNative(),/書き出し/);assert.equal(renderer.root.findAllByProps({'aria-label':'元に戻す'}).length,0); });
test('native imports are validated, undoable, and component APIs are readonly without onSave',async t=>{const{ref,renderer}=await mount(t,{onSave(){}});const incoming=createBoard({title:'Imported'});await change(()=>ref.current.importNative(serializeBoard(incoming)));assert.equal(ref.current.getBoard().title,'Imported');await change(()=>ref.current.undo());assert.notEqual(ref.current.getBoard().title,'Imported');const before=serializeBoard(ref.current.getBoard());await change(()=>ref.current.importNative('{"version":99}'));assert.equal(serializeBoard(ref.current.getBoard()),before);await change(()=>renderer.update(h(LikeBoard,{ref,initialBoard:original()})));await change(async()=>assert.equal(await ref.current.execute({type:"board.rename",title:"Changed"}),null)); });

test('normal buttons cannot submit the host form and bright primary labels remain readable',()=>{
 const html=renderToStaticMarkup(h(LikeBoard,{initialBoard:original(),onSave(){},primaryColor:'#ffffff'}));
 assert.equal((html.match(/<button /g)||[]).length,(html.match(/<button type="button"/g)||[]).length);
 assert.match(html,/--lxb-on-primary:#000000/);
});

function contextEvent({ input = false, selected = false } = {}) {
 const target = { closest: () => input ? {} : null, ownerDocument: { getSelection: () => ({ isCollapsed: !selected }) } };
 return { target, currentTarget: target, clientX: 120, clientY: 80, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
}
const menuItem = id => globalThis.__likexTestMenu.items.find(item => item.id === id);

test('card context actions preserve target IDs, permission and undo; replaced models reject stale actions', async t => {
 let allowed = false;
 const { ref, renderer } = await mount(t, { onSave() {}, onEditRequest: () => allowed });
 const open = () => renderer.root.findByProps({ 'data-lxb-card': 'one' }).props.onContextMenu(contextEvent());
 await change(open); assert.equal(menuItem('card.up').disabled, true);
 await change(() => menuItem('card.duplicate').onSelect()); assert.equal(ref.current.getBoard().columns[0].cards.length, 1);
 allowed = true; await change(open); await change(() => menuItem('card.duplicate').onSelect());
 const copied = ref.current.getBoard().columns[0].cards[1]; assert.notEqual(copied.id, 'one'); assert.equal(copied.description, '');
 await change(() => ref.current.undo()); assert.equal(ref.current.getBoard().columns[0].cards.length, 1);
 await change(open); const stale = menuItem('card.delete'), oldMenu = globalThis.__likexTestMenu;
 await change(() => ref.current.execute({ type: 'card.update', cardId: 'one', patch: { title: 'New content' } }));
 assert.equal(oldMenu.closed, true); await change(() => stale.onSelect()); assert.equal(ref.current.getBoard().columns[0].cards[0].title, 'New content');
});
test('column context duplicate remaps contained IDs and cards move to the clicked destination', async t => {
 const { ref, renderer } = await mount(t, { onSave() {} });
 await change(() => renderer.root.findByProps({ 'data-lxb-column': 'todo' }).props.onContextMenu(contextEvent()));
 await change(() => menuItem('column.duplicate').onSelect());
 const next = ref.current.getBoard(); assert.equal(next.columns.length, 2); assert.notEqual(next.columns[1].id, 'todo'); assert.notEqual(next.columns[1].cards[0].id, 'one');
 await change(() => renderer.root.findByProps({ 'data-lxb-card': 'one' }).props.onContextMenu(contextEvent()));
 await change(() => menuItem('card.move.1').onSelect()); assert.equal(ref.current.getBoard().columns[0].cards.length, 0); assert.equal(ref.current.getBoard().columns[1].cards.at(-1).id, 'one');
});
test('board context menus hide disabled features, disable readonly writes and preserve native text menus', async t => {
 const { renderer, ref } = await mount(t, { features: { cards: false, columns: false, history: false } });
 await change(() => renderer.root.findByProps({ 'data-lxb-card': 'one' }).props.onContextMenu(contextEvent()));
 assert.deepEqual(globalThis.__likexTestMenu.items.map(item => item.id), ['card.open']);
 await change(() => renderer.update(h(LikeBoard, { ref, initialBoard: original() })));
 await change(() => renderer.root.findByProps({ 'data-lxb-card': 'one' }).props.onContextMenu(contextEvent())); assert.equal(menuItem('card.delete').disabled, true);
 for (const options of [{ input: true }, { selected: true }]) {
  globalThis.__likexTestMenu = null; const event = contextEvent(options);
  await change(() => renderer.root.findByProps({ 'data-lxb-card': 'one' }).props.onContextMenu(event)); assert.equal(event.defaultPrevented, false); assert.equal(globalThis.__likexTestMenu, null);
 }
});
