import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { explorerStyles } from "./build/explorer-styles.ts";
import { licenseInventory } from "./build/license-inventory.ts";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const explorerSource = fileURLToPath(new URL("../../packages/explorer/src/index.ts", import.meta.url));
const spreadsheetSource = fileURLToPath(new URL("../../packages/spreadsheet/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [explorerStyles(), react(), licenseInventory()],
  resolve: {
    // Develop the library directly without a separate dist build or watcher.
    alias: [
      { find: /^@likex\/explorer$/, replacement: explorerSource },
      { find: /^@likex\/spreadsheet$/, replacement: spreadsheetSource },
    ],
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [workspaceRoot] },
    watch: {
      ignored: ["**/artifacts/**", "**/dist/**"],
      // The macOS sandbox cannot use FSEvents; polling keeps source HMR working.
      ...(process.env.CODEX_SANDBOX === "seatbelt" ? { useFsEvents: false, usePolling: true } : {}),
    },
  },
});
