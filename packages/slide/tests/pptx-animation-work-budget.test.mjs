import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Small budgets expose cumulative work without spending seconds on hostile input.
const output = await build({ stdin: { contents: 'export {createSlideElement} from "./src/model-entry"; export {officeXml} from "./src/ooxml"; export {readSlideAnimations} from "./src/import/pptx-animations";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'small-animation-work-budget', setup(build) { build.onLoad({ filter: /slide\/src\/model\/limits\.ts$/ }, async ({ path }) => ({ contents: (await readFile(path, 'utf8')).replace('animationExpandedNodes: 100_000', 'animationExpandedNodes: 40').replace('animationImportWork: 10_000_000', 'animationImportWork: 200'), loader: 'ts' })); } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const anim = (id, prop, from, to, { duration = 1000, repeat = 1, delay = 0 } = {}) => `<p:anim calcmode="lin" valueType="num" from="${from}" to="${to}"><p:cBhvr><p:cTn id="${id}" dur="${duration}" repeatCount="${repeat * 1000}" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="2"/></p:tgtEl><p:attrNameLst><p:attrName>${prop}</p:attrName></p:attrNameLst></p:cBhvr></p:anim>`;
const group = body => `<p:par><p:cTn id="3" fill="hold"><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par>`;
async function read(body, context = {}) {
  const diagnostics = [];
  context.warn = (message, diagnostic) => diagnostics.push({ message, ...diagnostic });
  const root = m.officeXml.parseXml(new TextEncoder().encode(`<p:timing><p:tnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn></p:seq></p:tnLst></p:timing>`));
  const element = m.createSlideElement({ id: 'target', type: 'shape', x: 100, y: 80, width: 200, height: 100 });
  const steps = await m.readSlideAnimations(root, { context, theme: { colors: {}, majorFont: 'Arial', minorFont: 'Arial' }, mapping: {}, targets: new Map([['2', element]]), width: 1000, height: 600, pageNumber: 1 });
  return { steps, diagnostics, context };
}

test('parallel coalescing and conflict comparisons consume a shared conversion budget', async () => {
  const many = Array.from({ length: 25 }, (_, index) => anim(10 + index, 'style.opacity', 1, .5, { duration: 1, delay: index })).join('');
  const { diagnostics, context } = await read(group(many));
  assert.ok(diagnostics.some(item => item.code === 'animation-limit' && /処理量/.test(item.message)));
  assert.equal(context.totalAnimationWork, 200);
  const nextPage = await read(group(anim(10, 'r', 0, 90)), context);
  assert.ok(nextPage.diagnostics.some(item => item.code === 'animation-limit'));
});

test('center and size samples are accumulated across all contributing entries', async () => {
  // Each contributor needs 22 samples, within 40; together they exceed it.
  const { diagnostics } = await read(group(anim(10, 'ppt_x', .2, .4, { repeat: 10 }) + anim(11, 'ppt_w', .2, .4, { repeat: 10, duration: 999 })));
  assert.ok(diagnostics.some(item => item.code === 'animation-limit' && /展開後/.test(item.message)));
});

test('ordinary effects still import within the conversion budget', async () => {
  const { steps, diagnostics } = await read(group(anim(10, 'r', 0, 90) + anim(11, 'style.opacity', 1, .5)));
  assert.equal(steps.length, 1);
  assert.deepEqual(diagnostics, []);
});
