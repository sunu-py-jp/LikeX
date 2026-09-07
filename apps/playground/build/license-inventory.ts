import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

type PackageNotice = {
  name: string;
  version: string;
  license: string;
  notices: string[];
};

export function licenseInventory(): Plugin {
  return {
    name: "explorer-third-party-inventory",
    apply: "build",
    generateBundle(_options, bundle) {
      const packages = new Map<string, PackageNotice>();
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
          const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
          const key = `${pkg.name ?? name}@${pkg.version}`;
          if (packages.has(key)) continue;
          const notices = fs.readdirSync(root)
            .filter(file => /^(licen[sc]e|notice|copyright)([.-]|$)/i.test(file))
            .flatMap(file => {
              const full = path.join(root, file);
              return fs.statSync(full).isFile() ? [fs.readFileSync(full, "utf8")] : [];
            });
          packages.set(key, {
            name: pkg.name ?? name,
            version: pkg.version,
            license: typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? "unlisted"),
            notices,
          });
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
