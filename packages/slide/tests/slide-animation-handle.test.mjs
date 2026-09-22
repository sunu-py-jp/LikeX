import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

const output = await build({ stdin: { contents: `
  export { useSlideEditor } from './src/state/use-slide-editor';
  export { createSlideDeck, createSlideElement, parseSlideDeck } from './src/model';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useSlideEditor, createSlideDeck, createSlideElement, parseSlideDeck } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const change = async callback => { await act(async () => { await callback(); }); };
const animation = () => ({ id:'move', trigger:{type:'click'}, animation:{type:'tween', elementId:'box', durationMs:500, easing:'ease-in-out', to:{x:500,fill:'#ff0000',opacity:.5}} });
const deck = () => createSlideDeck({slides:[{id:'page',name:'Page',notes:'',background:'#fff',elements:[createSlideElement({id:'box',type:'shape',x:10,fill:'#0000ff'})],animations:[animation()]}]});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function mount(t, supplied={}) {
  let editor, view, props={initialDeck:deck(),onSave:()=>{},...supplied};const ref=createRef();
  function Probe(){editor=useSlideEditor({...props,ref});return null;}
  await change(()=>{view=create(h(Probe));});t.after(()=>change(()=>view.unmount()));
  return {ref,get editor(){return editor;},async update(patch){props={...props,...patch};await change(()=>view.update(h(Probe)));}};
}
function png(request){const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);const v=new DataView(b.buffer);v.setUint32(16,request.width);v.setUint32(20,request.height);return new Blob([b],{type:'image/png'});}

test('ref queries default to final properties, full queries and native export preserve animation source',async t=>{
  const app=await mount(t);
  const final=app.ref.current.getDeck();assert.equal(final.slides[0].elements[0].x,500);assert.equal(final.slides[0].animations,undefined);
  assert.equal(app.ref.current.getSlide('page').elements[0].fill,'#ff0000');
  assert.equal(app.ref.current.getElement('page','box').opacity,.5);
  assert.equal(app.ref.current.getElements('page')[0].x,500);assert.equal(app.ref.current.getSlides()[0].animations,undefined);
  const full=app.ref.current.getDeck({includeAnimations:true});assert.equal(full.slides[0].elements[0].x,10);assert.equal(full.slides[0].animations[0].id,'move');
  assert.equal(app.ref.current.getElement('page','box',{includeAnimations:true}).x,10);
  const steps=app.ref.current.getAnimations('page');steps[0].animation.to.x=999;
  assert.equal(app.ref.current.getAnimations('page')[0].animation.to.x,500);
  let native;await change(async()=>{native=parseSlideDeck(await(await app.ref.current.exportNative()).text());});
  assert.equal(native.slides[0].elements[0].x,10);assert.equal(native.slides[0].animations[0].animation.to.x,500);
  assert.equal(app.editor.canUndo,false);assert.equal(app.editor.dirty,false);
});

test('animation commands, save callbacks and undo share the full editable model',async t=>{
  const changes=[],saves=[];let permits=0;
  const app=await mount(t,{onEditRequest:()=>{permits++;return true;},onChange:next=>changes.push(next),onSave:next=>{saves.push(next);}});
  const step=animation();step.animation.to.x=700;
  await change(()=>app.ref.current.execute({type:'animation.set',slideId:'page',animations:[step]}));
  assert.equal(app.ref.current.getElement('page','box').x,700);assert.equal(app.editor.dirty,true);assert.equal(permits,1);
  await change(()=>app.ref.current.save());
  assert.equal(saves[0].slides[0].elements[0].x,10);assert.equal(saves[0].slides[0].animations[0].animation.to.x,700);
  assert.equal(changes.at(-1).slides[0].animations[0].animation.to.x,700);assert.equal(app.editor.dirty,false);
  await change(()=>app.ref.current.undo());assert.equal(app.ref.current.getElement('page','box').x,500);
  await change(()=>app.ref.current.redo());assert.equal(app.ref.current.getElement('page','box').x,700);
});

test('animation commands obey feature flags, readonly and latest permission-time settings',async t=>{
  for(const options of [{features:{animations:false}},{readOnly:true},{onSave:undefined}]){
    const app=await mount(t,options);await change(async()=>assert.equal(await app.ref.current.execute({type:'animation.remove',slideId:'page',animationId:'move'}),null));
    assert.equal(app.ref.current.getAnimations('page').length,1);assert.equal(app.editor.dirty,false);
  }
  const permission=deferred(),app=await mount(t,{onEditRequest:()=>permission.promise});let result;
  await change(()=>{result=app.ref.current.execute({type:'animation.remove',slideId:'page',animationId:'move'});});
  await app.update({features:{animations:false}});
  await change(async()=>{permission.resolve(true);assert.equal(await result,null);});
  assert.equal(app.ref.current.getAnimations('page').length,1);
});

test('image output chooses final or initial properties while PPTX warns about static conversion',async t=>{
  const app=await mount(t),seen=[],warnings=[];
  const renderer=request=>{seen.push(request.slide);return png(request);};
  await change(()=>app.ref.current.exportImage({pageNumber:1,renderer}));
  await change(()=>app.ref.current.exportImages({animationState:'initial',renderer}));
  assert.equal(seen[0].elements[0].x,500);assert.equal(seen[1].elements[0].x,10);assert.equal(seen[0].animations,undefined);assert.equal(seen[1].animations,undefined);
  await change(()=>app.ref.current.exportPptx({onWarning:message=>warnings.push(message)}));
  assert.equal(warnings.length,1);assert.match(warnings[0],/アニメーション/);assert.equal(app.editor.notice.kind,'info');
  assert.equal(app.ref.current.getDeck({includeAnimations:true}).slides[0].animations.length,1);assert.equal(app.editor.dirty,false);
});
