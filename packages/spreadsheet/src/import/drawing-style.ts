import type { SpreadsheetSheet } from "../model/types";
import type { ImportContext } from "./types";
import { styleColor } from "./styles";
import { adjusted, omitted } from "./worksheet-shared";
import { child, children, localName, textContent, spreadsheetText, type XmlNode } from "./xml";
import { finiteNumber } from "./drawing-geometry";

const themes = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
/** Only resolved color literals enter the model, never DrawingML URI paints. */
export function drawingColor(node: XmlNode | undefined, context: ImportContext): string | undefined {
  if (!node) return;
  const color = node.children.find(item => ["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr"].includes(localName(item.name)));
  if (!color) return;
  const kind = localName(color.name), value = color.attributes.val;
  let result: string | undefined;
  if (kind === "srgbClr" || kind === "sysClr") result = styleColor({ ...color, attributes: { rgb: kind === "sysClr" ? color.attributes.lastClr : value } }, context);
  if (kind === "schemeClr") {
    const index = themes.indexOf(value === "tx1" ? "dk1" : value === "tx2" ? "dk2" : value === "bg1" ? "lt1" : value === "bg2" ? "lt2" : value);
    if (index >= 0) result = styleColor({ ...color, attributes: { theme: String(index) } }, context);
  }
  if (kind === "prstClr" && /^[a-z]+$/i.test(value ?? "")) {
    const names: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", orange: "FFA500" };
    if (names[value]) result = `#${names[value]}`;
  }
  if (kind === "scrgbClr") {
    const components = ["r", "g", "b"].map(key => finiteNumber(color.attributes[key]));
    if (components.every((value): value is number => value !== undefined && value >= 0 && value <= 100000))
      result = `#${components.map(value => Math.round(value * 255 / 100000).toString(16).padStart(2, "0")).join("")}`;
  }
  if (!result) return;
  const modifiers = color.children.filter(item => localName(item.name) !== "alpha");
  if (modifiers.length) context.warn({ code: "adjusted", message: "図形の色の濃淡・色変換を基本色へ近似しました" });
  const alpha = finiteNumber(child(color, "alpha")?.attributes.val);
  if (alpha !== undefined && alpha >= 0 && alpha < 100000) result += Math.round(alpha * 255 / 100000).toString(16).padStart(2, "0");
  return result;
}
export function drawingFill(node: XmlNode | undefined, fallback: string, context: ImportContext, sheet: SpreadsheetSheet): string {
  if (child(node, "noFill")) return "transparent";
  const color = drawingColor(child(node, "solidFill"), context);
  if (child(node, "gradFill") || child(node, "pattFill") || child(node, "blipFill")) adjusted(context, sheet, "図形のグラデーション・模様を単色へ変更しました");
  return color ?? fallback;
}
function inlineText(node: XmlNode): string {
  const name = localName(node.name);
  if (name === "t") return spreadsheetText(textContent(node));
  if (name === "br") return "\n";
  return node.children.map(inlineText).join("");
}
export function drawingText(body: XmlNode | undefined, context: ImportContext, sheet: SpreadsheetSheet) {
  const paragraphs = children(body, "p"), runs = paragraphs.flatMap(paragraph => children(paragraph, "r").concat(children(paragraph, "fld")));
  const first = child(runs[0], "rPr") ?? child(child(paragraphs[0], "pPr"), "defRPr") ?? child(paragraphs[0], "endParaRPr");
  const text = paragraphs.map(inlineText).join("\n");
  const size = finiteNumber(first?.attributes.sz), fontSize = Math.max(1, Math.min(400, size === undefined ? 16 : size / 75));
  if (size !== undefined && fontSize !== size / 75) adjusted(context, sheet, "オブジェクトの文字サイズを対応範囲へ調整しました");
  if (runs.some(run => JSON.stringify(child(run, "rPr")) !== JSON.stringify(first))) adjusted(context, sheet, "オブジェクト内の文字ごとの書式を先頭の書式へ統一しました");
  if (first?.attributes.i === "1" || first?.attributes.u || child(first, "hlinkClick")) omitted(context, sheet, "オブジェクトの未対応の文字装飾・リンクを省略しました");
  return { text, fontSize, color: drawingColor(child(first, "solidFill"), context) ?? "#1f2937",
    bold: ["1", "true"].includes(first?.attributes.b ?? "0") };
}
