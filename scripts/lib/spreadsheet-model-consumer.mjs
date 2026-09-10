import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installedPackage } from './packages.mjs';
import { libraryModule } from './modules.mjs';
import { run } from './run.mjs';

/** Verify the model in a project that cannot resolve React or browser typings. */
export async function checkSpreadsheetModelConsumer({ installed, sourceDirectory }) {
  const { packageRoot } = libraryModule('spreadsheet');
  const consumer = await mkdtemp(path.join(tmpdir(), 'likex-spreadsheet-model-'));
  let passed = false;
  try {
    await writeFile(path.join(consumer, 'package.json'), '{"private":true,"type":"module"}');
    let imported;
    if (installed) {
      await mkdir(path.join(consumer, 'node_modules/@likex'), { recursive: true });
      await cp(installed, path.join(consumer, 'node_modules/@likex/spreadsheet'), { recursive: true });
      imported = '@likex/spreadsheet/model';
    } else {
      assert.ok(sourceDirectory, 'A copied source directory or installed tarball is required');
      const result = await build({ entryPoints: [path.join(sourceDirectory, 'model-entry.ts')],
        outfile: path.join(consumer, 'model.mjs'), bundle: true, format: 'esm', platform: 'neutral',
        packages: 'external', target: 'es2022', metafile: true });
      for (const output of Object.values(result.metafile.outputs)) assert.deepEqual(output.imports, []);
      assert.doesNotMatch(await readFile(path.join(consumer, 'model.mjs'), 'utf8'), /^['"]use client['"]/);
      imported = './model.mjs';
    }
    const fixtureDirectory = path.join(packageRoot, 'tests/fixtures/model-consumer');
    const runtime = (await readFile(path.join(fixtureDirectory, 'runtime.mjs.template'), 'utf8')).replaceAll('__MODEL_IMPORT__', imported);
    await writeFile(path.join(consumer, 'runtime.mjs'), runtime);
    const result = JSON.parse((await run(process.execPath, ['--conditions=react-server', 'runtime.mjs'], { cwd: consumer, capture: true })).trim());
    if (installed) {
      const types = (await readFile(path.join(fixtureDirectory, 'types.ts.template'), 'utf8')).replaceAll('__MODEL_IMPORT__', imported);
      await writeFile(path.join(consumer, 'types.ts'), types);
      await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        target: 'ES2022', lib: ['ES2022'], module: 'NodeNext', moduleResolution: 'NodeNext',
        types: [], strict: true, skipLibCheck: false, noEmit: true,
      }, files: ['types.ts'] }));
      const typescript = await installedPackage('typescript');
      await run(process.execPath, [path.join(typescript.directory, 'bin/tsc'), '-p', 'tsconfig.json'], { cwd: consumer, capture: true });
    }
    passed = true;
    return { ...result, ...(installed ? { typeResolution: 'NodeNext strict, ES2022 only, no React or DOM typings' } : {}) };
  } finally {
    if (passed) await rm(consumer, { recursive: true, force: true });
    else console.error(`Failed headless consumer retained for inspection: ${consumer}`);
  }
}
