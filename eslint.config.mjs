import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Keep established React/TypeScript rules without requiring a Next app.
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
  globalIgnores([
    "**/node_modules/**", "**/.next/**", "**/dist/**", "artifacts/**",
    "**/next-env.d.ts",
  ]),
]);
