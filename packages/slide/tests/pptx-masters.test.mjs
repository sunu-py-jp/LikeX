import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundle=await build({stdin:{contents:`export * from './src/model'; export {importSlidePptx} from './src/import/import-pptx';export {importSlidePptxMasters} from './src/import/pptx-masters';export {exportSlidePptx} from './src/export/export-pptx';export {openOfficePackage,officeXml,readOfficeRelationships} from './src/ooxml';export {createZipArchive} from './src/core';`,resolveDir:new URL('../',import.meta.url).pathname},bundle:true,write:false,platform:'node',format:'esm'});
const m=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=pptx-masters-test-bundle.js').toString('base64')}`);
const pptx=new Uint8Array(await readFile(new URL('fixtures/powerpoint-basic.pptx',import.meta.url)));
const potx=new Uint8Array(await readFile(new URL('fixtures/powerpoint-masters.potx',import.meta.url)));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=';
const text=(id,value)=>m.createSlideElement({id,type:'text',text:value,x:80,y:60,width:400,height:100,fontSize:32});
const shape=(id)=>m.createSlideElement({id,type:'shape',name:id,x:0,y:0,width:1280,height:18,fill:'#173f5f'});
const xml=(entries,path)=>new TextDecoder().decode(entries.get(path));
const put=(entries,path,value)=>entries.set(path,new TextEncoder().encode(value));
async function modify(input,change){const archive=await m.openOfficePackage(input),entries=new Map();for(const path of archive.paths)entries.set(path,await archive.read(path));change(entries);return m.createZipArchive([...entries].map(([path,content])=>({path,content:new Blob([content])})));}
function catalogDeck(){return m.createSlideDeck({masters:[{id:'brand',name:'Brand',background:'#123456',elements:[shape('brand-stripe')]},{id:'second',name:'Second',background:'#ffeedd',elements:[]}],layouts:[{id:'title',masterId:'brand',name:'Title',elements:[m.createSlideElement({id:'logo',type:'image',src:png,x:1100,y:30,width:80,height:40})],placeholders:[{id:'title-slot',kind:'title',element:text('title-prototype','Master title')}]},{id:'unused',masterId:'brand',name:'Unused image',background:'#bbccdd',showMasterShapes:false,elements:[],placeholders:[{id:'photo-slot',kind:'pic',element:m.createSlideElement({id:'photo-prototype',type:'image',src:png,width:160,height:80})}]},{id:'other',masterId:'second',name:'Other master',elements:[],placeholders:[]}],slides:[{id:'page',name:'Content',background:'#ffffff',notes:'',layoutId:'title',inheritBackground:true,elements:[{...text('actual-title','User title'),layoutPlaceholderId:'title-slot'}]}]});}

test('master-only PPTX import retains every registered unused layout',async()=>{const result=await m.importSlidePptxMasters(pptx);assert.equal(result.library.masters.length,1);assert.equal(result.library.layouts.length,11);assert.ok(Math.abs(result.library.width-1280)<0.001);assert.equal(result.library.height,720);assert.ok(result.library.layouts.some(l=>l.placeholders.some(p=>p.kind==='title')));assert.ok(result.diagnostics.some(d=>/テーマ/.test(d.message)));assert.ok(Object.isFrozen(result.library));});
test('zero-slide POTX is accepted for reusable masters and rejected only as a full deck',async()=>{const file=new File([potx],'template.potx');const result=await m.importSlidePptxMasters(file);assert.equal(result.library.layouts.length,11);assert.equal(result.library.masters[0].elements[0].name,'Brand stripe');await assert.rejects(m.importSlidePptx(file),/スライド数/);});
test('normal PPTX import stores local placeholders and inherited catalog decorations separately',async()=>{const withSlide=await modify(potx,entries=>{put(entries,'[Content_Types].xml',xml(entries,'[Content_Types].xml').replace('presentationml.template.main+xml','presentationml.presentation.main+xml'));put(entries,'ppt/presentation.xml',xml(entries,'ppt/presentation.xml').replace('<p:sldIdLst/>','<p:sldIdLst><p:sldId id="256" r:id="rId7"/></p:sldIdLst>'));});
 // The independent fixture's first slide relationship need not have a fixed rId.
 const archive=await m.openOfficePackage(withSlide),links=await m.readOfficeRelationships(archive,'ppt/presentation.xml');const first=[...links.values()].find(l=>l.type.endsWith('/slide'));
 const fixed=await modify(withSlide,entries=>put(entries,'ppt/presentation.xml',xml(entries,'ppt/presentation.xml').replace('r:id="rId7"/></p:sldIdLst>',`r:id="${first.id}"/></p:sldIdLst>`)));
 const result=await m.importSlidePptx(fixed),page=result.deck.slides[0];assert.equal(page.elements.length,2);assert.ok(page.elements.every(e=>e.layoutPlaceholderId));assert.ok(!page.elements.some(e=>e.name==='Brand stripe'));const appearance=m.resolveSlideAppearance(result.deck,page);assert.ok(appearance.inheritedElements.some(e=>e.name==='Brand stripe'));assert.equal(result.deck.layouts.length,11);});
test('exports real master/layout/slide references, unused layouts, embedded images and placeholder IDs',async()=>{const source=catalogDeck(),file=await m.exportSlidePptx(source),archive=await m.openOfficePackage(file);const presentation=m.officeXml.parseXml(await archive.read('ppt/presentation.xml'));
 assert.equal(m.officeXml.children(m.officeXml.child(presentation,'sldMasterIdLst'),'sldMasterId').length,2);assert.ok(archive.has('ppt/slideLayouts/slideLayout3.xml'));assert.equal(archive.paths.filter(p=>p.startsWith('ppt/media/')).length,1);
 const page=m.officeXml.parseXml(await archive.read('ppt/slides/slide1.xml'));assert.equal(m.officeXml.child(m.officeXml.child(page,'cSld'),'bg'),undefined);assert.ok((new TextDecoder().decode(await archive.read('ppt/slides/slide1.xml'))).includes('<p:ph type="title" idx="0"/>'));
 for(const path of ['ppt/presentation.xml','ppt/slideMasters/slideMaster1.xml','ppt/slideMasters/slideMaster2.xml','ppt/slideLayouts/slideLayout1.xml','ppt/slideLayouts/slideLayout2.xml','ppt/slideLayouts/slideLayout3.xml','ppt/slides/slide1.xml'])await m.readOfficeRelationships(archive,path);
 const imported=await m.importSlidePptx(file);assert.equal(imported.deck.masters.length,2);assert.equal(imported.deck.layouts.length,3);assert.equal(imported.deck.slides[0].elements.length,1);assert.equal(imported.deck.slides[0].elements[0].text,'User title');assert.ok(imported.deck.slides[0].elements[0].layoutPlaceholderId);assert.equal(m.resolveSlideAppearance(imported.deck,imported.deck.slides[0]).background,'#123456');assert.deepEqual(imported.warnings,[]);
 assert.equal(imported.deck.layouts.find(l=>l.name==='Unused image').placeholders[0].element.type,'image');});
test('slide-specific background/master visibility and a page without any layout survive together',async()=>{const source=catalogDeck();const deck=m.normalizeSlideDeck({...source,slides:[{...source.slides[0],inheritBackground:false,background:'#abcdef',showMasterShapes:false},{id:'plain',name:'Plain',background:'#ffffff',notes:'',elements:[]}]});const result=await m.importSlidePptx(await m.exportSlidePptx(deck));assert.equal(result.deck.slides[0].inheritBackground,false);assert.equal(result.deck.slides[0].showMasterShapes,false);assert.equal(result.deck.slides[0].background,'#abcdef');assert.equal(m.resolveSlideAppearance(result.deck,result.deck.slides[0]).inheritedElements.length,1);assert.equal(result.deck.layouts.length,4);});
test('bad master/layout cycles and duplicate registered layouts fail before returning a library',async()=>{const file=await m.exportSlidePptx(catalogDeck());const duplicate=await modify(file,entries=>put(entries,'ppt/slideMasters/slideMaster1.xml',xml(entries,'ppt/slideMasters/slideMaster1.xml').replace('</p:sldLayoutIdLst>','<p:sldLayoutId id="2147483699" r:id="rIdLayout1"/></p:sldLayoutIdLst>')));await assert.rejects(m.importSlidePptxMasters(duplicate),/参照/);
 const wrong=await modify(file,entries=>put(entries,'ppt/slideLayouts/_rels/slideLayout1.xml.rels',xml(entries,'ppt/slideLayouts/_rels/slideLayout1.xml.rels').replace('slideMaster1.xml','slideMaster2.xml')));await assert.rejects(m.importSlidePptxMasters(wrong),/一致/);});
test('template-only import shares macro rejection, abort and post-validation diagnostic callbacks',async()=>{const controller=new AbortController();controller.abort();await assert.rejects(m.importSlidePptxMasters(potx,{signal:controller.signal}),e=>e.name==='AbortError');await assert.rejects(m.importSlidePptxMasters(new File([potx],'template.potm')),/形式/);
 const macro=await modify(potx,entries=>put(entries,'[Content_Types].xml',xml(entries,'[Content_Types].xml').replace('presentationml.template.main+xml','ms-powerpoint.template.macroEnabled.main+xml')));await assert.rejects(m.importSlidePptxMasters(macro),/マクロ/);const seen=[];await assert.rejects(m.importSlidePptxMasters(potx,{onDiagnostic:d=>{seen.push(d);throw Error('consumer declined');}}),/consumer declined/);assert.equal(seen.length,1);});
test('SVG replacement is disclosed while the embedded raster fallback remains usable',async()=>{const file=await m.exportSlidePptx(catalogDeck());const changed=await modify(file,entries=>put(entries,'ppt/slideLayouts/slideLayout1.xml',xml(entries,'ppt/slideLayouts/slideLayout1.xml').replace('<a:blip r:embed="rIdImage2">','<a:blip r:embed="rIdImage2"><a:extLst><a:ext uri="svg"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rIdImage2"/></a:ext></a:extLst>')));const result=await m.importSlidePptxMasters(changed);assert.ok(result.diagnostics.some(d=>d.message.includes('SVG')&&d.sourcePart==='ppt/slideLayouts/slideLayout1.xml'));assert.equal(result.library.layouts[0].elements[0].type,'image');});

test('shape placeholder prototypes retain native geometry and slot references', async () => {
  const source = catalogDeck(), prototypes = [
    m.createSlideElement({ id: 'diamond-prototype', type: 'shape', shape: 'diamond', fill: '#abcdef', stroke: '#123456', width: 100, height: 80 }),
  ];
  const slots = prototypes.map((element, index) => ({ id: `native-slot-${index}`, kind: 'obj', element }));
  const deck = m.normalizeSlideDeck({ ...source, layouts: [{ ...source.layouts[0], placeholders: slots }, ...source.layouts.slice(1)],
    slides: [{ ...source.slides[0], elements: prototypes.map((element, index) => ({ ...element, id: `page-native-${index}`, layoutPlaceholderId: slots[index].id })) }] });
  const result = await m.importSlidePptx(await m.exportSlidePptx(deck));
  for (const elements of [result.deck.layouts[0].placeholders.map(slot => slot.element), result.deck.slides[0].elements]) {
    assert.equal(elements[0].type, 'shape'); assert.equal(elements[0].shape, 'diamond'); assert.equal(elements[0].stroke, '#123456');
  }
  assert.ok(result.deck.slides[0].elements.every(element => element.layoutPlaceholderId));
});

test('unsupported placeholder kinds produce an actionable conversion diagnostic', async () => {
  const source = catalogDeck();
  const deck = m.normalizeSlideDeck({ ...source, layouts: source.layouts.map((layout, index) => index ? layout : { ...layout, placeholders: layout.placeholders.map(slot => ({ ...slot, kind: 'custom-host-slot' })) }) });
  const diagnostics = []; const file = await m.exportSlidePptx(deck, { onDiagnostic: item => diagnostics.push(item) });
  assert.ok(diagnostics.some(item => item.code === 'content-approximated' && item.elementId === 'title-prototype' && /custom-host-slot/.test(item.message)));
  assert.equal((await m.importSlidePptxMasters(file)).library.layouts[0].placeholders[0].kind, 'obj');
});

test('registered master limit rejects before loading unbounded catalog parts', async () => {
  const file = await m.exportSlidePptx(catalogDeck());
  const masters = await modify(file, entries => put(entries, 'ppt/presentation.xml', xml(entries, 'ppt/presentation.xml').replace(/<p:sldMasterIdLst>.*?<\/p:sldMasterIdLst>/, `<p:sldMasterIdLst>${'<p:sldMasterId id="2147483648" r:id="rIdMaster1"/>'.repeat(101)}</p:sldMasterIdLst>`)));
  await assert.rejects(m.importSlidePptxMasters(masters), /マスターの数/);
});
