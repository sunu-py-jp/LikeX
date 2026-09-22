import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { act, createElement as h, createRef } from "react";
import { create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({stdin:{contents:`export {default as View} from './src/diagram';export * from './src/model';`,resolveDir:new URL('../',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'react',setup(builder){builder.onResolve({filter:/^(react|react-dom|lucide-react)(\/.*)?$/},({path})=>({path:import.meta.resolve(path),external:true}));}}]});
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text+'\n//# sourceURL=likex-diagram-ui-tests.js').toString('base64')}`);
const {View,createDiagram:make,serializeDiagram:serialize} = api;
const changed = async callback=>act(async()=>{await callback();});
const initial=()=>make({title:'Initial',nodes:[{id:'one',text:'Before',x:80,y:80,width:180,height:100}]});
async function mount(t,props={}){const ref=createRef();let renderer;await changed(()=>{renderer=create(h(View,{ref,initialDiagram:initial(),...props}));});t.after(()=>changed(()=>renderer.unmount()));return {ref,renderer};}
const update={type:'node.update',id:'one',patch:{text:'After'}};
const keyEvent=key=>({key,ctrlKey:true,metaKey:false,shiftKey:false,target:{closest:()=>null},preventDefault(){}});
const pointer=(x=0,y=0,shiftKey=false)=>({button:0,clientX:x,clientY:y,shiftKey,pointerId:1,preventDefault(){},stopPropagation(){}});

test('SSR contains the canvas and isolated primary color; buttons never submit the host form',()=>{const html=renderToStaticMarkup(h(View,{initialDiagram:initial(),primaryColor:'#2563eb'}));assert.match(html,/data-likex-diagram/);assert.match(html,/Before/);assert.match(html,/--lxg-primary:#2563eb/);assert.equal((html.match(/<button /g)||[]).length,(html.match(/<button type="button"/g)||[]).length);});
test('onSave omission rejects ref editing and still allows static exports',async t=>{const {ref}=await mount(t);await changed(async()=>assert.equal(await ref.current.execute(update),null));assert.equal(ref.current.getModel().nodes[0].text,'Before');assert.match(ref.current.exportSvg(),/^<svg/);assert.equal(await ref.current.save(),false);});
test('host permission denial leaves model and history intact; selection is non-editing',async t=>{let allow=false,requests=0;const dirty=[];const {ref}=await mount(t,{onSave(){},onDirtyChange:value=>dirty.push(value),onEditRequest(){requests++;return allow;}});await changed(()=>ref.current.select(['one','missing']));assert.deepEqual(ref.current.getSelection(),['one']);assert.equal(requests,0);await changed(async()=>assert.equal(await ref.current.execute(update),null));assert.equal(requests,1);assert.equal(ref.current.getModel().nodes[0].text,'Before');await changed(async()=>assert.equal(await ref.current.undo(),false));allow=true;await changed(()=>ref.current.execute(update));assert.equal(ref.current.getModel().nodes[0].text,'After');assert.deepEqual(dirty,[false,true]);});
test('dynamic feature flags cannot be bypassed through execute or ref export',async t=>{const {ref,renderer}=await mount(t,{onSave(){},features:{formatting:false,resize:false,move:false,import:false,export:false}});for(const patch of [{fill:'#ffffff'},{width:350},{x:90}])await changed(async()=>assert.equal(await ref.current.execute({type:'node.update',id:'one',patch}),null));assert.throws(()=>ref.current.exportSvg(),/書き出し/);await changed(async()=>assert.equal(await ref.current.importJson(serialize(make())),null));await changed(()=>renderer.update(h(View,{ref,initialDiagram:initial(),onSave(){},features:{}})));await changed(()=>ref.current.execute(update));assert.equal(ref.current.getModel().nodes[0].text,'After');});
test('native import is atomic and undoable; save keeps the history and dirty baseline',async t=>{const phases=[];const {ref}=await mount(t,{onSave:async model=>model,onDirtyChange:value=>phases.push(value)});const imported=make({title:'Imported',nodes:[{id:'new',text:'Imported'}]});await changed(()=>ref.current.select(['one']));await changed(()=>ref.current.importJson(new Blob([serialize(imported)])));assert.equal(ref.current.getModel().title,'Imported');assert.deepEqual(ref.current.getSelection(),[]);const before=ref.current.exportJson();await changed(()=>ref.current.importJson('{"format":"bad"}'));assert.equal(ref.current.exportJson(),before);await changed(async()=>assert.equal(await ref.current.save(),true));await changed(async()=>assert.equal(await ref.current.undo(),true));assert.equal(ref.current.getModel().title,'Initial');await changed(async()=>assert.equal(await ref.current.redo(),true));assert.equal(ref.current.getModel().title,'Imported');assert.deepEqual(phases,[false,true,false,true,false]);});
test('pointer move and resize commit the latest coordinates through the model API; undo uses root shortcut',async t=>{const {ref,renderer}=await mount(t,{onSave(){}});let item=renderer.root.findByProps({'data-node-id':'one'});await changed(()=>item.props.onPointerDown(pointer(10,20)));const canvas=()=>renderer.root.findByProps({className:'lxg-canvas'});await changed(()=>canvas().props.onPointerMove(pointer(40,60)));await changed(()=>canvas().props.onPointerUp());assert.equal(ref.current.getModel().nodes[0].x,110);assert.equal(ref.current.getModel().nodes[0].y,120);item=renderer.root.findByProps({'data-node-id':'one'});const handles=item.findAllByType('rect').filter(node=>node.props.onPointerDown);assert.equal(handles.length,4);await changed(()=>handles[3].props.onPointerDown(pointer()));await changed(()=>canvas().props.onPointerMove(pointer(70,20)));await changed(()=>canvas().props.onPointerUp());assert.equal(ref.current.getModel().nodes[0].width,250);assert.equal(ref.current.getModel().nodes[0].height,120);await changed(()=>renderer.root.findByProps({'data-likex-diagram':''}).props.onKeyDown(keyEvent('z')));assert.equal(ref.current.getModel().nodes[0].width,180);await changed(()=>ref.current.execute({type:'node.remove',ids:['one']}));assert.deepEqual(ref.current.getSelection(),[]);});

function dragEnvironment(t) {
  const previousObserver=globalThis.ResizeObserver;globalThis.ResizeObserver=class { observe() {} disconnect() {} };t.after(()=>{globalThis.ResizeObserver=previousObserver;});
  const frames=new Map();let serial=0;
  const win=new EventTarget();Object.assign(win,{innerWidth:1000,innerHeight:700,requestAnimationFrame(callback){const id=++serial;frames.set(id,callback);return id;},cancelAnimationFrame(id){frames.delete(id);}});
  const canvas=new EventTarget();Object.assign(canvas,{ownerDocument:{defaultView:win},isConnected:true,getBoundingClientRect:()=>({left:0,top:0,right:500,bottom:400,width:500,height:400}),setPointerCapture(){},hasPointerCapture:()=>false});
  const root={ownerDocument:canvas.ownerDocument,focus(){}};
  return {canvas,root,win,frames,tick(){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(100));},emit(type,props={}){const event=new Event(type,{cancelable:true});Object.assign(event,props);win.dispatchEvent(event);}};
}

test('drag feedback pans at visible edges without changing saved geometry until drop, then undoes once',async t=>{
  if(!globalThis.ResizeObserver)globalThis.ResizeObserver=class {};
  const env=dragEnvironment(t),ref=createRef();let renderer;
  await changed(()=>{renderer=create(h(View,{ref,initialDiagram:initial(),onSave(){}}),{createNodeMock:element=>element.props.className==='lxg-canvas'?env.canvas:element.props['data-likex-diagram']===''?env.root:null});});
  t.after(()=>changed(()=>renderer.unmount()));
  const canvas=()=>renderer.root.findByProps({className:'lxg-canvas'}), item=()=>renderer.root.findByProps({'data-node-id':'one'});
  await changed(()=>item().props.onPointerDown(pointer(100,100)));
  await changed(()=>canvas().props.onPointerMove(pointer(530,200)));
  assert.equal(item().props.opacity,.62);
  assert.equal(ref.current.getModel().nodes[0].x,80);
  await changed(()=>env.tick());
  assert.ok(Number(canvas().props.viewBox.split(' ')[0])>0,'canvas must pan outside its visible edge');
  assert.equal(ref.current.getModel().nodes[0].x,80,'preview must not persist before release');
  await changed(()=>env.emit('pointerup',{pointerId:1}));
  assert.ok(ref.current.getModel().nodes[0].x>510,'commit includes the world distance traversed by auto-pan');
  assert.equal(ref.current.getModel().nodes[0].width,180,'moving never shrinks the shape');
  assert.equal(item().props.opacity,undefined);assert.equal(env.frames.size,0);
  await changed(()=>ref.current.undo());assert.equal(ref.current.getModel().nodes[0].x,80);
  await changed(async()=>assert.equal(await ref.current.undo(),false));
});

test('drag cancels on Escape, external model change, feature revocation and unmount',async t=>{
  if(!globalThis.ResizeObserver)globalThis.ResizeObserver=class {};
  const env=dragEnvironment(t),ref=createRef();let renderer,props={ref,initialDiagram:initial(),onSave(){}};
  const render=()=>h(View,props);
  await changed(()=>{renderer=create(render(),{createNodeMock:element=>element.props.className==='lxg-canvas'?env.canvas:element.props['data-likex-diagram']===''?env.root:null});});
  t.after(()=>changed(()=>renderer.unmount()));
  async function start(){await changed(()=>renderer.root.findByProps({'data-node-id':'one'}).props.onPointerDown(pointer(100,100)));await changed(()=>renderer.root.findByProps({className:'lxg-canvas'}).props.onPointerMove(pointer(530,200)));}
  await start();await changed(()=>env.emit('keydown',{key:'Escape'}));assert.equal(env.frames.size,0);await changed(()=>env.emit('pointerup',{pointerId:1}));assert.equal(ref.current.getModel().nodes[0].x,80);
  await start();await changed(()=>ref.current.execute(update));assert.equal(env.frames.size,0);await changed(()=>env.emit('pointerup',{pointerId:1}));assert.equal(ref.current.getModel().nodes[0].x,80);assert.equal(ref.current.getModel().nodes[0].text,'After');
  await start();props={...props,features:{move:false}};await changed(()=>renderer.update(render()));assert.equal(env.frames.size,0);await changed(()=>env.emit('pointerup',{pointerId:1}));assert.equal(ref.current.getModel().nodes[0].x,80);
  props={...props,features:{}};await changed(()=>renderer.update(render()));await start();await changed(()=>renderer.unmount());assert.equal(env.frames.size,0);
});


test('native pointer release uses its final coordinates, even without a last pointermove',async t=>{
  if(!globalThis.ResizeObserver)globalThis.ResizeObserver=class {};
  const env=dragEnvironment(t),ref=createRef();let renderer;
  await changed(()=>{renderer=create(h(View,{ref,initialDiagram:initial(),onSave(){}}),{createNodeMock:element=>element.props.className==='lxg-canvas'?env.canvas:element.props['data-likex-diagram']===''?env.root:null});});
  t.after(()=>changed(()=>renderer.unmount()));
  const canvas=()=>renderer.root.findByProps({className:'lxg-canvas'}), item=()=>renderer.root.findByProps({'data-node-id':'one'});
  await changed(()=>item().props.onPointerDown(pointer(100,100)));
  await changed(()=>canvas().props.onPointerMove(pointer(110,120)));
  await changed(()=>env.emit('pointerup',{pointerId:2,clientX:900,clientY:900}));
  assert.equal(ref.current.getModel().nodes[0].x,80,'another pointer must not finish the gesture');
  await changed(()=>env.emit('pointerup',{pointerId:1,clientX:160,clientY:180}));
  assert.equal(ref.current.getModel().nodes[0].x,140);
  assert.equal(ref.current.getModel().nodes[0].y,160);
  await changed(()=>canvas().props.onPointerDown(pointer(100,100)));
  await changed(()=>env.emit('pointerup',{pointerId:1,clientX:150,clientY:130}));
  assert.match(canvas().props.viewBox,/^-50 -30 /,'panning also uses final release coordinates');
});
