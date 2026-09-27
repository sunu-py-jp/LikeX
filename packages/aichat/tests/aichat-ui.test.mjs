import test from 'node:test';import assert from 'node:assert/strict';import {act,createElement as h,createRef,StrictMode} from 'react';import {create} from 'react-test-renderer';import {renderToStaticMarkup} from 'react-dom/server';import {load,deferred,tick} from './helpers.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {LikeAIChat,createAIChat,createAIChatMessage}=await load('index');
const seed=()=>createAIChat({id:'aichat',title:'Test aichat',conversations:[{id:'a',title:'A',messages:[createAIChatMessage({id:'seed',role:'user',content:'<b>plain</b>',createdAt:'2026-09-22T01:00:00Z'})]},{id:'b',title:'B',messages:[]}]});
const update=fn=>act(async()=>{await fn()});
async function mount(t,props={}){let renderer;const ref=createRef();await update(()=>{renderer=create(h(StrictMode,null,h(LikeAIChat,{ref,initialAIChat:seed(),...props})))});let ended=false;const unmount=async()=>{if(!ended){ended=true;await update(()=>renderer.unmount())}};t.after(unmount);return{renderer,ref,unmount}}
test('SSR renders text safely and includes scoped layout, colors, read-only controls',()=>{
 const html=renderToStaticMarkup(h(LikeAIChat,{initialAIChat:seed(),primaryColor:'#556677'}));
 for(const content of ['lxai-root','lxai-sidebar','lxai-composer','--lxai-primary:#556677','&lt;b&gt;plain&lt;/b&gt;','閲覧モード'])assert.ok(html.includes(content),content);
 assert.equal(html.includes('<b>plain</b>'),false);
});
test('read-only and feature flags are shared by UI and imperative writes',async t=>{
 const {renderer,ref}=await mount(t);
 assert.equal(renderer.root.findByProps({'aria-label':'送信'}).props.disabled,true);
 await update(async()=>assert.equal(await ref.current.send('blocked'),false));
 await update(async()=>assert.equal(await ref.current.execute({type:'aichat.update',title:'blocked'}),null));
 assert.equal(ref.current.getAIChat().title,'Test aichat');
 const enabled=await mount(t,{onSave(){},features:{send:false,edit:false,delete:false,import:false,export:false,conversations:false}});
 await update(async()=>assert.equal(await enabled.ref.current.send('blocked'),false));
 assert.equal(enabled.renderer.root.findAllByProps({'aria-label':'メッセージを編集'}).length,0);
 assert.equal(enabled.ref.current.exportNative(),null);
});
test('switching conversations cancels streams and ignores delayed results even under StrictMode',async t=>{
 const response=deferred();let signal;const app=await mount(t,{onSave(){},onSend(_,context){signal=context.signal;return response.promise}});
 let task;await update(()=>{task=app.ref.current.send('Question')});await tick();
 await update(()=>assert.equal(app.ref.current.selectConversation('b'),true));assert.equal(signal.aborted,true);
 await update(async()=>{response.resolve('Late');await task});
 assert.equal(app.ref.current.getAIChatConversation().id,'b');assert.equal(app.ref.current.getAIChat().conversations[0].messages.at(-1).status,'cancelled');assert.equal(app.ref.current.getAIChat().conversations[0].messages.at(-1).content,'');
});
test('unmount prevents stale provider callbacks and retained refs cannot mutate the session',async t=>{
 const pending=deferred();let changes=0;const app=await mount(t,{onSave(){},onChange(){changes++},onSend:()=>pending.promise});
 let task;await update(()=>{task=app.ref.current.send('Question')});await tick();const handle=app.ref.current;await app.unmount();const count=changes;pending.resolve('Late');await task;
 assert.equal(changes,count);assert.equal(await handle.execute({type:'aichat.update',title:'late'}),null);assert.equal(handle.getAIChat().title,'Test aichat');
});
test('selecting the current conversation preserves its unsent draft',async t=>{
 const app=await mount(t,{onSave(){}});await update(()=>app.renderer.root.findByProps({'aria-label':'メッセージを入力'}).props.onChange({target:{value:'Unsent draft'}}));
 await update(()=>app.ref.current.selectConversation('a'));assert.equal(app.renderer.root.findByProps({'aria-label':'メッセージを入力'}).props.value,'Unsent draft');
});
test('deleting or importing an effective target clears its private composer draft and dialogs',async t=>{
 const app=await mount(t,{onSave(){}});
 async function typeDraft(){await update(()=>app.renderer.root.findByProps({'aria-label':'メッセージを入力'}).props.onChange({target:{value:'Private draft for A'}}))}
 await typeDraft();await update(()=>app.ref.current.execute({type:'conversation.delete',conversationId:'a'}));
 assert.equal(app.ref.current.getAIChatConversation().id,'b');assert.equal(app.renderer.root.findByProps({'aria-label':'メッセージを入力'}).props.value,'');
 await update(()=>app.ref.current.importNative(JSON.stringify(seed())));await typeDraft();await update(()=>app.renderer.root.findByProps({'aria-label':'メッセージを編集'}).props.onClick());
 const replacement=createAIChat({id:'aichat',conversations:[{id:'a',title:'Replacement with reused IDs',messages:[]}]});
 await update(()=>app.ref.current.importNative(JSON.stringify(replacement)));assert.equal(app.renderer.root.findByProps({'aria-label':'メッセージを入力'}).props.value,'');assert.equal(app.renderer.root.findAllByProps({role:'dialog'}).length,0);
});
test('attachment capacity failures preserve all existing files and never silently truncate uploads',async t=>{
 let calls=0;const files=count=>Array.from({length:count},(_,index)=>({id:`file-${calls}-${index}`,name:`file ${calls}/${index}`,mediaType:'text/plain',size:1}));
 const app=await mount(t,{onSave(){},onAttachmentUpload(){calls++;return files(calls===1?99:2)}});
 const picker=()=>app.renderer.root.findAllByType('input').find(node=>node.props.type==='file'&&node.props.multiple);
 await update(()=>picker().props.onChange({target:{files:[{name:'first'}],value:'first'}}));await update(async()=>await tick());
 assert.equal(app.renderer.root.findAllByProps({className:'lxai-attachment'}).length,99);
 await update(()=>picker().props.onChange({target:{files:[{name:'second'},{name:'third'}],value:'many'}}));assert.equal(calls,1);
 await update(()=>picker().props.onChange({target:{files:[{name:'second'}],value:'one'}}));await update(async()=>await tick());assert.equal(calls,2);
 assert.equal(app.renderer.root.findAllByProps({className:'lxai-attachment'}).length,99);assert.equal(app.renderer.root.findAllByProps({role:'alert'}).length,1);
});
test('a stale file picker event with send disabled cannot invoke the upload host',async t=>{
 let calls=0;const app=await mount(t,{onSave(){},features:{send:false},onAttachmentUpload(){calls++;return[]}});
 const picker=app.renderer.root.findAllByType('input').find(node=>node.props.type==='file'&&node.props.multiple);
 await update(()=>picker.props.onChange({target:{files:[{name:'stale'}],value:'file'}}));assert.equal(calls,0);
});
test('effective selection callbacks follow deletion fallback and ignore observer exceptions',async t=>{
 const selections=[];const app=await mount(t,{onSave(){},onConversationChange(conversation){selections.push(conversation.id);throw new Error('observer')}});
 await update(()=>app.ref.current.execute({type:'conversation.delete',conversationId:'a'}));assert.deepEqual(selections,['b']);
 await update(()=>app.ref.current.selectConversation('b'));assert.deepEqual(selections,['b']);
});

test('dark UI and a bright primary color use contrasting button foregrounds',()=>{
 const html=renderToStaticMarkup(h(LikeAIChat,{initialAIChat:seed(),colorMode:'dark',primaryColor:'#fff'}));
 assert.match(html,/data-color-mode="dark"/);assert.match(html,/--lxai-primary:#ffffff/);assert.match(html,/--lxai-on-primary:#000000/);
});

test('external parts render in saved order with message context and no empty text placeholder',()=>{
 const aichat=structuredClone(seed());aichat.conversations[0].messages=[createAIChatMessage({id:'rich',role:'assistant',content:'',parts:[{id:'image',type:'host.image',data:{url:'/preview.svg',alt:'Preview'}},{id:'card',type:'host.card',data:{title:'Sales'}}]})];
 const contexts=[];
 const html=renderToStaticMarkup(h(LikeAIChat,{initialAIChat:aichat,partRenderers:{
  'host.image':(part,context)=>{contexts.push(context.message.id);return h('img',{src:part.data.url,alt:part.data.alt})},
  'host.card':(part,context)=>{contexts.push(context.message.id);return h('section',null,part.data.title)},
 }}));
 assert.ok(html.indexOf('alt="Preview"')<html.indexOf('<section>Sales</section>'));assert.deepEqual(contexts,['rich','rich']);
 assert.doesNotMatch(html,/空のメッセージ|応答を待っています|lxai-message-content/);
});

test('unknown part types retain escaped JSON and ignore inherited renderer properties',()=>{
 const aichat=structuredClone(seed());aichat.conversations[0].messages=[createAIChatMessage({id:'unknown',role:'assistant',content:'',parts:[{id:'part',type:'toString',data:{html:'<img src=x onerror=alert(1)>',nested:{ok:true}}}]})];
 const html=renderToStaticMarkup(h(LikeAIChat,{initialAIChat:aichat,partRenderers:{}}));
 assert.match(html,/lxai-part-fallback/);assert.match(html,/toString/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(html,/nested/);assert.doesNotMatch(html,/<img src=x/);
});

test('structured streams update the same tool part without duplicate rows or a waiting placeholder',async t=>{
 const finish=deferred();const app=await mount(t,{onSave(){},partRenderers:{'host.tool':part=>h('output',{'data-tool':part.id},part.data.status)},onSend:async function*(){yield {type:'part',part:{id:'call-1',type:'host.tool',data:{status:'running'}}};await finish.promise;yield {type:'part',part:{id:'call-1',type:'host.tool',data:{status:'complete'}}}}});
 let task;await update(()=>{task=app.ref.current.send('Run tool')});await update(async()=>await tick());
 assert.equal(app.renderer.root.findAllByType('output').length,1);assert.deepEqual(app.renderer.root.findByType('output').children,['running']);
 const assistant=app.renderer.root.findByProps({'aria-label':'アシスタントのメッセージ'});assert.equal(assistant.findAllByProps({className:'lxai-message-content'}).length,0);
 await update(async()=>{finish.resolve();await task});assert.equal(app.renderer.root.findAllByType('output').length,1);assert.deepEqual(app.renderer.root.findByType('output').children,['complete']);
});

test('a failing external renderer falls back to data without dropping neighboring parts',async t=>{
 const aichat=structuredClone(seed());aichat.conversations[0].messages=[createAIChatMessage({id:'failure',role:'assistant',content:'Still usable',parts:[{id:'bad',type:'host.bad',data:{preserved:true}},{id:'good',type:'host.good',data:null}]})];
 const app=await mount(t,{initialAIChat:aichat,partRenderers:{'host.bad':()=>{throw new Error('render failure')},'host.good':()=>h('mark',null,'Other part')}});
 assert.equal(app.renderer.root.findAllByProps({className:'lxai-part-fallback'}).length,1);assert.deepEqual(app.renderer.root.findByType('mark').children,['Other part']);assert.match(JSON.stringify(app.renderer.toJSON()),/preserved/);
});

test('an external component failure is isolated and corrected part data can render again',async t=>{
 t.mock.method(console,'error',()=>{});
 const aichat=structuredClone(seed());aichat.conversations[0].messages=[createAIChatMessage({id:'component',role:'assistant',content:'Parent remains',parts:[{id:'card',type:'host.component',data:false}]})];
 function Card({part}){if(!part.data)throw new Error('Child failed');return h('mark',null,'Recovered')}
 const app=await mount(t,{initialAIChat:aichat,onSave(){},partRenderers:{'host.component':part=>h(Card,{part})}});
 assert.equal(app.renderer.root.findAllByProps({className:'lxai-part-fallback'}).length,1);assert.ok(app.ref.current);
 await update(()=>app.ref.current.execute({type:'message.update',conversationId:'a',messageId:'component',patch:{parts:[{id:'card',type:'host.component',data:true}]}}));
 assert.equal(app.renderer.root.findAllByProps({className:'lxai-part-fallback'}).length,0);assert.deepEqual(app.renderer.root.findByType('mark').children,['Recovered']);
});
