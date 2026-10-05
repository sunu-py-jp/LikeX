import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/** Serve the same local PDF.js support files in development and built demos. */
export function pdfAssets(): Plugin {
  const root = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const files = new Map<string, string>();
  for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (entry.isFile()) files.set(`/pdfjs/${directory}/${entry.name}`, path.join(root, directory, entry.name));
    }
  }
  files.set("/pdfjs/LICENSE", path.join(root, "LICENSE"));
  return {
    name: "likex-pdf-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = files.get((request.url ?? "").split("?")[0]);
        if (!file) return next();
        response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [url, file] of files) this.emitFile({ type: "asset", fileName: url.slice(1), source: readFileSync(file) });
    },
  };
}
