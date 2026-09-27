import test from 'node:test';import assert from 'node:assert/strict';import {load,deferred,tick} from './helpers.mjs';
const {createAIChat,createAIChatSession,serializeAIChat}=await load();
const seed=()=>createAIChat({id:'aichat',conversations:[{id:'a',title:'A',messages:[]},{id:'b',title:'B',messages:[]}]});
const messages=session=>session.getAIChat().conversations[0].messages;
test('host send streams through shared history once, saves canonical response, works with edit disabled',async()=>{
 const seen=[];const session=createAIChatSession(seed(),{onSave(aichat){seen.push(aichat);return {...aichat,title:'Saved'}},features:{edit:false},onSend:async function*(request){assert.equal(request.messages.length,1);assert.equal(request.prompt.content,'Question');yield 'Hello';yield ' world';}});
 assert.equal(await session.send('a','Question'),true);assert.equal(messages(session)[1].content,'Hello world');assert.equal(messages(session)[1].status,'complete');
 assert.equal(await session.undo(),true);assert.equal(messages(session).length,0);assert.equal(session.getSnapshot().canUndo,false);
 await session.redo();assert.equal(await session.save(),true);assert.equal(session.getAIChat().title,'Saved');assert.equal(session.getSnapshot().dirty,false);assert.equal(seen.length,1);
});
test('read-only and disabled send do not call host or request permission',async()=>{
 for(const options of [{},{onSave(){},readOnly:true},{onSave(){},features:{send:false}}]){
  let calls=0;const session=createAIChatSession(seed(),{...options,onSend(){calls++;return 'bad'},onEditRequest(){calls++;return true}});
  assert.equal(await session.send('a','blocked'),false);assert.equal(messages(session).length,0);assert.equal(calls,0);
 }
});
test('permission rejection and pending permission cancellation cannot start a request',async()=>{
 let calls=0;const permission=deferred();const session=createAIChatSession(seed(),{onSave(){},onEditRequest:()=>permission.promise,onSend(){calls++;return 'bad'}});
 const request=session.send('a','blocked');await tick();session.cancel();permission.resolve(true);assert.equal(await request,false);assert.equal(calls,0);assert.equal(messages(session).length,0);
 session.configure({onSave(){},onEditRequest:()=>false});assert.equal(await session.send('a','denied'),false);assert.equal(messages(session).length,0);
});
test('cancel aborts a pending provider promise, stores cancelled status and ignores late response',async()=>{
 const response=deferred();let signal;const session=createAIChatSession(seed(),{onSave(){},onSend(_,context){signal=context.signal;return response.promise}});
 const request=session.send('a','Question');await tick();session.cancel();assert.equal(signal.aborted,true);assert.equal(messages(session)[1].status,'cancelled');const snapshot=serializeAIChat(session.getAIChat());
 response.resolve('Too late');assert.equal(await request,true);assert.equal(serializeAIChat(session.getAIChat()),snapshot);
});
test('cancelled iterator chunks do not overwrite a newer request or clear its active status',async()=>{
 const next=deferred();let count=0;const session=createAIChatSession(seed(),{onSave(){},onSend:async function*(){if(count++===0){yield 'first';await next.promise;yield 'late'}else yield 'second'}});
 const first=session.send('a','One');await tick();session.cancel();const second=session.send('a','Two');await second;next.resolve();await first;
 assert.deepEqual(messages(session).map(message=>message.content),['One','first','Two','second']);assert.equal(messages(session)[1].status,'cancelled');
});
test('retry replaces the assistant response without duplicating the prompt and sends only earlier context',async()=>{
 let calls=0;const session=createAIChatSession(seed(),{onSave(){},onSend(request){if(!calls++){throw new Error('Temporary failure')}assert.equal(request.retry,true);assert.equal(request.messages.length,1);return 'Recovered'}});
 await session.send('a','Question');const id=messages(session)[1].id;assert.equal(messages(session)[1].status,'error');assert.equal(await session.retry('a',id),true);assert.equal(messages(session).length,2);assert.equal(messages(session)[1].content,'Recovered');assert.equal(messages(session)[1].error,undefined);
});
test('feature revocation and disposal suppress stale chunks, host callbacks and uploads',async()=>{
 for(const mode of ['readonly','feature','dispose']){
  const pending=deferred();let changes=0;const initial={onSave(){},onChange(){changes++},onSend:()=>pending.promise};const session=createAIChatSession(seed(),initial);
  const request=session.send('a','Question');await tick();if(mode==='dispose')session.dispose();else session.configure({...initial,...(mode==='readonly'?{readOnly:true}:{features:{send:false}})});
  const count=changes,snapshot=serializeAIChat(session.getAIChat());pending.resolve('Late');await request;assert.equal(changes,count);assert.equal(serializeAIChat(session.getAIChat()),snapshot);
 }
 const upload=deferred();const session=createAIChatSession(seed(),{onSave(){}});const task=session.prepareAttachments(()=>upload.promise);await tick();session.cancel();upload.resolve([{id:'f',name:'file',size:2,mediaType:'text/plain'}]);assert.equal(await task,null);
});
test('invalid chunks preserve last valid text and mark error, observers cannot turn sends into failures',async()=>{
 const session=createAIChatSession(seed(),{onSave(){},onChange(){throw new Error('observer')},onSend:async function*(){yield 'safe';yield 42}});
 assert.equal(await session.send('a','Question'),true);assert.equal(messages(session)[1].content,'safe');assert.equal(messages(session)[1].status,'error');
});
test('retry can resume an imported empty interrupted response',async()=>{
 const aichat=createAIChat({id:'aichat',conversations:[{id:'a',title:'A',messages:[{id:'q',role:'user',content:'Question',createdAt:'2026-09-22T00:00:00Z',status:'complete'},{id:'r',role:'assistant',content:'',createdAt:'2026-09-22T00:00:00Z',status:'streaming',replyTo:'q'}]}]});
 const session=createAIChatSession(aichat,{onSave(){},onSend:()=>'Recovered'});assert.equal(await session.retry('a','r'),true);assert.equal(messages(session)[1].status,'complete');assert.equal(messages(session)[1].content,'Recovered');
});
test('cancellation completes promptly even when the host ignores abort for promises or iterator.next',async()=>{
 for(const response of [new Promise(()=>{}),{[Symbol.asyncIterator](){return{next:()=>new Promise(()=>{}),return:()=>new Promise(()=>{})}}}]){
  const session=createAIChatSession(seed(),{onSave(){},onSend:()=>response});const task=session.send('a','Question');await tick();session.cancel();
  assert.equal(await Promise.race([task,new Promise(resolve=>setTimeout(()=>resolve('timed-out'),100))]),true);assert.equal(session.getSnapshot().busy,null);assert.equal(messages(session)[1].status,'cancelled');
 }
});
test('a synchronous cancel before dispatch prevents provider invocation and prompt writes',async()=>{
 let calls=0;const session=createAIChatSession(seed(),{onSave(){},onSend(){calls++;return 'stale'}});
 const request=session.send('a','Old prompt');session.cancel();assert.equal(await request,false);assert.equal(calls,0);assert.equal(messages(session).length,0);
});
test('immediate replacement with the same conversation ID cannot receive a queued old prompt',async()=>{
 let calls=0;const session=createAIChatSession(seed(),{onSave(){},onSend(){calls++;return 'stale'}});
 const request=session.send('a','Old prompt');const replacement=createAIChat({id:'replacement',conversations:[{id:'a',title:'New target',messages:[]}]});
 await session.importNative(serializeAIChat(replacement));assert.equal(await request,false);assert.equal(calls,0);assert.equal(session.getAIChat().id,'replacement');assert.equal(messages(session).length,0);
});
test('attachment preparation rejects disabled send and releases an uncooperative upload on cancel',async()=>{
 const session=createAIChatSession(seed(),{onSave(){},features:{send:false}});let calls=0;assert.equal(await session.prepareAttachments(async()=>{calls++;return[]}),null);assert.equal(calls,0);
 session.configure({onSave(){}});const pending=session.prepareAttachments(()=>new Promise(()=>{}));await tick();session.cancel();assert.equal(await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('timed-out'),100))]),null);
});

test('structured text and part chunks use stable upserts, native persistence and one shared history entry',async()=>{
 const observed=[];const session=createAIChatSession(seed(),{onSave(){},features:{edit:false},onChange(aichat){observed.push(aichat)},onSend:async function*(){
  yield {type:'text',text:'Starting '};yield {type:'part',part:{id:'tool',type:'acme.tool',data:{status:'running',input:{commands:[{type:'sheet.add'}]}}}};
  yield {type:'part',part:{id:'image',type:'acme.image',data:{url:'https://example.com/chart.png'}}};
  yield {type:'part',part:{id:'tool',type:'acme.tool',data:{status:'complete',output:{changed:true}}}};yield 'done';
 }});
 assert.equal(await session.send('a','Create'),true);const response=messages(session)[1];
 assert.equal(response.content,'Starting done');assert.equal(response.status,'complete');assert.deepEqual(response.parts.map(part=>part.id),['tool','image']);assert.equal(response.parts[0].data.status,'complete');
 assert.ok(observed.some(aichat=>aichat.conversations[0].messages[1]?.parts?.[0]?.data.status==='running'));
 assert.deepEqual(JSON.parse(session.exportNative()).conversations[0].messages[1].parts,response.parts);
 await session.undo();assert.equal(messages(session).length,0);await session.redo();assert.deepEqual(messages(session)[1],response);
});

test('final structured responses persist parts, and retry clears earlier parts while pending',async()=>{
 const pending=deferred();let calls=0;
 const session=createAIChatSession(seed(),{onSave(){},onSend(){return calls++?pending.promise:{content:'Image',parts:[{id:'image',type:'acme.image',data:{url:'https://example.com/chart.png'}}]}}});
 await session.send('a','Chart');assert.equal(messages(session)[1].parts[0].type,'acme.image');
 const retry=session.retry('a',messages(session)[1].id);await tick();assert.equal(messages(session)[1].content,'');assert.deepEqual(messages(session)[1].parts,[]);
 pending.resolve({content:'Replaced',parts:[{id:'table',type:'acme.table',data:[[1,2],[3,4]]}]});await retry;assert.deepEqual(messages(session)[1].parts.map(part=>part.id),['table']);
});

test('invalid structured updates preserve committed text and parts and report a terminal error',async()=>{
 for(const bad of [{type:'part',part:{id:'tool',type:'acme.tool',data:{bad:undefined}}},{type:'text',text:42},{type:'text',text:'bad',extra:true},{type:'unknown'}]){
  const session=createAIChatSession(seed(),{onSave(){},onSend:async function*(){yield 'Safe';yield {type:'part',part:{id:'tool',type:'acme.tool',data:{status:'running'}}};yield bad}});
  await session.send('a','Run');assert.equal(messages(session)[1].content,'Safe');assert.equal(messages(session)[1].status,'error');assert.deepEqual(messages(session)[1].parts,[{id:'tool',type:'acme.tool',data:{status:'running'}}]);
 }
});

test('cancel retains the last valid part and ignores late structured chunks',async()=>{
 const pending=deferred();const session=createAIChatSession(seed(),{onSave(){},onSend:async function*(){yield {type:'part',part:{id:'tool',type:'acme.tool',data:{status:'running'}}};await pending.promise;yield {type:'part',part:{id:'tool',type:'acme.tool',data:{status:'complete'}}}}});
 const task=session.send('a','Run');await tick();session.cancel();const cancelled=serializeAIChat(session.getAIChat());
 assert.equal(messages(session)[1].status,'cancelled');assert.equal(messages(session)[1].parts[0].data.status,'running');pending.resolve();await task;assert.equal(serializeAIChat(session.getAIChat()),cancelled);
});
