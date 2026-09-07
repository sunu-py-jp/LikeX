import { build } from 'esbuild';
import { projectRoot } from './lib/run.mjs';

const output = await build({ stdin: { contents: `
  export * from './packages/explorer/src/model/draft.ts';
  export * from './packages/explorer/src/model/item-info.ts';
  export * from './packages/explorer/src/model/text.ts';
`, resolveDir: projectRoot, sourcefile: 'explorer-benchmark.ts' },
bundle: true, platform: 'node', format: 'esm', write: false });
const { createDraftSnapshot, applyAction, hasChanges, describeEntries, naturalNameOrder } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const median = operation => {
  operation();
  const times = Array.from({ length: 5 }, () => { const start = performance.now(); operation(); return performance.now() - start; });
  return +times.sort((a, b) => a - b)[2].toFixed(3);
};
console.log('Node warm median in milliseconds; excludes React/DOM, storage and network.');
for (const count of [100, 1000, 5000]) {
  const snapshot = createDraftSnapshot(Array.from({ length: count }, (_, id) => ({
    id: `file-${id}`, parent: 'root', name: `file-${id * 73 % count}.txt`, kind: 'file', size: 10,
    mime: 'text/plain', createdAt: '2026-09-06', updatedAt: '2026-09-06', favorite: 0,
    source: { kind: 'existing', id: `body-${id}` },
  })));
  const changed = applyAction(snapshot, { action: 'rename', ids: ['file-0'], name: 'changed.txt' });
  console.log(JSON.stringify({ count,
    fullEventDescriptions: median(() => describeEntries(snapshot.entries)),
    dirty: median(() => hasChanges(snapshot, changed)),
    rename: median(() => applyAction(snapshot, { action: 'rename', ids: ['file-0'], name: 'changed.txt' })),
    sort: median(() => [...snapshot.entries].sort((a, b) => naturalNameOrder.compare(a.name, b.name))),
  }));
}
