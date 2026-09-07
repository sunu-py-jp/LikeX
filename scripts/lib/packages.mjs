import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read installed metadata even when the package does not export package.json. */
export async function installedPackage(name) {
  let directory = path.dirname(fileURLToPath(import.meta.resolve(name)));
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return { directory, manifest };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot find installed metadata for ${name}`);
    directory = parent;
  }
}
