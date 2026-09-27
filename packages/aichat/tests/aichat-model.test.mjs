import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './helpers.mjs';
const {createAIChat,createAIChatMessage,normalizeAIChat,normalizeAIChatContentPart,migrateLegacyAIChat,parseAIChat,serializeAIChat,executeAIChatCommands,getAIChatMessages,AICHAT_LIMITS} = await load();
const seed = () => createAIChat({id:'aichat',conversations:[{id:'a',title:'First',messages:[]}]});
const add = (id,content='Hello') => ({type:'message.add',conversationId:'a',message:{id,role:'user',content,createdAt:'2026-09-22T12:00:00.000Z'}});
test('models are immutable, stable and preserve IDs and timestamps across native roundtrip',()=>{
 const input=seed(), result=executeAIChatCommands(input,add('m1'));
 assert.equal(input.conversations[0].messages.length,0);assert.equal(result.aichat.conversations[0].messages[0].id,'m1');
 assert.equal(serializeAIChat(parseAIChat(serializeAIChat(result.aichat))),serializeAIChat(result.aichat));
 assert.throws(()=>{result.aichat.conversations[0].messages[0].content='mutated'},TypeError);
 assert.equal(executeAIChatCommands(result.aichat,{type:'aichat.update',title:result.aichat.title}).aichat,result.aichat);
});
test('batch failures leave the original model unchanged and validate dangling replies',()=>{
 const initial=seed();assert.throws(()=>executeAIChatCommands(initial,[add('one'),add('one')]),/unique/);assert.equal(getAIChatMessages(initial,'a').length,0);
 const aichat=executeAIChatCommands(initial,[add('user'),{type:'message.add',conversationId:'a',message:{id:'answer',role:'assistant',content:'Reply',replyTo:'user'}}]).aichat;
 assert.throws(()=>executeAIChatCommands(aichat,{type:'message.delete',conversationId:'a',messageId:'user'}),/earlier/);
 assert.equal(getAIChatMessages(executeAIChatCommands(aichat,{type:'message.delete',conversationId:'a',messageId:'user',cascadeReplies:true}).aichat,'a').length,0);
 assert.throws(()=>executeAIChatCommands(aichat,{type:'conversation.delete',conversationId:'a'}),/At least one/);
});
test('strict envelopes reject unknown fields, controls, invalid timestamps and unsafe metadata URLs',()=>{
 const raw=JSON.parse(serializeAIChat(seed()));assert.throws(()=>normalizeAIChat({...raw,version:2}),/version/);assert.throws(()=>normalizeAIChat({...raw,unknown:true}),/unsupported/);
 for(const url of ['javascript:alert(1)','data:text/plain,abc','https://u:p@example.com','file:///tmp/x'])assert.throws(()=>createAIChatMessage({role:'user',content:'x',attachments:[{id:'f',name:'file',size:2,mediaType:'text/plain',url}]}),/URL/);
 for(const createdAt of ['2026-02-30T12:00:00Z','tomorrow','2026-09-22T12:00:00+09:00'])assert.throws(()=>createAIChatMessage({role:'user',content:'x',createdAt}),/timestamp/i);
 assert.throws(()=>createAIChatMessage({role:'user',content:'\ud800'}),/surrogate/);
 assert.throws(()=>executeAIChatCommands(seed(),[...Array(1001)].map(()=>({type:'aichat.update',title:'x'}))),/1000/);
});
test('assistant response command cannot modify a user message; content is text only',()=>{
 const aichat=executeAIChatCommands(seed(),add('user','<script>alert(1)</script>')).aichat;
 assert.throws(()=>executeAIChatCommands(aichat,{type:'message.respond',conversationId:'a',messageId:'user',content:'edited',status:'complete'}),/assistant/);
 assert.equal(getAIChatMessages(aichat,'a')[0].content,'<script>alert(1)</script>');
});

test('legacy AI LikeChat files migrate only after strict structural validation',()=>{
 const original=executeAIChatCommands(seed(),[add('user'),{type:'message.add',conversationId:'a',message:{id:'answer',role:'assistant',content:'Reply',createdAt:'2026-09-22T12:00:01.000Z',replyTo:'user',references:[{id:'source',title:'Source',url:'https://example.com'}],toolCalls:[{id:'tool',name:'search',status:'complete'}]}}]).aichat;
 const legacy={...JSON.parse(serializeAIChat(original)),format:'likex.chat'};
 const source=JSON.stringify(legacy);
 const migrated=migrateLegacyAIChat(legacy);
 assert.deepEqual(migrated,original);
 assert.deepEqual(parseAIChat(source),original);
 assert.equal(JSON.stringify(legacy),source);
 assert.equal(JSON.parse(serializeAIChat(migrated)).format,'likex.aichat');
 assert.throws(()=>normalizeAIChat(legacy),/format or version/);
 assert.throws(()=>migrateLegacyAIChat(original),/format or version/);
 assert.throws(()=>parseAIChat(JSON.stringify({...legacy,version:2})),/format or version/);
 assert.throws(()=>parseAIChat(JSON.stringify({...legacy,members:[],spaces:[]})),/unsupported/);
 assert.throws(()=>parseAIChat(JSON.stringify({...legacy,conversations:[{id:'room',title:'People',messages:[{id:'human',senderId:'alice',content:'Hello',createdAt:'2026-09-22T12:00:00.000Z',status:'complete'}]}]})),/unsupported/);
 assert.throws(()=>parseAIChat(JSON.stringify({...legacy,conversations:[{...legacy.conversations[0],messages:[{...legacy.conversations[0].messages[1],replyTo:'missing'}]}]})),/earlier/);
 assert.throws(()=>migrateLegacyAIChat({...legacy,conversations:[{...legacy.conversations[0],messages:[{...legacy.conversations[0].messages[0],role:'member'}]}]}),/role/);
});

test('host-defined parts deep-copy JSON, preserve unknown types and order through native roundtrips and commands',()=>{
 const part={id:'tool-1',type:'acme.tool',data:{name:'apply',args:{commands:[{type:'sheet.add',name:'Sales'}]},result:null}};
 const message=createAIChatMessage({id:'answer',role:'assistant',content:'Created',parts:[part,{id:'image-1',type:'acme.image',data:{url:'https://example.com/image.png',alt:'Sales chart'}}]});
 part.data.args.commands[0].name='Mutated';assert.equal(message.parts[0].data.args.commands[0].name,'Sales');
 assert.throws(()=>message.parts[0].data.args.commands.push({}),TypeError);
 const original=executeAIChatCommands(seed(),{type:'message.add',conversationId:'a',message}).aichat;
 const restored=parseAIChat(serializeAIChat(original));assert.deepEqual(restored,original);assert.deepEqual(getAIChatMessages(restored,'a')[0].parts.map(part=>part.type),['acme.tool','acme.image']);
 const replied=executeAIChatCommands(original,{type:'message.respond',conversationId:'a',messageId:'answer',content:'Done',status:'complete'}).aichat;
 assert.deepEqual(getAIChatMessages(replied,'a')[0].parts,message.parts);
 const cleared=executeAIChatCommands(replied,{type:'message.update',conversationId:'a',messageId:'answer',patch:{parts:[]}}).aichat;
 assert.deepEqual(getAIChatMessages(cleared,'a')[0].parts,[]);
 assert.throws(()=>executeAIChatCommands(original,[{type:'message.update',conversationId:'a',messageId:'answer',patch:{content:'changed'}},{type:'message.respond',conversationId:'a',messageId:'answer',content:'bad',status:'complete',parts:[part,part]}]),/Duplicate/);
 assert.equal(getAIChatMessages(original,'a')[0].content,'Created');
 const special=normalizeAIChatContentPart({id:'special',type:'unknown',data:JSON.parse('{"__proto__":{"isAdmin":true},"constructor":"text"}')});
 assert.equal(Object.getPrototypeOf(special.data),Object.prototype);assert.equal(special.data.isAdmin,undefined);assert.equal(Object.hasOwn(special.data,'__proto__'),true);
});

test('content part validation rejects non-JSON values, cycles, accessors and unsafe container shapes without invoking getters',()=>{
 const cycle={};cycle.self=cycle;let accesses=0;const accessor={get secret(){accesses++;return 'bad'}};
 const arrayAccessor=[];Object.defineProperty(arrayAccessor,'0',{enumerable:true,get(){accesses++;return 'bad'}});
 const hidden={};Object.defineProperty(hidden,'hidden',{value:'lost'});const symbol={[Symbol('lost')]:'x'};
 for(const data of [undefined,NaN,Infinity,1n,()=>{},new Date(),new Map(),Object.create({inherited:true}),cycle,accessor,arrayAccessor,[,],Object.assign([],{extra:'lost'}),hidden,symbol]){
  assert.throws(()=>normalizeAIChatContentPart({id:'p',type:'acme.any',data}));
 }
 const parts=[];Object.defineProperty(parts,'0',{enumerable:true,get(){accesses++;return {id:'p',type:'x',data:null}}});
 assert.throws(()=>createAIChatMessage({role:'assistant',content:'',parts}),/accessors/);assert.equal(accesses,0);
 assert.throws(()=>normalizeAIChatContentPart({id:'p',type:'acme.any',data:null,extra:true}),/unsupported/);
});

test('content part structure and aggregate size budgets are enforced before saving',()=>{
 let deep=null;for(let i=0;i<=AICHAT_LIMITS.partDepth;i++)deep={nested:deep};
 assert.throws(()=>normalizeAIChatContentPart({id:'p',type:'x',data:deep}),/structure limit/);
 assert.throws(()=>normalizeAIChatContentPart({id:'p',type:'x',data:Array(AICHAT_LIMITS.partNodes).fill(null)}),/structure limit/);
 assert.throws(()=>normalizeAIChatContentPart({id:'p',type:'x',data:'x'.repeat(AICHAT_LIMITS.partDataLength)}),/size limit/);
 assert.throws(()=>createAIChatMessage({role:'assistant',content:'',parts:Array.from({length:AICHAT_LIMITS.parts+1},(_,id)=>({id:String(id),type:'x',data:null}))}),/100-item/);
 const part={type:'x',data:'x'.repeat(AICHAT_LIMITS.partDataLength-2)};
 assert.throws(()=>createAIChat({conversations:[{id:'a',title:'A',messages:[{id:'a1',role:'assistant',content:'',status:'complete',createdAt:'2026-09-22T12:00:00.000Z',parts:Array.from({length:9},(_,id)=>({...part,id:String(id)}))}]}]}),/total data limit/);
});
