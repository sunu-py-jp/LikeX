import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({entryPoints:[new URL('../src/use-calendar-resize.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react$/},({path})=>({path:import.meta.resolve(path),external:true}));}}]});
const {useCalendarResize}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const item={id:'e',title:'Review',allDay:false,start:'2026-09-22T09:00:00+09:00',end:'2026-09-22T10:00:00+09:00'};
const calendar={format:'likex.calendar',version:1,id:'c',title:'Team',timeZone:'Asia/Tokyo',events:[item]};
function environment(){
 const listeners=new Map(),frames=new Map();let sequence=0;
 const win={requestAnimationFrame(fn){frames.set(++sequence,fn);return sequence;},cancelAnimationFrame(id){frames.delete(id);},addEventListener(name,fn){listeners.set(`window:${name}`,fn);},removeEventListener(name){listeners.delete(`window:${name}`);}};
 const owner={defaultView:win,addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
 const viewport={ownerDocument:owner,scrollTop:0,getBoundingClientRect:()=>({left:0,right:600,top:0,bottom:600})};
 const event=(y=200)=>({button:0,pointerId:1,clientX:200,clientY:y,currentTarget:{setPointerCapture(){},hasPointerCapture(){return false;}},preventDefault(){},stopPropagation(){}});
 return{listeners,frames,viewport,event};
}
async function mount(t, suppliedCalendar = calendar){const dom=environment(),commands=[],errors=[];let api,renderer;
 const options={calendar:suppliedCalendar,rangeKey:'week',editable:true,viewportRef:{current:dom.viewport},onResize:c=>commands.push(c),onError:e=>errors.push(e)};
 function Host(props){api=useCalendarResize(props);return null;}
 await act(()=>{renderer=create(h(Host,options));});t.after(()=>act(()=>renderer.unmount()));
 return{dom,commands,errors,get api(){return api;},configure:patch=>act(()=>renderer.update(h(Host,{...options,...patch})))};
}
test('bottom resize previews quarter-hour times then commits one update using final release position',async t=>{
 const host=await mount(t);await act(()=>host.api.start(host.dom.event(),item,'2026-09-22','end'));
 await act(()=>host.dom.listeners.get('pointermove')(host.dom.event(232)));
 assert.equal(host.api.preview.to,630);assert.equal(host.commands.length,0);
 await act(()=>host.dom.listeners.get('pointerup')(host.dom.event(264)));
 assert.deepEqual(host.commands,[{type:'event.update',id:'e',changes:{end:'2026-09-22T02:00:00.000Z'}}]);
 assert.equal(host.api.preview,null);assert.equal(host.dom.frames.size,0);
});
test('top resize keeps end fixed and cannot invert or shrink a visible event below fifteen minutes',async t=>{
 const host=await mount(t);await act(()=>host.api.start(host.dom.event(),item,'2026-09-22','start'));
 await act(()=>host.dom.listeners.get('pointermove')(host.dom.event(400)));
 assert.equal(host.api.preview.from,585);
 await act(()=>host.dom.listeners.get('pointerup')(host.dom.event(136)));
 assert.deepEqual(host.commands[0],{type:'event.update',id:'e',changes:{start:'2026-09-21T23:00:00.000Z'}});
});
test('Escape, read-only, model replacement and navigation cancel without committing',async t=>{
 for(const reason of ['escape','readonly','replace','navigate']){
  const host=await mount(t);await act(()=>host.api.start(host.dom.event(),item,'2026-09-22','end'));
  await act(()=>host.dom.listeners.get('pointermove')(host.dom.event(264)));
  if(reason==='escape')await act(()=>host.dom.listeners.get('keydown')({key:'Escape',preventDefault(){}}));
  else await host.configure(reason==='readonly'?{editable:false}:reason==='replace'?{calendar:{...calendar}}:{rangeKey:'day'});
  assert.equal(host.api.preview,null);assert.equal(host.dom.frames.size,0);assert.deepEqual(host.commands,[]);
 }
});
test('resize accounts for auto-scroll without committing while the pointer is held',async t=>{
 const host=await mount(t);await act(()=>host.api.start(host.dom.event(),item,'2026-09-22','end'));
 host.dom.viewport.scrollTop=64;
 await act(()=>host.dom.listeners.get('pointermove')(host.dom.event(200)));
 assert.equal(host.api.preview.to,660);assert.equal(host.commands.length,0);
 await act(()=>host.dom.listeners.get('pointerup')(host.dom.event(200)));
 assert.equal(host.commands[0].changes.end,'2026-09-22T02:00:00.000Z');
});

test('short events remain unchanged after a click, sub-step movement, or returning to the original edge',async t=>{
 for(const edge of ['start','end'])for(const motion of [null,3,5,32]){
  const short={...item,end:'2026-09-22T09:05:00+09:00'},host=await mount(t,{...calendar,events:[short]});
  await act(()=>host.api.start(host.dom.event(),short,'2026-09-22',edge));
  if(motion!==null)await act(()=>host.dom.listeners.get('pointermove')(host.dom.event(200+motion)));
  await act(()=>host.dom.listeners.get('pointerup')(host.dom.event(motion===3||motion===5?200+motion:200)));
  assert.deepEqual(host.commands,[],`${edge}: ${motion}`);assert.deepEqual(host.errors,[]);
 }
});
test('holding an edge near the viewport boundary does not auto-scroll or resize before dragging',async t=>{
 const host=await mount(t);await act(()=>host.api.start(host.dom.event(598),item,'2026-09-22','end'));
 for(let tick=1;tick<4;tick++)await act(()=>{const frames=[...host.dom.frames.values()];host.dom.frames.clear();for(const frame of frames)frame(tick*16);});
 assert.equal(host.dom.viewport.scrollTop,0);assert.equal(host.api.preview,null);
 await act(()=>host.dom.listeners.get('pointerup')(host.dom.event(598)));assert.deepEqual(host.commands,[]);
});
test('multi-day short segments resize against the true opposite endpoint instead of their midnight clipping',async t=>{
 const crossing={...item,start:'2026-09-22T23:50:00+09:00',end:'2026-09-23T01:00:00+09:00'};
 const start=await mount(t,{...calendar,events:[crossing]});await act(()=>start.api.start(start.dom.event(),crossing,'2026-09-22','start'));
 await act(()=>start.dom.listeners.get('pointerup')(start.dom.event(216)));
 assert.equal(start.commands[0].changes.start,'2026-09-22T15:00:00.000Z');assert.deepEqual(start.errors,[]);
 const ending={...crossing,start:'2026-09-22T22:00:00+09:00',end:'2026-09-23T00:05:00+09:00'};
 const end=await mount(t,{...calendar,events:[ending]});await act(()=>end.api.start(end.dom.event(),ending,'2026-09-23','end'));
 await act(()=>end.dom.listeners.get('pointerup')(end.dom.event(184)));
 assert.equal(end.commands[0].changes.end,'2026-09-22T15:00:00.000Z');assert.deepEqual(end.errors,[]);
});

test('midnight crossing respects the actual fifteen-minute minimum instead of only the visible segment',async t=>{
 const crossing={...item,start:'2026-09-22T23:50:00+09:00',end:'2026-09-23T00:05:00+09:00'};
 for(const edge of ['start','end']){
  const host=await mount(t,{...calendar,events:[crossing]});await act(()=>host.api.start(host.dom.event(),crossing,edge==='start'?'2026-09-22':'2026-09-23',edge));
  await act(()=>host.dom.listeners.get('pointerup')(host.dom.event(edge==='start'?216:184)));
  assert.deepEqual(host.commands,[]);assert.deepEqual(host.errors,[]);
 }
});
