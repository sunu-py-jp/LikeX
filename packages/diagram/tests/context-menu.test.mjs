import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { act, createElement as h, createRef } from "react";
import { create } from "react-test-renderer";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const output = await build({ stdin: { contents: `export {default as View} from './src/diagram'; export * from './src/model';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'ui', setup(builder) {
  builder.onResolve({ filter: /^\.\/browser$/ }, () => ({ path: 'menu', namespace: 'test-menu' }));
  builder.onLoad({ filter: /.*/, namespace: 'test-menu' }, () => ({ contents: 'export function openContextMenu(options) { globalThis.__diagramMenu = options; options.closed = false; return () => { options.closed = true; options.onClose?.(); }; }' }));
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({path}) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { View, createDiagram: make } = api;
const changed = callback => act(async () => { await callback(); });
const menu = () => globalThis.__diagramMenu;
const action = id => { const item = menu().items.find(item => item.id === id); assert.ok(item, `Missing menu action: ${id}`); return item; };
const invoke = id => changed(() => action(id).onSelect());
async function mount(t, props = {}) {
  const ref = createRef(), focused = [];
  const win = new EventTarget(), root = { ownerDocument: { defaultView: win }, focus() { focused.push('root'); } };
  let renderer, current = { ref, initialDiagram: make({nodes: [{id:'one',text:'One',x:10,y:20},{id:'two',text:'Two',x:100,y:200}]}), onSave() {}, ...props };
  await changed(() => { renderer = create(h(View,current), { createNodeMock: element => element.props['data-likex-diagram'] === '' ? root : element.type === 'textarea' ? { focus() { focused.push('text'); } } : null }); });
  t.after(() => changed(() => renderer.unmount()));
  return { ref, renderer, focused, root, async update(patch) { current = { ...current, ...patch }; await changed(() => renderer.update(h(View,current))); } };
}
function event(target = { closest() { return null; } }) { return { target, clientX: 240, clientY: 160, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; }
async function open(view, id, kind = 'node') { const e = event(); await changed(() => view.renderer.root.findByProps(id ? { [`data-${kind}-id`]: id } : { className: 'lxg-canvas' }).props.onContextMenu(e)); assert.equal(e.prevented, true); return menu(); }

const connected=()=>make({nodes:[{id:'one',text:'One'},{id:'two',text:'Two'},{id:'three',text:'Three'}],edges:[{id:'edge',sourceId:'one',targetId:'two',label:'Next'},{id:'outside',sourceId:'two',targetId:'three'}]});

test('node duplication preserves internal links with fresh IDs and undoes one batch',async t=>{
  const view=await mount(t,{initialDiagram:connected()}); await changed(()=>view.ref.current.select(['one','two'])); await open(view,'two'); await invoke('duplicate');
  const model=view.ref.current.getModel(),copies=model.nodes.slice(3),edge=model.edges.at(-1);
  assert.equal(copies.length,2); assert.equal(model.edges.length,3); assert.equal(edge.sourceId,copies[0].id); assert.equal(edge.targetId,copies[1].id); assert.equal(edge.label,'Next');
  assert.deepEqual(view.ref.current.getSelection(),[...copies.map(node=>node.id),edge.id]);
  await changed(()=>view.ref.current.undo()); assert.equal(view.ref.current.getModel().nodes.length,3); assert.equal(view.ref.current.getModel().edges.length,2);
  await changed(async()=>assert.equal(await view.ref.current.undo(),false));
});

test('edge menu edits the clicked label, orders only edges and removes only its captured target',async t=>{
  const view=await mount(t,{initialDiagram:connected()}); await changed(()=>view.ref.current.select(['one'])); await open(view,'edge','edge');
  assert.deepEqual(view.ref.current.getSelection(),['edge']); await invoke('edit'); assert.equal(view.focused.at(-1),'text'); assert.equal(view.renderer.root.findByType('textarea').props.value,'Next');
  await open(view,'edge','edge'); await invoke('front'); assert.deepEqual(view.ref.current.getModel().edges.map(edge=>edge.id),['outside','edge']);
  await open(view,'edge','edge'); const remove=action('delete'); await changed(()=>view.ref.current.select(['outside'])); await changed(()=>remove.onSelect());
  assert.deepEqual(view.ref.current.getModel().edges.map(edge=>edge.id),['outside']); assert.equal(view.ref.current.getModel().nodes.length,3);
});

test('node ordering and cascading deletion use commands; blank canvas adds at the pointer',async t=>{
  const view=await mount(t,{initialDiagram:connected()}); await open(view,'one'); await invoke('front'); assert.deepEqual(view.ref.current.getModel().nodes.map(node=>node.id),['two','three','one']);
  await open(view,'one'); await invoke('delete'); assert.equal(view.ref.current.getModel().nodes.length,2); assert.deepEqual(view.ref.current.getModel().edges.map(edge=>edge.id),['outside']);
  await open(view); await invoke('add-diamond'); const node=view.ref.current.getModel().nodes.at(-1); assert.equal(node.shape,'diamond'); assert.equal(node.x,240); assert.equal(node.y,160);
});

test('connection menu starts at the clicked node and uses the existing connection command',async t=>{
  const view=await mount(t); await open(view,'two'); await invoke('connect');
  await changed(()=>view.renderer.root.findByProps({'data-node-id':'one'}).props.onPointerDown({button:0,shiftKey:false,clientX:0,clientY:0,preventDefault(){},stopPropagation(){}}));
  const [edge]=view.ref.current.getModel().edges; assert.equal(edge.sourceId,'two'); assert.equal(edge.targetId,'one');
});

test('permission, feature and read-only controls apply to menus and stale callbacks',async t=>{
  let requests=0;const view=await mount(t,{onEditRequest(){requests++;return false;}}); await open(view,'one'); await invoke('duplicate'); assert.equal(requests,1); assert.equal(view.ref.current.getModel().nodes.length,2);
  await view.update({features:{edges:false,move:false}}); await open(view,'one'); assert.ok(!menu().items.some(item=>['delete','connect','align-left'].includes(item.id)));
  await open(view,'one');const stale=action('duplicate');await view.update({readOnly:true});await changed(()=>stale.onSelect());assert.equal(view.ref.current.getModel().nodes.length,2);
  await open(view,'one');assert.ok(menu().items.every(item=>item.disabled));
  await view.update({features:{nodes:false,edges:false,history:false}});await open(view);assert.ok(!menu().items.some(item=>item.id.startsWith('add-')||item.id==='undo'));
});

test('right button does not replace edge multi-selection and native inputs keep their menu',async t=>{
  const view=await mount(t,{initialDiagram:connected()});await changed(()=>view.ref.current.select(['edge','outside']));
  await changed(()=>view.renderer.root.findByProps({'data-edge-id':'edge'}).props.onPointerDown({button:2}));assert.deepEqual(view.ref.current.getSelection(),['edge','outside']);
  const native=event({closest:()=>({})});native.currentTarget=view.root;await changed(()=>view.renderer.root.findByProps({'data-likex-diagram':''}).props.onContextMenu(native));assert.equal(native.prevented,false);
});


test('Shift right click preserves the native menu and the previous selection',async t=>{
  const view=await mount(t); await changed(()=>view.ref.current.select(['one'])); const native=event();native.shiftKey=true;
  await changed(()=>view.renderer.root.findByProps({'data-node-id':'two'}).props.onContextMenu(native));
  assert.equal(native.prevented,false);assert.deepEqual(view.ref.current.getSelection(),['one']);
});
