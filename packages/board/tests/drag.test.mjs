import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const bundle=await build({entryPoints:[new URL('../src/ui/use-board-drag.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'external-react',setup(builder){builder.onResolve({filter:/^react$/},({path})=>({path:import.meta.resolve(path),external:true}));}}]});
const {useBoardDrag}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
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
async function mount(t,options,dom){let hook,renderer;function Host(props){hook=useBoardDrag(props);return h('div',{ref:hook.viewportRef});}await act(()=>{renderer=create(h(Host,options),{createNodeMock:()=>dom.viewport});});t.after(()=>act(()=>renderer.unmount()));return{get api(){return hook;},configure:next=>act(()=>renderer.update(h(Host,next)))};}

const board={format:'likex.board',version:1,id:'board',title:'Board',labels:[],members:[],columns:[{id:'a',cards:[{id:'one'},{id:'two'}]},{id:'b',cards:[{id:'three'}]}]};
function boardDom(){const dom=environment();const node=(dataset,left,top,right,bottom)=>({dataset,getBoundingClientRect:()=>({left,top,right,bottom})});const cardsA=[node({lxbCard:'one'},10,60,270,105),node({lxbCard:'two'},10,115,270,155)],cardsB=[node({lxbCard:'three'},310,60,570,105)];const a={...node({lxbColumn:'a'},0,0,280,280),querySelectorAll:()=>cardsA},b={...node({lxbColumn:'b'},300,0,580,280),querySelectorAll:()=>cardsB};const lists=[{...node({},10,50,270,250),scrollTop:0},{...node({},310,50,570,250),scrollTop:0}];dom.viewport.querySelectorAll=selector=>selector==='[data-lxb-column]'?[a,b]:lists;return{...dom,lists};}
const options=(execute=()=>Promise.resolve())=>({board,editable:true,cards:true,columns:true,move:true,execute});
test('card drag uses a small translucent preview and a precise before/after destination without editing until drop',async t=>{const calls=[],dom=boardDom(),host=await mount(t,options(command=>{calls.push(command);return Promise.resolve();}),dom);await act(()=>host.api.start(dom.event(),{kind:'card',id:'one',title:'One'}));assert.equal(dom.transfer.preview.style.width,'176px');assert.equal(dom.transfer.preview.style.opacity,'.78');await dom.over(400,120);assert.deepEqual(host.api.target,{kind:'card',columnId:'b',index:1,anchorId:'three',edge:'after'});assert.deepEqual(calls,[]);await act(()=>host.api.drop(dom.event(400,120)));assert.deepEqual(calls,[{type:'card.move',cardId:'one',columnId:'b',index:1}]);assert.equal(dom.previews[0].removed,true);assert.equal(dom.frames.size,0);});
test('column insertion excludes the source and scroll continues outside the board while card lists scroll vertically',async t=>{const calls=[],dom=boardDom(),host=await mount(t,options(command=>{calls.push(command);return Promise.resolve();}),dom);await act(()=>host.api.start(dom.event(),{kind:'column',id:'a',title:'A'}));await dom.over(550,100);assert.deepEqual(host.api.target,{kind:'column',index:1,anchorId:'b',edge:'after'});await dom.over(650,100);await dom.frame();assert.ok(dom.viewport.scrollLeft>0);assert.equal(host.api.target,null);await dom.over(550,100);await act(()=>host.api.drop(dom.event(550,100)));assert.equal(calls[0].index,1);await act(()=>host.api.start(dom.event(),{kind:'card',id:'one',title:'One'}));await dom.over(400,330);await dom.frame();assert.ok(dom.lists[1].scrollTop>0);});
test('escape, capability changes, data replacement and foreign drops cannot commit a board drag',async t=>{const calls=[],dom=boardDom(),base=options(command=>{calls.push(command);return Promise.resolve();}),host=await mount(t,base,dom);await act(()=>host.api.drop(dom.event()));for(const mode of ['escape','readonly','replaced']){await host.configure(base);await act(()=>host.api.start(dom.event(),{kind:'card',id:'one',title:'One'}));await dom.over(400,80);if(mode==='escape')await act(()=>dom.listeners.get('keydown')({key:'Escape'}));else await host.configure({...base,...(mode==='readonly'?{editable:false}:{board:{...board}})});await act(()=>host.api.drop(dom.event()));assert.equal(dom.frames.size,0);assert.equal(host.api.target,null);}assert.deepEqual(calls,[]);});

test('card drop recalculates its final side when the pointer crosses the midpoint since dragover',async t=>{
  const calls=[],dom=boardDom(),host=await mount(t,options(command=>{calls.push(command);return Promise.resolve();}),dom);
  await act(()=>host.api.start(dom.event(),{kind:'card',id:'one',title:'One'}));
  await dom.over(400,70);assert.equal(host.api.target.edge,'before');
  await act(()=>host.api.drop(dom.event(400,100)));
  assert.deepEqual(calls,[{type:'card.move',cardId:'one',columnId:'b',index:1}]);
});
