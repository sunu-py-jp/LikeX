import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { act, createElement as h, createRef } from "react";
import { create } from "react-test-renderer";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const output = await build({ stdin: { contents: `export {default as View} from './src/whiteboard'; export * from './src/model';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'ui', setup(builder) {
  builder.onResolve({ filter: /^\.\/browser$/ }, () => ({ path: 'menu', namespace: 'test-menu' }));
  builder.onLoad({ filter: /.*/, namespace: 'test-menu' }, () => ({ contents: 'export function openContextMenu(options) { globalThis.__whiteboardMenu = options; options.closed = false; return () => { options.closed = true; options.onClose?.(); }; }' }));
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({path}) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { View, createWhiteboard: make } = api;
const changed = callback => act(async () => { await callback(); });
const menu = () => globalThis.__whiteboardMenu;
const action = id => { const item = menu().items.find(item => item.id === id); assert.ok(item, `Missing menu action: ${id}`); return item; };
const invoke = id => changed(() => action(id).onSelect());
async function mount(t, props = {}) {
  const ref = createRef(), focused = [];
  const win = new EventTarget(), root = { ownerDocument: { defaultView: win }, focus() { focused.push('root'); } };
  let renderer, current = { ref, initialWhiteboard: make({elements: [{id:'one',text:'One',x:10,y:20},{id:'two',text:'Two',x:100,y:200}]}), onSave() {}, ...props };
  await changed(() => { renderer = create(h(View,current), { createNodeMock: element => element.props['data-likex-whiteboard'] === '' ? root : element.type === 'textarea' ? { focus() { focused.push('text'); } } : null }); });
  t.after(() => changed(() => renderer.unmount()));
  return { ref, renderer, focused, root, async update(patch) { current = { ...current, ...patch }; await changed(() => renderer.update(h(View,current))); } };
}
function event(target = { closest() { return null; } }) { return { target, clientX: 240, clientY: 160, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; }
async function open(view, id, kind = 'element') { const e = event(); await changed(() => view.renderer.root.findByProps(id ? { [`data-${kind}-id`]: id } : { className: 'lxw-canvas' }).props.onContextMenu(e)); assert.equal(e.prevented, true); return menu(); }

test('right click selects its target, duplicates saved fields and undoes the whole operation once', async t => {
  const view = await mount(t); await changed(() => view.ref.current.select(['one']));
  await open(view, 'two'); assert.deepEqual(view.ref.current.getSelection(), ['two']);
  await invoke('duplicate'); const items = view.ref.current.getModel().elements, copy = items[2];
  assert.notEqual(copy.id, 'two'); assert.equal(copy.text, 'Two'); assert.equal(copy.x, 124); assert.equal(copy.y, 224);
  assert.deepEqual(view.ref.current.getSelection(), [copy.id]);
  await changed(() => view.ref.current.undo()); assert.equal(view.ref.current.getModel().elements.length, 2);
  await changed(async () => assert.equal(await view.ref.current.undo(), false));
});

test('multi-selection preserves painting order and stale menus never apply to a changed model', async t => {
  const view = await mount(t, { initialWhiteboard: make({elements:[{id:'one'},{id:'two'},{id:'three'}]}) });
  await changed(() => view.ref.current.select(['one','two'])); await open(view,'two');
  assert.deepEqual(view.ref.current.getSelection(), ['one','two']); await invoke('front');
  assert.deepEqual(view.ref.current.getModel().elements.map(item=>item.id), ['three','one','two']);
  await open(view,'three'); const oldDelete = action('delete');
  await changed(() => view.ref.current.execute({type:'element.update',id:'one',patch:{text:'new'}}));
  assert.equal(menu().closed,true); await changed(() => oldDelete.onSelect()); assert.equal(view.ref.current.getModel().elements.length,3);
  await open(view,'three'); await invoke('delete'); assert.deepEqual(view.ref.current.getModel().elements.map(item=>item.id), ['one','two']);
});

test('blank canvas adds at the clicked world position and edit focuses the clicked object', async t => {
  const view = await mount(t); await open(view); await invoke('add-sticky');
  const added = view.ref.current.getModel().elements.at(-1); assert.equal(added.x,240); assert.equal(added.y,160);
  await changed(() => view.ref.current.select(['one','two'])); await open(view,'two'); await invoke('edit');
  assert.deepEqual(view.ref.current.getSelection(),['two']); assert.equal(view.focused.at(-1),'text');
  assert.equal(view.renderer.root.findByType('textarea').props.value,'Two');
});

test('menus honor permission denial, dynamic flags and read-only without dirty or history changes', async t => {
  let requests=0; const dirty=[]; const view=await mount(t,{onEditRequest(){requests++;return false;},onDirtyChange:value=>dirty.push(value)});
  await open(view,'one'); await invoke('duplicate'); assert.equal(requests,1); assert.equal(view.ref.current.getModel().elements.length,2); assert.deepEqual(dirty,[false]);
  await open(view,'one'); const oldDelete=action('delete'); await view.update({features:{elements:false,history:false}}); await changed(()=>oldDelete.onSelect()); assert.equal(view.ref.current.getModel().elements.length,2);
  const native=event(); await changed(()=>view.renderer.root.findByProps({'data-element-id':'one'}).props.onContextMenu(native)); assert.equal(native.prevented,false);
  await open(view); assert.ok(!menu().items.some(item=>item.id.startsWith('add-')||item.id==='undo'));
  await view.update({readOnly:true,features:{}}); await open(view,'one'); assert.ok(menu().items.every(item=>item.disabled));
});

test('native text menus are untouched and keyboard context targets the selected element', async t=>{
  const view=await mount(t); await changed(()=>view.ref.current.select(['two']));
  const handler=view.renderer.root.findByProps({'data-likex-whiteboard':''}).props.onContextMenu;
  const native=event({closest:()=>({})}); native.currentTarget=view.root; await changed(()=>handler(native)); assert.equal(native.prevented,false);
  const keyboard=event(view.root); keyboard.currentTarget=view.root; keyboard.clientX=0; keyboard.clientY=0;
  await changed(()=>handler(keyboard)); assert.equal(keyboard.prevented,true); await invoke('delete'); assert.deepEqual(view.ref.current.getModel().elements.map(item=>item.id),['one']);
});


test('image picker retains its original document and discards a result after that document changes',async t=>{
  const view=await mount(t); await open(view); await invoke('add-image');
  await changed(()=>view.ref.current.execute({type:'element.update',id:'one',patch:{text:'changed'}}));
  let reads=0; const file={size:10,name:'image.png',type:'image/png',async arrayBuffer(){reads++;throw new Error('must not read stale image');}};
  await changed(()=>view.renderer.root.findByProps({'aria-label':'画像を選択'}).props.onChange({target:{files:[file],value:'image.png'}}));
  assert.equal(reads,0); assert.equal(view.ref.current.getModel().elements.length,2);
});


test('Shift right click preserves the native menu and the previous selection',async t=>{
  const view=await mount(t); await changed(()=>view.ref.current.select(['one'])); const native=event();native.shiftKey=true;
  await changed(()=>view.renderer.root.findByProps({'data-element-id':'two'}).props.onContextMenu(native));
  assert.equal(native.prevented,false);assert.deepEqual(view.ref.current.getSelection(),['one']);
});
