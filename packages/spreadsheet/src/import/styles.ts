import type { SpreadsheetCellFormat } from "../model/types";
import type { SpreadsheetCellBorders, SpreadsheetCellBorder } from "../model/formatting/types";
import { normalizeCellFormat } from "../model/formatting/normalize";
import type { ImportContext } from "./types";
import { child, children, localName, parseXml, type XmlNode } from "./xml";
import type { XlsxRelationship } from "./relationships";

const defaultTheme = ["#FFFFFF", "#000000", "#EEECE1", "#1F497D", "#4F81BD", "#C0504D", "#9BBB59", "#8064A2", "#4BACC6", "#F79646", "#0000FF", "#800080"];
const indexed = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080", "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF", "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF", "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99", "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696", "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333"];
export function styleColor(node: XmlNode | undefined, context: ImportContext): string | undefined {
  if (!node) return;
  const { rgb, theme, indexed: index, tint } = node.attributes;
  let color = rgb && /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(rgb) ? `#${rgb.slice(-6).toUpperCase()}` : theme !== undefined ? (context.themeColors ?? defaultTheme)[Number(theme)] : index !== undefined && indexed[Number(index)] ? `#${indexed[Number(index)]}` : undefined;
  if (color && tint !== undefined) {
    const amount = Number(tint);
    if (Number.isFinite(amount) && amount >= -1 && amount <= 1) color = `#${color.slice(1).match(/../g)!.map(value => {
      const n = parseInt(value, 16); return Math.round(amount < 0 ? n * (1 + amount) : n * (1 - amount) + 255 * amount).toString(16).padStart(2, "0"); }).join("").toUpperCase()}`;
    if (amount) context.warn({ code: "adjusted", message: "テーマ色の濃淡をRGB色へ近似しました" });
  }
  return color;
}
const builtins: Record<number, string> = { 0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 5: '"$"#,##0', 6: '"$"#,##0;[Red]("$"#,##0)', 7: '"$"#,##0.00', 8: '"$"#,##0.00;[Red]("$"#,##0.00)', 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm", 37: "#,##0;(#,##0)", 38: "#,##0;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@" };
function numberFormat(id: number, custom: Map<number, string>, context: ImportContext): SpreadsheetCellFormat {
  const code = custom.get(id) ?? builtins[id] ?? (id >= 27 && id <= 36 || id >= 50 && id <= 58 ? "yyyy/mm/dd" : undefined);
  if (code === undefined) { context.warn({ code: "adjusted", message: "未対応の数値書式を標準表示へ変更しました" }); return {}; }
  if (code.toLowerCase() === "general") return {};
  if (/^General;/i.test(code)) {
    const red = /\[red\]/i.test(code), parentheses = code.split(";")[1]?.includes("(");
    return red || parentheses ? { negativeFormat: red ? parentheses ? "red-parentheses" : "red" : "parentheses" } : {};
  }
  if (code === "@") return { numberFormat: "text" };
  const cleaned = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "").toLowerCase();
  const date = /[yd]/.test(cleaned), time = /[hs]/.test(cleaned) || /\[[hms]\]/i.test(code);
  if (date || time || /m/.test(cleaned)) {
    if (code !== "yyyy/mm/dd" && code !== "hh:mm:ss" && code !== "yyyy/mm/dd hh:mm:ss") context.warn({ code: "adjusted", message: "日付・時刻の表示書式をLikeXの書式へ変更しました" });
    return { numberFormat: date && time ? "datetime" : time ? "time" : "date" };
  }
  if (!/[0#]/.test(cleaned) || /[?Ee]|\[[<>=]/.test(code)) { context.warn({ code: "adjusted", message: "未対応の数値書式を標準表示へ変更しました" }); return {}; }
  const currency = /[$¥￥€£]|\[\$/.test(code), places = /\.([0#]+)/.exec(cleaned)?.[1];
  if (currency && /[$€£]/.test(code.replace(/\[\$-?\w+\]/g, ""))) context.warn({ code: "adjusted", message: "通貨の表示記号を円へ変更しました" });
  if (code.split(";").length > 2 || /\[[<>=]/.test(code) || /"[^"¥￥$€£]+"/.test(code)) context.warn({ code: "adjusted", message: "独自の数値書式を対応する書式へ近似しました" });
  const negative = /\[red\]/i.test(code), parentheses = code.split(";")[1]?.includes("(");
  return { numberFormat: currency ? "currency" : cleaned.includes("%") ? "percent" : "number", useGrouping: cleaned.includes(","),
    ...(places && /^0+$/.test(places) ? { decimalPlaces: Math.min(places.length, 10) } : places ? {} : { decimalPlaces: 0 }),
    ...(negative || parentheses ? { negativeFormat: negative ? parentheses ? "red-parentheses" : "red" : "parentheses" } : {}) };
}
const enabled = (node: XmlNode | undefined): boolean => !!node && !["0", "false", "none"].includes(node.attributes.val ?? "");
function fontFormat(node: XmlNode | undefined, context: ImportContext): SpreadsheetCellFormat {
  if (!node) return {};
  const result: SpreadsheetCellFormat = {};
  for (const [name, key] of [["b", "bold"], ["i", "italic"], ["u", "underline"]] as const) if (child(node, name)) result[key] = enabled(child(node, name));
  const name = child(node, "name")?.attributes.val, size = Number(child(node, "sz")?.attributes.val);
  if (name && name.length <= 100 && !/[;{}<>\u0000-\u001f]/.test(name)) result.fontFamily = name;
  if (Number.isFinite(size) && size > 0) { result.fontSize = Math.max(1, Math.min(200, size / 0.75)); if (result.fontSize !== size / 0.75) context.warn({ code: "adjusted", message: "文字サイズを対応範囲へ調整しました" }); }
  const color = styleColor(child(node, "color"), context); if (color) result.color = color;
  if (child(node, "strike") || child(node, "vertAlign") || child(node, "outline") || child(node, "shadow")) context.warn({ code: "omitted", message: "取り消し線・上付きなど未対応の文字装飾を省略しました" });
  return result;
}
function borderFormat(node: XmlNode | undefined, context: ImportContext): SpreadsheetCellBorders | undefined {
  if (!node) return;
  const result: Partial<Record<"top" | "right" | "bottom" | "left", SpreadsheetCellBorder>> = {};
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const item = child(node, edge), style = item?.attributes.style;
    if (!style || style === "none") continue;
    const supported = ["thin", "medium", "thick", "double", "dashed", "mediumDashed", "dotted", "hair"].includes(style);
    if (!supported) context.warn({ code: "adjusted", message: "未対応の罫線を破線へ近似しました" });
    result[edge] = { style: style === "double" ? "double" : style === "dotted" || style === "hair" ? "dotted" : /dash/i.test(style) || !supported ? "dashed" : "solid",
      width: style === "thick" ? 3 : style.startsWith("medium") ? 2 : 1, color: styleColor(child(item, "color"), context) ?? "#000000" };
  }
  if (child(node, "diagonal")?.attributes.style || enabled({ ...node, attributes: { val: node.attributes.diagonalUp ?? node.attributes.diagonalDown ?? "0" } })) context.warn({ code: "omitted", message: "斜め罫線を省略しました" });
  return Object.keys(result).length ? result : undefined;
}
export async function readXlsxStyles(relationships: ReadonlyMap<string, XlsxRelationship>, context: ImportContext): Promise<readonly (SpreadsheetCellFormat | undefined)[]> {
  const theme = [...relationships.values()].find(item => item.type.endsWith("/theme") && !item.external);
  if (theme) {
    const root = parseXml(await context.archive.read(theme.target)), scheme = child(child(root, "themeElements"), "clrScheme");
    const keys = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
    context.themeColors = keys.map((key, index) => {
      const color = child(scheme, key)?.children[0], value = color?.attributes.lastClr ?? color?.attributes.val;
      return value && /^[a-f0-9]{6}$/i.test(value) ? `#${value.toUpperCase()}` : defaultTheme[index];
    });
  }
  const relation = [...relationships.values()].find(item => item.type.endsWith("/styles") && !item.external);
  if (!relation) return [undefined];
  const root = parseXml(await context.archive.read(relation.target));
  if (localName(root.name) !== "styleSheet") throw new Error("Excelのセル書式が不正です");
  const fonts = children(child(root, "fonts"), "font"), fills = children(child(root, "fills"), "fill"), borders = children(child(root, "borders"), "border");
  const formats = new Map(children(child(root, "numFmts"), "numFmt").map(node => [Number(node.attributes.numFmtId), node.attributes.formatCode]));
  const base = children(child(root, "cellStyleXfs"), "xf");
  const styles = children(child(root, "cellXfs"), "xf");
  if (styles.length > 65_490) throw new Error("Excelのセル書式数が上限を超えています");
  // Shared style components are parsed once; hostile repeated references cannot multiply XML scans.
  const parsedFonts = fonts.map(font => fontFormat(font, context));
  const parsedBorders = borders.map(border => borderFormat(border, context));
  const parsedFills = fills.map(fill => {
    const pattern = child(fill, "patternFill"), color = styleColor(child(pattern, "fgColor"), context);
    if (pattern?.attributes.patternType === "solid" && color) return color;
    if (child(fill, "gradientFill") || pattern && ![undefined, "none", "gray125"].includes(pattern.attributes.patternType)) context.warn({ code: "omitted", message: "グラデーション・模様の塗りつぶしを省略しました" });
    return undefined;
  });
  const numberFormats = new Map<number, SpreadsheetCellFormat>();
  const parsedNumber = (id: number) => {
    let format = numberFormats.get(id);
    if (!format) { format = numberFormat(id, formats, context); numberFormats.set(id, format); }
    return format;
  };
  const inheritedAlignments = base.map(item => child(item, "alignment"));
  return styles.length ? styles.map(style => {
    const inherited = base[Number(style.attributes.xfId ?? 0)], attrs = { ...inherited?.attributes, ...style.attributes };
    const result = { ...parsedFonts[Number(attrs.fontId ?? 0)], ...parsedNumber(Number(attrs.numFmtId ?? 0)) };
    const color = parsedFills[Number(attrs.fillId ?? 0)]; if (color) result.background = color;
    const border = parsedBorders[Number(attrs.borderId ?? 0)]; if (border) result.borders = border;
    const alignment = child(style, "alignment") ?? inheritedAlignments[Number(style.attributes.xfId ?? 0)];
    if (alignment) {
      const { horizontal, vertical, wrapText, textRotation, indent, shrinkToFit } = alignment.attributes;
      if (["left", "center", "right"].includes(horizontal)) result.align = horizontal as "left" | "center" | "right";
      else if (horizontal && horizontal !== "general") context.warn({ code: "adjusted", message: "均等割り付けなど未対応の配置を標準配置へ変更しました" });
      if (["top", "bottom", "center"].includes(vertical)) result.verticalAlign = vertical === "center" ? "middle" : vertical as "top" | "bottom";
      if (wrapText !== undefined) result.wrap = ["1", "true"].includes(wrapText);
      if (Number(textRotation) || Number(indent) || ["1", "true"].includes(shrinkToFit)) context.warn({ code: "omitted", message: "セルの文字回転・字下げ・縮小表示を省略しました" });
    }
    return normalizeCellFormat(result);
  }) : [undefined];
}
