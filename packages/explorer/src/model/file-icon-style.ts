/** Presentation-only extension rules; file operations and previews do not use them. */
const excel = new Set(["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm", "xla", "xlam"]);
const word = new Set(["doc", "docx", "docm", "dot", "dotx", "dotm"]);
const powerpoint = new Set(["ppt", "pptx", "pptm", "pot", "potx", "potm", "pps", "ppsx", "ppsm"]);
const data = new Set(["json", "csv", "tsv", "xml", "yaml", "yml"]);
const fonts = new Set(["ttf", "otf", "woff", "woff2", "ttc", "eot"]);
const text = new Set(["txt", "md"]);
const archives = new Set(["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst", "lzh"]);

const palettes = {
  light: {
    excel: "#3e7359", pdf: "#a05d5d", blue: "#496f94", data: "#806794", powerpoint: "#946538",
    font: "#637182", archive: "#80694f", neutral: "#7b8794", paper: "#ffffff",
  },
  dark: {
    excel: "#87af99", pdf: "#c89595", blue: "#8da9c4", data: "#b5a1cb", powerpoint: "#c8a07e",
    font: "#a0aab7", archive: "#c3ae92", neutral: "#aeb8c5", paper: "#252525",
  },
} as const;

export type FileIconStyle = Readonly<{
  label: string;
  ink: string;
  paper: string;
}>;

export function fileIconStyle(extension: string, colorScheme: "light" | "dark" = "light"): FileIconStyle {
  const key = extension.trim().normalize("NFC").toLowerCase();
  const palette = palettes[colorScheme];
  const ink = excel.has(key) ? palette.excel
    : key === "pdf" ? palette.pdf
    : word.has(key) ? palette.blue
    : data.has(key) ? palette.data
    : powerpoint.has(key) ? palette.powerpoint
    : fonts.has(key) ? palette.font
    : archives.has(key) ? palette.archive
    : text.has(key) ? palette.neutral : null;
  return {
    label: ink ? key.toUpperCase() : "",
    ink: ink ?? palette.neutral,
    paper: palette.paper,
  };
}
