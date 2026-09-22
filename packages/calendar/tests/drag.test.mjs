import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const bundle=await build({entryPoints:[new URL('../src/use-calendar-drag.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'external-react',setup(builder){builder.onResolve({filter:/^react$/},({path})=>({path:import.meta.resolve(path),external:true}));}}]});
const {useCalendarDrag}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function environment(){
 const listeners=new Map(),frames=new Map(),previews=[];let sequence=0;
 const win={innerWidth:600,innerHeight:300,setTimeout(){return 0;},clearTimeout(){},requestAnimationFrame(fn){const key=++sequence;frames.set(key,fn);return key;},cancelAnimationFrame(key){frames.delete(key);},addEventListener(name,fn){listeners.set('window:'+name,fn);},removeEventListener(name){listeners.delete('window:'+name);},getComputedStyle(){return{color:'#123456',getPropertyValue:()=> '#ffffff'};}};
 const owner={defaultView:win,body:{append(node){previews.push(node);}},createElement(){return{style:{},remove(){this.removed=true;}};},addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);},elementFromPoint(){return owner.hit;}};
 const viewport={ownerDocument:owner,scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({left:0,top:0,right:600,bottom:300}),contains:()=>true,querySelectorAll:()=>[]};
 const transfer={setData(){},setDragImage(node){transfer.preview=node;}};
 const event=(x=20,y=80)=>({clientX:x,clientY:y,preventDefault(){this.prevented=true;},stopPropagation(){},dataTransfer:transfer});
 const over=async(x,y)=>act(()=>listeners.get('dragover')?.(event(x,y)));
 const frame=async(time=16)=>act(()=>{const entries=[...frames];frames.clear();for(const[,fn]of entries)fn(time);});
 return{listeners,frames,previews,owner,viewport,transfer,event,over,frame};
}
async function mount(t,options,dom){let hook,renderer;function Host(props){hook=useCalendarDrag(props);return h('div',{ref:hook.viewportRef});}await act(()=>{renderer=create(h(Host,options),{createNodeMock:()=>dom.viewport});});t.after(()=>act(()=>renderer.unmount()));return{get api(){return hook;},configure:next=>act(()=>renderer.update(h(Host,next)))};}

const calendar={id:'calendar',events:[{id:'event',title:'Review'}]};
const base=(onMove=()=>{})=>({calendar,rangeKey:'week:2026-09-21',editable:true,onMove});
function calendarDom(){const dom=environment();dom.owner.hit={dataset:{lxcDropDate:'2026-09-24'},closest(){return this;},getBoundingClientRect:()=>({left:100,right:200,top:0,bottom:300})};return dom;}
test('calendar highlights the date and moves only the locally started event after a real drop',async t=>{const calls=[],dom=calendarDom(),host=await mount(t,base((...args)=>calls.push(args)),dom);await act(()=>host.api.drop(dom.event()));assert.deepEqual(calls,[]);await act(()=>host.api.start(dom.event(),calendar.events[0]));assert.equal(dom.transfer.preview.style.width,'176px');assert.equal(dom.transfer.preview.style.opacity,'.78');await dom.over(150,80);assert.deepEqual(host.api.target,{date:'2026-09-24'});assert.deepEqual(calls,[]);await act(()=>host.api.drop(dom.event()));assert.deepEqual(calls,[['event','2026-09-24',undefined]]);assert.equal(dom.previews[0].removed,true);});
test('calendar drop over an existing event resolves a half-hour slot and autoscroll continues outside bounds',async t=>{const dom=calendarDom(),host=await mount(t,base(),dom);dom.owner.hit.dataset.lxcTimeColumn='';await act(()=>host.api.start(dom.event(),calendar.events[0]));await dom.over(150,145);assert.deepEqual(host.api.target,{date:'2026-09-24',time:'02:00'});await dom.over(650,350);await dom.frame();assert.ok(dom.viewport.scrollTop>0);assert.ok(dom.viewport.scrollLeft>0);assert.equal(host.api.target,null);});
test('calendar capability changes, navigation and Escape cancel drag markers and pending movement',async t=>{const calls=[],dom=calendarDom(),props=base((...args)=>calls.push(args)),host=await mount(t,props,dom);for(const mode of ['escape','readonly','navigation','replace']){await host.configure(props);await act(()=>host.api.start(dom.event(),calendar.events[0]));await dom.over(150,80);if(mode==='escape')await act(()=>dom.listeners.get('keydown')({key:'Escape'}));else await host.configure({...props,...(mode==='readonly'?{editable:false}:mode==='navigation'?{rangeKey:'month:2026-09'}:{calendar:{...calendar}})});await act(()=>host.api.drop(dom.event()));assert.equal(dom.frames.size,0);assert.equal(host.api.target,null);}assert.deepEqual(calls,[]);});

test('calendar drop recalculates the final time when release follows the last dragover',async t=>{
  const calls=[],dom=calendarDom(),host=await mount(t,base((...args)=>calls.push(args)),dom);
  dom.owner.hit.dataset.lxcTimeColumn='';
  await act(()=>host.api.start(dom.event(),calendar.events[0]));
  await dom.over(150,145);assert.equal(host.api.target.time,'02:00');
  await act(()=>host.api.drop(dom.event(150,177)));
  assert.deepEqual(calls,[['event','2026-09-24','02:30']]);
});
