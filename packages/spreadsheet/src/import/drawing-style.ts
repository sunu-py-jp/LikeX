import type { SpreadsheetSheet, SpreadsheetDrawingTextStyle } from "../model/types";
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
/** Merge DrawingML run properties by property, rather than selecting a whole rPr node. */
function mergedRunProperties(...nodes: (XmlNode | undefined)[]): XmlNode {
  const attributes: Record<string, string> = {}, properties = new Map<string, XmlNode>();
  for (const node of nodes) if (node) {
    Object.assign(attributes, node.attributes);
    for (const item of node.children) properties.set(localName(item.name), item);
  }
  return { name: "rPr", attributes, children: [...properties.values()], text: "" };
}
export function drawingText(body: XmlNode | undefined, context: ImportContext, sheet: SpreadsheetSheet, fontReference?: XmlNode) {
  const paragraphs = children(body, "p"), list = child(body, "lstStyle");
  const styles = paragraphs.flatMap(paragraph => {
    const pPr = child(paragraph, "pPr"), level = Math.max(0, Math.min(8, Number(pPr?.attributes.lvl) || 0));
    const defaults = child(child(list, `lvl${level + 1}pPr`), "defRPr"), paragraphDefault = child(pPr, "defRPr");
    const runs = paragraph.children.filter(run => ["r", "fld"].includes(localName(run.name)));
    return runs.length ? runs.map(run => mergedRunProperties(defaults, paragraphDefault, child(run, "rPr")))
      : [mergedRunProperties(defaults, paragraphDefault, child(paragraph, "endParaRPr"))];
  });
  const first = styles[0], text = paragraphs.map(inlineText).join("\n");
  const size = finiteNumber(first?.attributes.sz), fontSize = Math.max(1, Math.min(400, size === undefined ? 16 : size / 75));
  if (size !== undefined && fontSize !== size / 75) adjusted(context, sheet, "オブジェクトの文字サイズを対応範囲へ調整しました");
  if (styles.some(style => JSON.stringify(style) !== JSON.stringify(first))) adjusted(context, sheet, "オブジェクト内の文字ごとの書式を先頭の書式へ統一しました");
  if (child(first, "hlinkClick")) omitted(context, sheet, "オブジェクトの文字リンクを省略しました");
  const result: SpreadsheetDrawingTextStyle = {};
  const eastAsian = /[\u3000-\u9fff\uff00-\uffef]/u.test(text);
  const reference = fontReference?.attributes.idx;
  const fallbackFamily = reference === "major" || reference === "minor" ? `+${reference === "major" ? "mj" : "mn"}-${eastAsian ? "ea" : "lt"}` : undefined;
  const family = (eastAsian ? child(first, "ea")?.attributes.typeface || child(first, "latin")?.attributes.typeface
    : child(first, "latin")?.attributes.typeface || child(first, "ea")?.attributes.typeface) || fallbackFamily;
  const resolvedFamily = family?.startsWith("+") ? context.themeFonts?.[family] : family;
  if (resolvedFamily?.trim() && resolvedFamily.length <= 100 && !/[;{}<>\u0000-\u001f]/.test(resolvedFamily)) result.fontFamily = resolvedFamily;
  else if (family) adjusted(context, sheet, "解決できない図形のフォントを表示環境の標準フォントへ変更しました");
  if (first?.attributes.i !== undefined) result.italic = ["1", "true"].includes(first.attributes.i);
  if (first?.attributes.u !== undefined) {
    result.underline = first.attributes.u !== "none";
    if (!["none", "sng"].includes(first.attributes.u)) adjusted(context, sheet, "図形の下線を一本線へ近似しました");
  }
  const properties = child(body, "bodyPr"), pPr = child(paragraphs[0], "pPr");
  if (body) {
    const inset = (name: string, fallback: number) => {
      const original = finiteNumber(properties?.attributes[name]), value = original === undefined ? fallback : original / 9525;
      const adjustedValue = Math.min(10_000, Math.max(0, value));
      if (value !== adjustedValue) adjusted(context, sheet, "図形の文字余白を対応範囲へ調整しました");
      return adjustedValue;
    };
    result.textInsets = { left: inset("lIns", 9.6), top: inset("tIns", 4.8), right: inset("rIns", 9.6), bottom: inset("bIns", 4.8) };
    result.textWrap = properties?.attributes.wrap === "none" ? "none" : "wrap";
    result.textOverflow = properties?.attributes.horzOverflow === "clip" ? "clip" : "overflow";
    result.textVerticalOverflow = properties?.attributes.vertOverflow === "clip" || properties?.attributes.vertOverflow === "ellipsis" ? "clip" : "overflow";
    if (properties?.attributes.vertOverflow === "ellipsis") adjusted(context, sheet, "図形の文字の省略記号を切り取り表示へ変更しました");
    const alignments: Record<string, "left" | "center" | "right"> = { l: "left", ctr: "center", r: "right" };
    result.textAlign = alignments[pPr?.attributes.algn ?? "l"] ?? "left";
    if (pPr?.attributes.algn && !alignments[pPr.attributes.algn]) adjusted(context, sheet, "図形の均等割り付けを左揃えへ変更しました");
    result.textVerticalAlign = properties?.attributes.anchor === "ctr" ? "middle" : properties?.attributes.anchor === "b" ? "bottom" : "top";
    if (properties?.attributes.anchor && !["t", "ctr", "b"].includes(properties.attributes.anchor)) adjusted(context, sheet, "図形の縦方向の均等割り付けを上揃えへ変更しました");
    const normalFit = child(properties, "normAutofit");
    result.textAutoFit = normalFit ? "shrink" : child(properties, "spAutoFit") ? "resize" : "none";
    if (result.textAutoFit === "resize") adjusted(context, sheet, "文字に合わせた図形の自動拡大は文字領域のみへ適用しました。図形の外形は保存済みの大きさを維持します");
    if (Number(normalFit?.attributes.lnSpcReduction)) adjusted(context, sheet, "図形の自動縮小時の行間圧縮を省略しました");
    const scale = finiteNumber(normalFit?.attributes.fontScale);
    if (scale !== undefined) {
      result.textFontScale = Math.min(1, Math.max(0.01, scale / 100000));
      if (result.textFontScale !== scale / 100000) adjusted(context, sheet, "図形の文字の縮小率を対応範囲へ調整しました");
    }
    const spacing = child(pPr, "lnSpc"), percent = finiteNumber(child(spacing, "spcPct")?.attributes.val), points = finiteNumber(child(spacing, "spcPts")?.attributes.val);
    const lineHeight = percent !== undefined ? percent / 100000 : points !== undefined ? points / 75 / fontSize : 1.2;
    result.textLineHeight = Math.min(10, Math.max(0.1, lineHeight));
    if (points !== undefined) adjusted(context, sheet, "図形の固定行間をフォントサイズに対する比率へ変換しました");
    if (lineHeight !== result.textLineHeight) adjusted(context, sheet, "図形の行間を対応範囲へ調整しました");
    if (properties?.attributes.vert && properties.attributes.vert !== "horz") adjusted(context, sheet, "図形の縦書きを横書きへ変更しました");
    if (paragraphs.some(paragraph => {
      const props = child(paragraph, "pPr");
      return Number(props?.attributes.marL) || Number(props?.attributes.marR) || Number(props?.attributes.indent) || ["spcBef", "spcAft"].some(name => child(props, name)?.children.some(item => Number(item.attributes.val)));
    })) omitted(context, sheet, "図形の段落の余白・字下げを省略しました");
    if (paragraphs.slice(1).some(paragraph => child(paragraph, "pPr")?.attributes.algn !== pPr?.attributes.algn)) adjusted(context, sheet, "図形内の段落配置を先頭の配置へ統一しました");
  }
  return { text, fontSize, color: drawingColor(child(first, "solidFill"), context) ?? drawingColor(fontReference, context) ?? "#1f2937",
    bold: ["1", "true"].includes(first?.attributes.b ?? "0"), ...result };
}
