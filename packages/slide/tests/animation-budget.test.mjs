import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Use a small budget to exercise aggregate boundaries without retaining a large model in CI.
const output = await build({ stdin: { contents: 'export * from "./src/model-entry"; export * from "./src/model/animation-budget";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'small-animation-budget', setup(build) { build.onLoad({ filter: /slide\/src\/model\/limits\.ts$/ }, async ({ path }) => ({ contents: (await readFile(path, 'utf8')).replace('animationExpandedNodes: 100_000', 'animationExpandedNodes: 20'), loader: 'ts' })); } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const tween = id => ({ type: 'tween', elementId: id, durationMs: 100, to: { x: 20 } });
const page = (id, count) => ({ id, name: id, background: '#fff', notes: '', elements: [m.createSlideElement({ type: 'shape', id: `${id}-target` })], animations: [{ id: 'step', animation: { type: 'sequence', children: Array.from({ length: count - 1 }, () => tween(`${id}-target`)) } }] });

test('animation resource accounting includes groups, shared occurrences and all pages', () => {
  const leaf = tween('target'), shared = { type: 'sequence', children: [leaf, leaf] };
  assert.equal(m.expandedAnimationNodes({ type: 'sequence', children: [shared, shared] }), 7);
  assert.equal(m.assertAnimationExpansion(5, 4), 20);
  assert.throws(() => m.assertAnimationExpansion(5, 5), /展開後/);
  assert.throws(() => m.expandedAnimationNodes(shared, 2), /展開後/);
  const first = page('first', 10), second = page('second', 10);
  assert.doesNotThrow(() => m.createSlideDeck({ slides: [first, second] }));
  assert.throws(() => m.createSlideDeck({ slides: [first, page('second', 11)] }), /展開後/);
  let graph = leaf;
  for (let index = 0; index < 8; index++) graph = { type: 'sequence', children: [graph, graph] };
  assert.throws(() => m.createSlideDeck({ slides: [{ ...page('target', 2), elements: [m.createSlideElement({ type: 'shape', id: 'target' })], animations: [{ id: 'step', animation: graph }] }] }), /展開後/);
});
