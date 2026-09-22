import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'external-ui', setup(builder) { builder.onResolve({filter:/^@likex\/core\/browser$/},()=>({path:'context-menu',namespace:'menu-test'})); builder.onLoad({filter:/.*/,namespace:'menu-test'},()=>({contents:'export function openContextMenu(options){globalThis.__likexTestMenu=options;return()=>{options.closed=true;};}',loader:'js'}));  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { FormView, createForm } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sample = () => createForm({ title: 'Survey', fields: [{ id: 'name', type: 'text', label: 'Name', required: true }] });
async function mount(t, options = {}) { let view; const ref = createRef(); const render = props => h(StrictMode, null, h(FormView, { initialForm: sample(), ref, ...props })); await act(() => { view = create(render(options)); }); t.after(() => act(() => view.unmount())); return { ref, view, configure: props => act(() => view.update(render(props))) }; }
test('SSR supports a themed designer and independent response UI without DOM', () => {
 const design = renderToStaticMarkup(h(FormView, { initialForm: sample(), primaryColor: '#123456' })); assert.match(design, /data-likex-form/); assert.match(design, /--lxf-primary:#123456/);
 const fill = renderToStaticMarkup(h(FormView, { initialForm: sample(), mode: 'fill', onSubmit() {} })); assert.match(fill, /type="submit"/); assert.doesNotMatch(fill, /項目を追加/);
});
test('readonly omission, disabled features, permission and saved history share ref/UI paths', async t => {
 const { ref, configure } = await mount(t); await act(async () => assert.equal(await ref.current.execute({ type: 'form.update', patch: { title: 'No' } }), null));
 await configure({ onSave() {}, onEditRequest: () => false }); await act(() => ref.current.execute({ type: 'form.update', patch: { title: 'No' } })); assert.equal(ref.current.getForm().title, 'Survey');
 await configure({ onSave() {}, features: { fields: false } }); await act(async () => assert.equal(await ref.current.execute({ type: 'field.delete', fieldIds: ['name'] }), null));
 await act(() => ref.current.execute({ type: 'form.update', patch: { title: 'Updated' } })); await act(() => ref.current.save()); await act(() => ref.current.undo()); assert.equal(ref.current.getForm().title, 'Survey'); await act(() => ref.current.redo()); assert.equal(ref.current.getForm().title, 'Updated');
});
test('fill validates before sending, isolates definition, and awaits parent completion', async t => {
 const submissions = []; let resolve, signal; const { ref } = await mount(t, { mode: 'fill', onSave() {}, onSubmit(values, context) { signal = context.signal; submissions.push(values); return new Promise(done => { resolve = done; }); } });
 await act(async () => assert.equal(await ref.current.submit(), false)); assert.equal(submissions.length, 0);
 await act(() => ref.current.setAnswers({ name: 'Alex' })); let pending; await act(() => { pending = ref.current.submit(); }); assert.deepEqual(submissions, [{ name: 'Alex' }]); assert.equal(signal.aborted, false);
 await act(async () => assert.equal(await ref.current.execute({ type: 'form.update', patch: { title: 'Cannot edit' } }), null));
 await act(() => assert.equal(ref.current.setAnswers({ name: 'Later' }), false)); await act(async () => { resolve(); assert.equal(await pending, true); }); assert.equal(ref.current.getForm().title, 'Survey');
});
test('response cancellation and mode changes ignore stale asynchronous completion', async t => {
 let resolve, signal, complete = 0; const onSubmit = (_values, context) => { signal = context.signal; return new Promise(done => { resolve = done; }); };
 const { ref, configure } = await mount(t, { mode: 'fill', initialAnswers: { name: 'Alex' }, onSubmit, onSubmitComplete: () => complete++ });
 let pending; await act(() => { pending = ref.current.submit(); }); await configure({ mode: 'fill', readOnly: true, onSubmit }); assert.equal(signal.aborted, true);
 await act(async () => { resolve(); assert.equal(await pending, false); }); assert.equal(complete, 0);
});

test('answer observers cannot turn an accepted change into failure and readOnly remains enforced', async t => {
 const {ref,configure} = await mount(t,{mode:'fill',onAnswersChange(){throw new Error('observer');},onSubmit(){}});
 await act(()=>assert.equal(ref.current.setAnswers({name:'Accepted'}),true));
 assert.equal(ref.current.getAnswers().name,'Accepted');
 await configure({mode:'fill',readOnly:true,onSubmit(){}});
 await act(()=>assert.equal(ref.current.setAnswers({name:'Rejected'}),false));
 assert.equal(ref.current.getAnswers().name,'Accepted');
});
test('submit feature hides UI and rejects ref; disabling it cancels an in-flight response',async t=>{
 let complete,signal,requests=0,completed=0;
 const onSubmit=(_answers,context)=>{requests++;signal=context.signal;return new Promise(resolve=>{complete=resolve;});};
 const {ref,view,configure}=await mount(t,{mode:'fill',initialAnswers:{name:'Alex'},features:{submit:false},onSubmit});
 assert.equal(view.root.findAllByProps({type:'submit'}).length,0);
 await act(async()=>assert.equal(await ref.current.submit(),false));assert.equal(requests,0);
 await configure({mode:'fill',onSubmit,onSubmitComplete:()=>completed++});
 let pending;await act(()=>{pending=ref.current.submit();});assert.equal(requests,1);
 await configure({mode:'fill',onSubmit,features:{submit:false},onSubmitComplete:()=>completed++});assert.equal(signal.aborted,true);
 await act(async()=>{complete();assert.equal(await pending,false);});assert.equal(completed,0);
});
test('retained handles cannot submit or change answers after unmount',async()=>{
 const ref=createRef();let view,requests=0;
 await act(()=>{view=create(h(FormView,{ref,initialForm:sample(),mode:'fill',initialAnswers:{name:'Alex'},onSubmit(){requests++;}}));});
 const handle=ref.current;await act(()=>view.unmount());
 assert.equal(handle.setAnswers({name:'Later'}),false);assert.equal(await handle.submit(),false);assert.equal(requests,0);
});
test('designer buttons never implicitly submit an embedding form',()=>{
 const html=renderToStaticMarkup(h(FormView,{initialForm:sample(),onSave(){}}));
 assert.equal((html.match(/<button /g)||[]).length,(html.match(/<button type="button"/g)||[]).length);
});

test('colorMode supports dark and system while primary foreground follows contrast',async t=>{
 const html=renderToStaticMarkup(h(FormView,{initialForm:sample(),colorMode:'dark',theme:'light',primaryColor:'#fff'}));
 assert.match(html,/data-color-mode="dark"/);assert.match(html,/--lxf-primary:#ffffff/);assert.match(html,/--lxf-on-primary:#000000/);
 const oldWindow=globalThis.window;const media={matches:false,listener:null,addEventListener(_name,callback){this.listener=callback;},removeEventListener(){}};
 globalThis.window={matchMedia:()=>media};t.after(()=>{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;});
 const {view}=await mount(t,{colorMode:'system'});assert.equal(view.root.findByProps({'data-likex-form':''}).props['data-color-mode'],'light');
 await act(()=>{media.matches=true;media.listener();});assert.equal(view.root.findByProps({'data-likex-form':''}).props['data-color-mode'],'dark');
});

function contextEvent({ input = false, selected = false } = {}) {
 const target = { closest: () => input ? {} : null, ownerDocument: { getSelection: () => ({ isCollapsed: !selected }) } };
 return { target, currentTarget: target, clientX: 120, clientY: 80, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
}
const menuItem = id => globalThis.__likexTestMenu.items.find(item => item.id === id);

test('designer context duplication, insertion and deletion share permission and undo', async t => {
 let allowed = false; const { ref, view } = await mount(t, { onSave() {}, onEditRequest: () => allowed });
 const open = () => view.root.findByProps({ 'data-form-field-id': 'name' }).props.onContextMenu(contextEvent());
 await act(open); await act(() => menuItem('field.duplicate').onSelect()); assert.equal(ref.current.getForm().fields.length, 1);
 allowed = true; await act(open); await act(() => menuItem('field.duplicate').onSelect());
 const copy = ref.current.getForm().fields[1]; assert.notEqual(copy.id, 'name'); assert.equal(copy.required, true); assert.equal(copy.type, 'text');
 await act(() => ref.current.undo()); assert.equal(ref.current.getForm().fields.length, 1);
 await act(open); await act(() => menuItem('field.add.after').onSelect()); assert.equal(ref.current.getForm().fields.length, 2);
 await act(open); await act(() => menuItem('field.delete').onSelect()); assert.equal(ref.current.getForm().fields.some(field => field.id === 'name'), false);
 await act(() => ref.current.undo()); assert.equal(ref.current.getForm().fields[0].id, 'name');
});
test('form context menus hide unavailable features, preserve native text and do not appear in fill or preview', async t => {
 const { view, configure } = await mount(t, { onSave() {}, features: { reorder: false } });
 await act(() => view.root.findByProps({ 'data-form-field-id': 'name' }).props.onContextMenu(contextEvent())); assert.equal(menuItem('field.up'), undefined);
 for (const options of [{ input: true }, { selected: true }]) {
  globalThis.__likexTestMenu = null; const event = contextEvent(options);
  await act(() => view.root.findByProps({ 'data-form-field-id': 'name' }).props.onContextMenu(event)); assert.equal(event.defaultPrevented, false); assert.equal(globalThis.__likexTestMenu, null);
 }
 await configure({ onSave() {}, features: { fields: false, history: false } });
 globalThis.__likexTestMenu = null; await act(() => view.root.findByProps({ 'data-form-field-id': 'name' }).props.onContextMenu(contextEvent())); assert.equal(globalThis.__likexTestMenu, null);
 await configure({ onSave() {} }); const preview = view.root.findAllByType('button').find(node => [].concat(node.props.children).includes('プレビュー'));
 await act(() => preview.props.onClick()); globalThis.__likexTestMenu = null; await act(() => view.root.findByProps({ className: 'lxf-canvas' }).props.onContextMenu(contextEvent())); assert.equal(globalThis.__likexTestMenu, null);
 await configure({ mode: 'fill', onSubmit() {} }); globalThis.__likexTestMenu = null; await act(() => view.root.findByProps({ className: 'lxf-canvas' }).props.onContextMenu(contextEvent())); assert.equal(globalThis.__likexTestMenu, null);
});
test('form context actions reject stale definitions and readonly mutations', async t => {
 const { ref, view, configure } = await mount(t, { onSave() {} });
 await act(() => view.root.findByProps({ 'data-form-field-id': 'name' }).props.onContextMenu(contextEvent()));
 const stale = menuItem('field.delete'), oldMenu = globalThis.__likexTestMenu;
 await act(() => ref.current.execute({ type: 'field.update', fieldId: 'name', patch: { label: 'Changed' } }));
 assert.equal(oldMenu.closed, true); await act(() => stale.onSelect()); assert.equal(ref.current.getForm().fields[0].label, 'Changed');
 await configure({ readOnly: true, onSave() {} });
 await act(() => view.root.findByProps({ 'data-form-field-id': 'name' }).props.onContextMenu(contextEvent())); assert.equal(menuItem('field.delete').disabled, true);
});
