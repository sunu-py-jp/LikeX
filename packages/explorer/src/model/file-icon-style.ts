import { EXPLORER_VIDEO_MIME_TYPES } from "./preview-formats";

/** Presentation-only extension rules; file operations and previews do not use them. */
const excel = new Set(["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm", "xla", "xlam"]);
const word = new Set(["doc", "docx", "docm", "dot", "dotx", "dotm"]);
const powerpoint = new Set(["ppt", "pptx", "pptm", "pot", "potx", "potm", "pps", "ppsx", "ppsm"]);
const data = new Set(["json", "csv", "tsv", "xml", "yaml", "yml"]);
const fonts = new Set(["ttf", "otf", "woff", "woff2", "ttc", "eot"]);
const text = new Set(["txt", "md"]);
const archives = new Set(["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst", "lzh"]);
const video = new Set([...Object.keys(EXPLORER_VIDEO_MIME_TYPES).map(extension => extension.slice(1)), "3g2", "flv", "m2ts"]);
const audio = new Set(["mp3", "wav", "wave", "ogg", "oga", "flac", "m4a", "aac", "aif", "aiff", "opus", "wma", "amr", "mid", "midi", "weba"]);
const code = new Set([
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "py", "pyw", "rb", "php", "java", "c", "h", "cc", "cpp", "cxx", "hpp", "hxx", "cs",
  "go", "rs", "swift", "kt", "kts", "scala", "sc", "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd", "r", "jl", "lua", "pl", "pm",
  "sql", "html", "htm", "css", "scss", "sass", "less", "vue", "svelte", "dart", "ex", "exs", "erl", "hrl", "clj", "cljs", "cljc", "hs", "fs", "fsx", "vb", "vbs", "zig", "nix", "asm",
]);
const codeMime = /^(?:application|text)\/(?:x-)?(?:javascript|ecmascript|typescript|python(?:-code)?|ruby|php|httpd-php|java(?:-source)?|c|c\+\+|csharp|csrc|c\+\+src|go|rust|swift|kotlin|scala|shellscript|sh|perl|lua|sql)$/;

const palettes = {
  light: {
    excel: "#3e7359", pdf: "#a05d5d", blue: "#496f94", data: "#806794", powerpoint: "#946538",
    font: "#637182", archive: "#80694f", video: "#4f7180", audio: "#886477", code: "#646f91", neutral: "#7b8794", paper: "#ffffff",
  },
  dark: {
    excel: "#87af99", pdf: "#c89595", blue: "#8da9c4", data: "#b5a1cb", powerpoint: "#c8a07e",
    font: "#a0aab7", archive: "#c3ae92", video: "#93b0bc", audio: "#bfa0b2", code: "#a3accb", neutral: "#aeb8c5", paper: "#252525",
  },
} as const;

export type FileIconStyle = Readonly<{
  label: string;
  ink: string;
  paper: string;
}>;

export function fileIconStyle(extension: string, colorScheme: "light" | "dark" = "light", mime = ""): FileIconStyle {
  const key = extension.trim().normalize("NFC").toLowerCase();
  const mediaType = mime.split(";")[0].trim().toLowerCase();
  const palette = palettes[colorScheme];
  const ink = excel.has(key) || key === "spon" ? palette.excel
    : key === "pdf" ? palette.pdf
    : word.has(key) ? palette.blue
    : data.has(key) ? palette.data
    : powerpoint.has(key) || key === "slon" ? palette.powerpoint
    : fonts.has(key) ? palette.font
    : archives.has(key) ? palette.archive
    : text.has(key) ? palette.neutral
    : mediaType.startsWith("video/") ? palette.video
    : mediaType.startsWith("audio/") ? palette.audio
    : video.has(key) ? palette.video
    : audio.has(key) ? palette.audio
    : code.has(key) || codeMime.test(mediaType) ? palette.code
    : palette.neutral;
  return {
    label: key.toUpperCase(),
    ink,
    paper: palette.paper,
  };
}
