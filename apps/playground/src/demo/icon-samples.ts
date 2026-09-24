import type { ExplorerEntry } from "@likex/explorer";

/** Display fixtures; LikeX files contain minimal JSON, binary formats are icon samples only. */
export function createExplorerIconSamples(): ExplorerEntry[] {
  const groups = [
    ["Excel", ["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm", "xla", "xlam"]],
    ["PDF", ["pdf"]],
    ["Word", ["doc", "docx", "docm", "dot", "dotx", "dotm"]],
    ["PowerPoint", ["ppt", "pptx", "pptm", "pot", "potx", "potm", "pps", "ppsx", "ppsm"]],
    ["LikeX", ["spon", "slon"]],
    ["データ", ["json", "csv", "tsv", "xml", "yaml", "yml"]],
    ["Font", ["ttf", "otf", "woff", "woff2", "ttc", "eot"]],
    ["動画", ["mp4", "webm", "mov", "mkv", "avi", "m4v", "wmv", "mpeg", "ogv", "3gp"]],
    ["音声", ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff", "mid"]],
    ["コード", ["js", "jsx", "ts", "tsx", "py", "rb", "java", "c", "cpp", "cs", "go", "rs", "php", "swift", "kt", "html", "css", "sql", "sh", "ps1"]],
    ["その他", ["unknown"]],
  ] as const;
  const date = "2026-09-07T00:00:00.000Z";
  const names = [
    ...groups.flatMap(([group, extensions]) => extensions.map(extension => `${group}.${extension}`)),
    "README",
    "テキスト.txt", "テキスト.md",
    "独自形式.customformat",
    ...["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst", "lzh"].map(extension => `圧縮.${extension}`),
  ];
  return [
    { id: "sample-folder", parent: "root", name: "フォルダ", kind: "folder", extension: "", size: 0,
      mime: "", createdAt: date, updatedAt: date, favorite: 0, source: null },
    ...names.map((name, index): ExplorerEntry => {
      const native = name.endsWith(".spon")
        ? { format: "likex.spreadsheet", schemaVersion: 1, sheets: [{ id: "sample-sheet", name: "Sheet1", rows: [], rowCount: 300, columnCount: 26 }] }
        : name.endsWith(".slon")
          ? { format: "likex.slide", version: 1, id: "sample-deck", title: "LikeX", width: 1280, height: 720,
            slides: [{ id: "sample-slide", name: "スライド1", background: "#ffffff", notes: "", elements: [] }] }
          : null;
      const file = new File([native ? JSON.stringify(native, null, 2) : `Explorer icon sample: ${name}\n`], name,
        { type: native ? "application/json" : "application/octet-stream" });
      return { id: `sample-file-${index + 1}`, parent: "root", name, kind: "file", size: file.size,
        mime: file.type, createdAt: date, updatedAt: date, favorite: 0, source: { kind: "local", file } };
    }),
  ];
}
