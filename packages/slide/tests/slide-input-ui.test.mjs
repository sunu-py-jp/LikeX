import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { default as LikeSlide } from './src/slide.tsx';
  export { createSlideDeck } from './src/model/index.ts';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { LikeSlide, createSlideDeck } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };

for (const field of ['notes', 'name']) {
  for (const allowed of [false, true]) {
    test(`${field} shows model content after blur while asynchronous permission is ${allowed ? 'granted' : 'denied'}`, async t => {
      let resolve;
      const permission = new Promise(done => { resolve = done; });
      const initialDeck = createSlideDeck({ slides: [{ id: 'slide', name: 'Original name', notes: 'Original notes', background: '#ffffff', elements: [] }] });
      const ref = createRef();
      let renderer;
      await change(() => { renderer = create(h(LikeSlide, { ref, initialDeck, onSave() {}, onEditRequest: () => permission })); });
      t.after(() => change(() => renderer.unmount()));
      const control = () => field === 'notes' ? renderer.root.findByProps({ 'aria-label': '発表者ノート' }) :
        renderer.root.findAllByType('input').find(input => input.props.defaultValue !== undefined);
      const target = { value: `New ${field}` };
      await change(() => control().props.onBlur({ target }));
      assert.equal(target.value, `Original ${field}`, 'uncontrolled DOM cannot retain a value the model has not accepted');
      assert.equal(ref.current.getDeck().slides[0][field], `Original ${field}`);
      await change(() => resolve(allowed));
      assert.equal(ref.current.getDeck().slides[0][field], `${allowed ? 'New' : 'Original'} ${field}`);
      assert.equal(control().props.defaultValue, `${allowed ? 'New' : 'Original'} ${field}`);
    });
  }
}
