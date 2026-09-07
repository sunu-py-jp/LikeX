import type { ExplorerEntry } from "@likex/explorer";

/** Display fixtures: browser Files for every default icon, not Office/font/archive templates. */
export function createExplorerIconSamples(): ExplorerEntry[] {
  const groups = [
    ["Excel", ["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm", "xla", "xlam"]],
    ["PDF", ["pdf"]],
    ["Word", ["doc", "docx", "docm", "dot", "dotx", "dotm"]],
    ["PowerPoint", ["ppt", "pptx", "pptm", "pot", "potx", "potm", "pps", "ppsx", "ppsm"]],
    ["データ", ["json", "csv", "tsv", "xml", "yaml", "yml"]],
    ["Font", ["ttf", "otf", "woff", "woff2", "ttc", "eot"]],
    ["その他", ["unknown"]],
  ] as const;
  const date = "2026-09-07T00:00:00.000Z";
  const names = [
    ...groups.flatMap(([group, extensions]) => extensions.map(extension => `${group}.${extension}`)),
    "README",
    "テキスト.txt", "テキスト.md",
    ...["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst", "lzh"].map(extension => `圧縮.${extension}`),
  ];
  return [
    { id: "sample-folder", parent: "root", name: "フォルダ", kind: "folder", extension: "", size: 0,
      mime: "", createdAt: date, updatedAt: date, favorite: 0, source: null },
    ...names.map((name, index): ExplorerEntry => {
      const file = new File([`Explorer icon sample: ${name}\n`], name, { type: "application/octet-stream" });
      return { id: `sample-file-${index + 1}`, parent: "root", name, kind: "file", size: file.size,
        mime: file.type, createdAt: date, updatedAt: date, favorite: 0, source: { kind: "local", file } };
    }),
  ];
}
