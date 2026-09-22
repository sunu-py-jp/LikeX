import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

const output = await build({ stdin: { contents: `
  export { useSlideEditor } from './src/state/use-slide-editor';
  export { createSlideDeck } from './src/model';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useSlideEditor, createSlideDeck } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const initialDeck = () => createSlideDeck({ width: 80, height: 40, slides: ['one','two','three'].map(id => ({ id, name:id, background:'#fff', notes:'', elements:[] })) });
function png({ width, height }) {
  const bytes = new Uint8Array(33);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const header = new DataView(bytes.buffer); header.setUint32(16,width); header.setUint32(20,height);
  return new Blob([bytes], {type:'image/png'});
}
async function mount(t, supplied = {}) {
  let editor, view, closed = false, props = { initialDeck: initialDeck(), onSave: () => {}, ...supplied };
  const ref = createRef();
  function Probe() { editor = useSlideEditor({...props, ref}); return null; }
  await change(() => { view = create(h(Probe)); });
  const unmount = async () => { if (!closed) { closed = true; await change(() => view.unmount()); } };
  t.after(unmount);
  return { ref, get editor() {return editor;}, unmount, async update(patch) { props={...props,...patch}; await change(() => view.update(h(Probe)));} };
}

test('public image handles support readonly single, range, all and ID lists without mutation or edit permission', async t => {
  let requests=0; const app=await mount(t,{readOnly:true,onEditRequest:()=>{requests++;return true;}});
  const before=app.ref.current.getDeck(); const selected=app.ref.current.getSelection();
  await change(async()=>{
    const one=await app.ref.current.exportImage({slideId:'two',renderer:png,scale:2});
    assert.equal(one.blob.type,'image/png'); assert.equal(one.width,160); assert.equal(one.pageNumber,2);
    assert.deepEqual((await app.ref.current.exportImages({range:{from:2,to:3},renderer:png})).map(x=>x.slideId),['two','three']);
    assert.deepEqual((await app.ref.current.exportImages({slideIds:['three','one'],renderer:png})).map(x=>x.pageNumber),[3,1]);
    assert.equal((await app.ref.current.exportImages({renderer:png})).length,3);
  });
  assert.deepEqual(app.ref.current.getDeck(),before); assert.deepEqual(app.ref.current.getSelection(),selected);
  assert.equal(app.editor.canUndo,false); assert.equal(app.editor.dirty,false); assert.equal(requests,0);
});

test('image export flushes pending input once, captures requested targets, and leaves the resulting edit undoable', async t => {
  const permission=deferred();const app=await mount(t,{onEditRequest:()=>permission.promise});
  let pending=true, flushes=0; const calls=[];
  app.editor.registerInputFlush(()=>{if(pending){flushes++;pending=false;void app.editor.execute({type:'deck.rename',title:'Buffered title'});}},()=>pending);
  const options={range:{from:2,to:3},renderer:request=>{calls.push(request.deck.title);return png(request);}};
  let result;
  await change(()=>{result=app.ref.current.exportImages(options);});
  options.range.from=1;
  assert.equal(app.editor.busy,'export'); assert.equal(calls.length,0);
  await change(async()=>{permission.resolve(true);assert.deepEqual((await result).map(x=>x.pageNumber),[2,3]);});
  assert.equal(flushes,1);assert.deepEqual(calls,['Buffered title','Buffered title']);
  assert.equal(app.editor.dirty,true);assert.equal(app.editor.canUndo,true);
  await change(()=>app.ref.current.undo());assert.equal(app.ref.current.getDeck().title,'新しいプレゼンテーション');
});

test('feature disabling and unmount reject exports even if a renderer ignores cancellation', async t => {
  for(const outcome of ['disable','unmount','abort']) await t.test(outcome,async child=>{
    const app=await mount(child), delayed=deferred(), started=deferred(), external=new AbortController();let calls=0,result;
    await change(()=>{result=app.ref.current.exportImages({renderer:async request=>{calls++;started.resolve();await delayed.promise;return png(request);},signal:external.signal});});
    await started.promise;
    const rejected=assert.rejects(result,outcome==='disable'?/無効/:{name:'AbortError'});
    if(outcome==='disable')await app.update({features:{export:false}});
    else if(outcome==='unmount')await app.unmount();
    else await change(()=>external.abort());
    await rejected;await change(()=>delayed.resolve());
    assert.equal(calls,1);
    if(outcome!=='unmount'){assert.equal(app.editor.busy,null);assert.equal(app.editor.dirty,false);}
  });
});

test('disabled, already-cancelled and overlapping exports reject without changing the current export', async t=>{
  const app=await mount(t,{features:{export:false}});
  await assert.rejects(app.ref.current.exportImage({pageNumber:1,renderer:png}),/無効/);
  await app.update({features:{export:true}});
  const abort=new AbortController();abort.abort();let flushed=0;
  app.editor.registerInputFlush(()=>{flushed++;},()=>false);
  await assert.rejects(app.ref.current.exportImage({pageNumber:1,renderer:png,signal:abort.signal}),{name:'AbortError'});
  assert.equal(flushed,0);
  const wait=deferred(),started=deferred();let first;
  await change(()=>{first=app.ref.current.exportImage({pageNumber:1,renderer:async req=>{started.resolve();await wait.promise;return png(req);}});});
  await started.promise;
  await change(()=>assert.rejects(app.ref.current.exportImages({renderer:png}),/別の処理中/));
  assert.equal(app.editor.busy,'export');
  await change(async()=>{wait.resolve();assert.equal((await first).pageNumber,1);});
  assert.equal(app.editor.busy,null);
});

test('readonly transition releases export waiting on an abandoned edit request', async t => {
  let permissionSignal, rendered=0, result, pending=true;
  const app=await mount(t,{onEditRequest:(_request,context)=>{permissionSignal=context.signal;return new Promise(()=>{});}});
  app.editor.registerInputFlush(()=>{if(pending){pending=false;void app.editor.execute({type:'deck.rename',title:'Uncommitted'});}},()=>pending,()=>{pending=false;});
  await change(()=>{result=app.ref.current.exportImage({pageNumber:1,renderer:request=>{rendered++;assert.equal(request.deck.title,'新しいプレゼンテーション');return png(request);}});});
  assert.equal(app.editor.busy,'export');
  await app.update({readOnly:true});
  await change(async()=>{assert.equal((await result).pageNumber,1);});
  assert.equal(permissionSignal.aborted,true);assert.equal(rendered,1);assert.equal(app.editor.busy,null);assert.equal(app.editor.notice,null);
  await change(()=>app.ref.current.exportImage({pageNumber:2,renderer:png}));
});
