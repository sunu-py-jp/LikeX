import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../../..", import.meta.url));
const source = path.join(repository, "packages/explorer/src");
const input = path.join(repository, "packages/explorer/styles");

/** Build generated CSS from its source before serving and after source edits. */
export function explorerStyles(): Plugin {
  let pending = Promise.resolve();
  const generate = () => {
    pending = pending.catch(() => {}).then(async () => {
      await exec(process.execPath, [path.join(repository, "scripts/build-styles.mjs")], {
        cwd: repository,
        timeout: 60_000,
      });
    });
    return pending;
  };
  return {
    name: "likex-explorer-styles",
    buildStart: generate,
    async handleHotUpdate({ file }) {
      if ((file.startsWith(source + path.sep) && /\.tsx?$/.test(file)) ||
          (file.startsWith(input + path.sep) && file.endsWith(".css"))) await generate();
    },
  };
}
