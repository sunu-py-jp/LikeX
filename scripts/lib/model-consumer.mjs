import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installedPackage } from './packages.mjs';
import { libraryModule } from './modules.mjs';
import { run } from './run.mjs';

/** Verify a DOM-free runtime in a project without React. File-based models use DOM type declarations only. */
export async function checkModelConsumer({ module, installed, sourceDirectory }) {
  const { packageRoot, modelTypeLibraries = ['ES2022'], modelRuntimeDependencies = [] } = libraryModule(module);
  const consumer = await mkdtemp(path.join(tmpdir(), `likex-${module}-model-`));
  let passed = false;
  try {
    await writeFile(path.join(consumer, 'package.json'), '{"private":true,"type":"module"}');
    let imported;
    if (installed) {
      await mkdir(path.join(consumer, 'node_modules/@likex'), { recursive: true });
      await cp(installed, path.join(consumer, `node_modules/@likex/${module}`), { recursive: true });
      const core = path.join(path.dirname(installed), 'core');
      await cp(core, path.join(consumer, 'node_modules/@likex/core'), { recursive: true });
      imported = `@likex/${module}/model`;
    } else {
      assert.ok(sourceDirectory, 'A copied source directory or installed tarball is required');
      const result = await build({ entryPoints: [path.join(sourceDirectory, 'model-entry.ts')],
        outfile: path.join(consumer, 'model.mjs'), bundle: true, format: 'esm', platform: 'neutral',
        packages: 'external', target: 'es2022', metafile: true });
      for (const output of Object.values(result.metafile.outputs)) for (const imported of output.imports)
        assert.ok(modelRuntimeDependencies.includes(imported.path), `Unexpected model dependency: ${imported.path}`);
      assert.doesNotMatch(await readFile(path.join(consumer, 'model.mjs'), 'utf8'), /^['"]use client['"]/);
      imported = './model.mjs';
    }
    const copied = new Map();
    const copyDependency = async (name, from) => {
      const { directory, manifest } = await installedPackage(name, from);
      assert.ok(!/^react(?:-dom)?$/.test(name), 'Model dependencies must not load React');
      if (copied.has(name)) { assert.equal(copied.get(name), manifest.version, `Conflicting model dependency: ${name}`); return; }
      copied.set(name, manifest.version);
      const destination = path.join(consumer, 'node_modules', name);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(directory, destination, { recursive: true });
      for (const child of Object.keys(manifest.dependencies ?? {})) await copyDependency(child, directory);
    };
    // Copy the actual consumer's parser and transitives, never UI/React packages.
    for (const name of modelRuntimeDependencies) await copyDependency(name, installed ?? sourceDirectory);
    const fixtureDirectory = path.join(packageRoot, 'tests/fixtures/model-consumer');
    const runtime = (await readFile(path.join(fixtureDirectory, 'runtime.mjs.template'), 'utf8')).replaceAll('__MODEL_IMPORT__', imported);
    await writeFile(path.join(consumer, 'runtime.mjs'), runtime);
    const result = JSON.parse((await run(process.execPath, ['--conditions=react-server', 'runtime.mjs'], { cwd: consumer, capture: true })).trim());
    if (installed) {
      const types = (await readFile(path.join(fixtureDirectory, 'types.ts.template'), 'utf8')).replaceAll('__MODEL_IMPORT__', imported);
      await writeFile(path.join(consumer, 'types.ts'), types);
      await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        target: 'ES2022', lib: modelTypeLibraries, module: 'NodeNext', moduleResolution: 'NodeNext',
        types: [], strict: true, skipLibCheck: false, noEmit: true,
      }, files: ['types.ts'] }));
      const typescript = await installedPackage('typescript');
      await run(process.execPath, [path.join(typescript.directory, 'bin/tsc'), '-p', 'tsconfig.json'], { cwd: consumer, capture: true });
    }
    passed = true;
    return { ...result, ...(installed ? { typeResolution: `NodeNext strict, ${modelTypeLibraries.join(' + ')}, no React typings` } : {}) };
  } finally {
    if (passed) await rm(consumer, { recursive: true, force: true });
    else console.error(`Failed headless consumer retained for inspection: ${consumer}`);
  }
}
