import { packageRoot } from './test-paths.mjs';
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Bundle like the consuming Next/Tailwind application, without requiring .ts
// extensions or special TypeScript compiler settings in the reusable source.
export async function importTypeScript(path) {
  const result = await build({ absWorkingDir: packageRoot,
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
