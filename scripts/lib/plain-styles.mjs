import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

/** Bundle standard local CSS imports; consumers do not need a Tailwind compiler. */
export async function bundlePlainStyles(entry) {
  const root = path.dirname(path.resolve(entry));
  const result = await build({ absWorkingDir: root, entryPoints: [path.resolve(entry)], bundle: true,
    write: false, minify: false, metafile: true, logLevel: 'silent' });
  for (const input of Object.keys(result.metafile.inputs)) {
    const resolved = path.resolve(root, input);
    assert.ok(resolved.startsWith(root + path.sep), `Stylesheet import leaves its source folder: ${input}`);
  }
  for (const output of Object.values(result.metafile.outputs)) for (const imported of output.imports)
    assert.ok(!imported.external, `Stylesheet has an external dependency: ${imported.path}`);
  assert.equal(result.outputFiles.length, 1, 'Component styles must produce a single stylesheet');
  return Buffer.from(result.outputFiles[0].contents).toString('utf8');
}
