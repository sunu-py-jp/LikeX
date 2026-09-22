import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { explorerStyles } from "./build/explorer-styles.ts";
import { licenseInventory } from "./build/license-inventory.ts";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const coreSource = fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url));
const explorerSource = fileURLToPath(new URL("../../packages/explorer/src/index.ts", import.meta.url));
const spreadsheetSource = fileURLToPath(new URL("../../packages/spreadsheet/src/index.ts", import.meta.url));
const documentSource = fileURLToPath(new URL("../../packages/document/src/index.ts", import.meta.url));
const slideSource = fileURLToPath(new URL("../../packages/slide/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [explorerStyles(), react(), licenseInventory()],
  resolve: {
    // Develop the library directly without a separate dist build or watcher.
    alias: [
      { find: /^@likex\/board$/, replacement: fileURLToPath(new URL("../../packages/board/src/index.ts", import.meta.url)) },
      { find: /^@likex\/dataview$/, replacement: fileURLToPath(new URL("../../packages/dataview/src/index.ts", import.meta.url)) },
      { find: /^@likex\/diagram$/, replacement: fileURLToPath(new URL("../../packages/diagram/src/index.ts", import.meta.url)) },
      { find: /^@likex\/whiteboard$/, replacement: fileURLToPath(new URL("../../packages/whiteboard/src/index.ts", import.meta.url)) },
      { find: /^@likex\/calendar$/, replacement: fileURLToPath(new URL("../../packages/calendar/src/index.ts", import.meta.url)) },
      { find: /^@likex\/aichat$/, replacement: fileURLToPath(new URL("../../packages/aichat/src/index.ts", import.meta.url)) },
      { find: /^@likex\/chat$/, replacement: fileURLToPath(new URL("../../packages/chat/src/index.ts", import.meta.url)) },
      { find: /^@likex\/form$/, replacement: fileURLToPath(new URL("../../packages/form/src/index.ts", import.meta.url)) },

      { find: /^@likex\/core\/browser$/, replacement: fileURLToPath(new URL("../../packages/core/src/browser.ts", import.meta.url)) },
      { find: /^@likex\/core$/, replacement: coreSource },
      { find: /^@likex\/explorer$/, replacement: explorerSource },
      { find: /^@likex\/spreadsheet$/, replacement: spreadsheetSource },
      { find: /^@likex\/slide$/, replacement: slideSource },
      { find: /^@likex\/document$/, replacement: documentSource },
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
