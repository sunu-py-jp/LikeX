import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { assertPermissiveLicense, readPackageNotice, resolvePackageDirectory, type PackageNotice } from "../../../scripts/lib/licenses.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

export function licenseInventory(): Plugin {
  return {
    name: "likex-license-inventory",
    apply: "build",
    generateBundle(_options, bundle) {
      const packages = new Map<string, PackageNotice>();
      const checkedRoots = new Set<string>();
      const include = (root: string) => {
        if (checkedRoots.has(root)) return;
        const entry = assertPermissiveLicense(readPackageNotice(root));
        const key = `${entry.name}@${entry.version}`;
        const previous = packages.get(key);
        if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
          throw new Error(`Conflicting bundled license notices for ${key}`);
        packages.set(key, entry);
        checkedRoots.add(root);
      };
      // CSS is not a rendered JS module. Retain its notice even after minification.
      include(resolvePackageDirectory("tailwindcss", workspaceRoot));
      // LikeX's own MIT text is also part of the standalone demo distribution.
      include(path.join(workspaceRoot, "apps/playground"));
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (!module.renderedLength) continue;
          const normalized = id.replaceAll("\\", "/").split("?")[0];
          const position = normalized.lastIndexOf("/node_modules/");
          if (position < 0) continue;
          const tail = normalized.slice(position + 14).split("/");
          const name = tail[0].startsWith("@") ? tail.slice(0, 2).join("/") : tail[0];
          const root = normalized.slice(0, position + 14) + name;
          if (!fs.existsSync(path.join(root, "package.json"))) continue;
          include(root);
        }
      }
      const list = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
      this.emitFile({
        type: "asset",
        fileName: "third-party-inventory.json",
        source: JSON.stringify(list.map(({ name, version, license }) => ({ name, version, license })), null, 2),
      });
      this.emitFile({
        type: "asset",
        fileName: "third-party-notices.txt",
        source: list.map(pkg => `${pkg.name}@${pkg.version}\nLicense: ${pkg.license}\n\n${pkg.notices.join("\n\n")}`)
          .join("\n\n========================================\n\n"),
      });
    },
  };
}
