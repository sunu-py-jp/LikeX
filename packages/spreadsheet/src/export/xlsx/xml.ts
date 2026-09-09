/** All dynamic OOXML text and attributes pass through this XML 1.0 boundary. */
export function xml(value: string | number): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Excelに書き出す数値が正しくありません");
  const text = String(value);
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff)
      throw new Error("Excelに書き出せない制御文字が含まれています");
  }
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** SpreadsheetML interprets _xNNNN_ escapes; protect literal sequences and CRs. */
export function xlsxText(value: string): string {
  xml(value);
  return xml(value.replace(/_x[0-9a-f]{4}_/gi, match => `_x005F_${match.slice(1)}`).replaceAll("\r", "_x000D_"));
}

export type XlsxColor = { rgb: string; alpha: number };
const named: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", orange: "FFA500",
  gray: "808080", grey: "808080", silver: "C0C0C0", maroon: "800000", purple: "800080", fuchsia: "FF00FF", lime: "00FF00",
  olive: "808000", navy: "000080", teal: "008080", aqua: "00FFFF", cyan: "00FFFF", magenta: "FF00FF", pink: "FFC0CB",
  brown: "A52A2A", gold: "FFD700", violet: "EE82EE", indigo: "4B0082", coral: "FF7F50", tomato: "FF6347", rebeccapurple: "663399",
  darkblue: "00008B", darkgreen: "006400", darkred: "8B0000", darkgray: "A9A9A9", darkgrey: "A9A9A9", lightgray: "D3D3D3",
  lightgrey: "D3D3D3", lightblue: "ADD8E6", lightgreen: "90EE90", whitesmoke: "F5F5F5", transparent: "000000",
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const channel = (value: number) => Math.round(clamp(value) * 255).toString(16).padStart(2, "0").toUpperCase();
const numeric = (value: string, percentScale = 1) => value.endsWith("%") ? Number(value.slice(0, -1)) / 100 * percentScale : Number(value);

/** CSS colors are materialized as RGB. Unresolved theme values use the supplied fallback. */
export function xlsxColor(value: string | undefined, fallback = "000000"): XlsxColor {
  const source = value?.trim().toLowerCase() ?? "", defaultColor = /^[0-9a-f]{6}$/i.test(fallback) ? fallback.toUpperCase() : "000000";
  if (named[source]) return { rgb: named[source], alpha: source === "transparent" ? 0 : 1 };
  if (/^#[0-9a-f]{3,4}$/i.test(source)) {
    const hex = source.slice(1).split("").map(character => character.repeat(2)).join("");
    return { rgb: hex.slice(0, 6).toUpperCase(), alpha: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
  }
  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(source))
    return { rgb: source.slice(1, 7).toUpperCase(), alpha: source.length === 9 ? parseInt(source.slice(7), 16) / 255 : 1 };
  const match = /^(rgb|rgba|hsl|hsla|oklab|oklch)\(([\d.%+\-,/\s]+)\)$/.exec(source);
  if (!match) return { rgb: defaultColor, alpha: 1 };
  const values = match[2].trim().split(/[\s,/]+/), type = match[1];
  if (values.length < 3 || values.length > 4 || values.some(value => !Number.isFinite(numeric(value)))) return { rgb: defaultColor, alpha: 1 };
  const alpha = values[3] === undefined ? 1 : clamp(numeric(values[3]));
  let channels: number[];
  if (type.startsWith("rgb")) channels = values.slice(0, 3).map(value => numeric(value, 255) / 255);
  else if (type.startsWith("hsl")) {
    const hue = ((Number(values[0]) % 360) + 360) % 360 / 360, saturation = clamp(numeric(values[1])), lightness = clamp(numeric(values[2]));
    const f = (n: number) => { const k = (n + hue * 12) % 12; return lightness - saturation * Math.min(lightness, 1 - lightness) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    channels = [f(0), f(8), f(4)];
  } else {
    const lightness = numeric(values[0]), second = numeric(values[1], 0.4), third = numeric(values[2], 0.4);
    const a = type === "oklch" ? second * Math.cos(Number(values[2]) * Math.PI / 180) : second;
    const b = type === "oklch" ? second * Math.sin(Number(values[2]) * Math.PI / 180) : third;
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    channels = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
      .map(value => value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055);
  }
  return channels.every(Number.isFinite) ? { rgb: channels.map(channel).join(""), alpha } : { rgb: defaultColor, alpha: 1 };
}
