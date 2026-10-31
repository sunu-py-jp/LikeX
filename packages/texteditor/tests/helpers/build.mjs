import { build as esbuild } from 'esbuild';

// Data-URL test bundles cannot supply Node's require to bundled CommonJS
// parsers. Keep these runtime imports external, as in the published library,
// and resolve them to file URLs so Node can load them from a data URL too.
export function build(options) {
  return esbuild({ ...options, plugins: [
    { name: 'source-parser-runtime', setup(builder) {
      builder.onResolve({ filter: /^(?:jsonc-parser|yaml)$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    } },
    ...(options.plugins ?? []),
  ] });
}
