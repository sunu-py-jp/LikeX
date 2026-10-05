import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { libraryModule } from './modules.mjs';

/** Rewrite only the adapters documented for this module's source-copy installation. */
export async function rewriteSourceCopyAdapters(directory, module) {
  const changed = {};
  for (const [file, imported] of Object.entries(libraryModule(module).sourceCopyAdapters)) {
    const target = path.join(directory, file);
    // Every UI module has core.ts; the other adapters are optional by module.
    if (file !== 'core.ts' && !await access(target).then(() => true, () => false)) continue;
    await writeFile(target, `export * from ${JSON.stringify(imported)};\n`);
    changed[file] = imported;
  }
  return changed;
}
