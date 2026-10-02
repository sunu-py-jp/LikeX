import { isOfficeShapePreset } from "../model/core-office-shapes";
import { child, children, attr, descendants, textContent, runStyle, type XmlNode, type Node } from "./docx-reader";
import { xml, WPS } from "./docx-xml";

const hex = (value: unknown) => String(value).replace(/^#/, "").toUpperCase();
/** Word 2010 native preset shape; never flatten supported geometry to an image. */
export function writeDocxShape(attrs: Record<string, unknown>, id: number): string {
  const width = Math.round(Number(attrs.width) * 9525), height = Math.round(Number(attrs.height) * 9525);
  const transform = `<a:xfrm rot="${Math.round(Number(attrs.rotation) * 60000)}" flipH="${attrs.flipH ? 1 : 0}" flipV="${attrs.flipV ? 1 : 0}"><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>`;
  const fill = attrs.fill === null ? "<a:noFill/>" : `<a:solidFill><a:srgbClr val="${hex(attrs.fill)}"/></a:solidFill>`;
  const line = `<a:ln w="${Math.round(Number(attrs.strokeWidth) * 9525)}">${attrs.stroke === null ? "<a:noFill/>" : `<a:solidFill><a:srgbClr val="${hex(attrs.stroke)}"/></a:solidFill>`}<a:prstDash val="solid"/></a:ln>`;
  const paragraphs = String(attrs.text ?? "").split("\n").map(text => `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="${hex(attrs.color)}"/><w:sz w:val="${Math.round(Number(attrs.fontSize) * 2)}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`).join("");
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="Shape ${id}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr>${transform}<a:prstGeom prst="${xml(String(attrs.preset))}"><a:avLst/></a:prstGeom>${fill}${line}</wps:spPr><wps:txbx><w:txbxContent>${paragraphs}</w:txbxContent></wps:txbx><wps:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/** Unsupported floating flow and geometry adjustments are reported rather than silently retained as something else. */
export function readDocxShape(source: XmlNode, warn: (message: string) => void, theme: ReadonlyMap<string, string>): Node | undefined {
  if (descendants(source, "wgp").length || descendants(source, "grpSp").length) { warn("グループ化された図形は未対応のため省略しました"); return; }
  const shapes = descendants(source, "wsp");
  if (shapes.length !== 1) { warn("未対応の図形・グラフ・SmartArtを省略しました"); return; }
  const shape = shapes[0], props = child(shape, "spPr"), geometry = child(props, "prstGeom"), preset = attr(geometry, "prst");
  if (!isOfficeShapePreset(preset) || child(props, "custGeom")) { warn(`未対応の図形プリセット・自由図形を省略しました${preset ? ` (${preset})` : ""}`); return; }
  const transform = child(props, "xfrm"), extent = child(transform, "ext") ?? descendants(source, "extent")[0];
  const width = Number(attr(extent, "cx")) / 9525, height = Number(attr(extent, "cy")) / 9525;
  if (![width, height].every(value => Number.isFinite(value) && value >= 1 && value <= 16384)) { warn("寸法が不正または大きすぎる図形を省略しました"); return; }
  if (descendants(source, "anchor").length) warn("浮動配置の図形は本文中の図形として読み込みました（重なり・回り込み・ページ上の位置は保持しません）");
  if (children(child(geometry, "avLst"), "gd").length) warn("図形の調整ハンドル値は既定値に戻して読み込みました");
  if (descendants(props ?? shape, "effectLst").some(item => item.children.length) || child(props, "scene3d") || child(props, "sp3d") || child(props, "effectDag")) warn("図形の影・立体・視覚効果を省略しました");
  function color(node: XmlNode | undefined, fallback: string): string {
    if (!node) return fallback;
    const direct = child(node, "srgbClr"), scheme = child(node, "schemeClr"), system = child(node, "sysClr");
    let value = attr(direct, "val") ?? attr(system, "lastClr");
    if (scheme) { value = theme.get(attr(scheme, "val") ?? ""); if (!value) warn("解決できない図形のテーマ色を既定色に変換しました"); }
    const clr = direct ?? scheme ?? system;
    if (clr?.children.length) warn("図形の色の透明度・濃淡調整を省略しました");
    return value && /^[a-f\d]{6}$/i.test(value) ? `#${value}` : fallback;
  }
  function paint(node: XmlNode | undefined, fallback: string, ref?: XmlNode): string | null {
    if (child(node, "noFill")) return null;
    if (child(node, "gradFill") || child(node, "pattFill") || child(node, "blipFill")) warn("図形のグラデーション・パターン・画像の塗りつぶしを単色に変換しました");
    return color(child(node, "solidFill") ?? ref, fallback);
  }
  const style = child(shape, "style"), line = child(props, "ln");
  if (child(line, "prstDash") && attr(child(line, "prstDash"), "val") !== "solid") warn("図形の破線は実線に変換しました");
  if (child(line, "headEnd") || child(line, "tailEnd")) warn("図形の線端の装飾を省略しました");
  const textBox = child(child(shape, "txbx"), "txbxContent"), paragraphs = textBox ? descendants(textBox, "p") : [];
  const paragraphText = (paragraph: XmlNode): string => {
    const visit = (node: XmlNode): string => node.children.map(item => {
      const tag = item.name.split(":").at(-1);
      if (tag === "p") return ""; // Nested text boxes have their own paragraph entry.
      if (tag === "t") return textContent(item);
      if (tag === "br" || tag === "cr") return "\n";
      if (tag === "tab") return "\t";
      return visit(item);
    }).join("");
    return visit(paragraph);
  };
  // Flatten table cells and content controls in document order, retaining their
  // text even when their layout cannot be represented by the shape text model.
  const text = paragraphs.map(paragraphText).join("\n");
  const textStyle = runStyle(descendants(textBox ?? shape, "rPr")[0]);
  if (descendants(textBox ?? shape, "tbl").length || descendants(textBox ?? shape, "hyperlink").length || descendants(textBox ?? shape, "drawing").length || descendants(textBox ?? shape, "rPr").some(item => item.children.some(child => !["color", "sz", "szCs"].includes(child.name.split(":").at(-1)!)))) warn("図形内の複雑な書式・表・リンクは通常の文字に変換しました");
  if (new Set(descendants(textBox ?? shape, "rPr").map(item => JSON.stringify(runStyle(item)))).size > 1) warn("図形内の文字書式は先頭の文字書式に統一しました");
  if (paragraphs.some(paragraph => { const align = attr(child(child(paragraph, "pPr"), "jc"), "val"); return align !== undefined && align !== "center"; })) warn("図形内の段落配置は中央揃えに変換しました");
  const body = child(shape, "bodyPr");
  if (Number(attr(body, "rot") ?? 0) !== 0 || child(body, "normAutofit") || child(body, "spAutoFit")) warn("図形内の文字回転・自動調整を省略しました");
  if (attr(body, "vert") && attr(body, "vert") !== "horz" || attr(body, "anchor") && attr(body, "anchor") !== "ctr" || ["lIns", "tIns", "rIns", "bIns"].some(name => Number(attr(body, name) ?? 0) !== 0)) warn("図形内の文字配置・余白は標準の中央配置に変換しました");
  let rotation = Number(attr(transform, "rot") ?? 0) / 60000;
  if (!Number.isFinite(rotation)) { rotation = 0; warn("不正な図形の回転を0度に変換しました"); }
  rotation %= 360;
  const strokeWidth = Number(attr(line, "w") ?? 14287.5) / 9525;
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0 || strokeWidth > 100) warn("図形の線幅を既定値に変換しました");
  return { type: "shape", attrs: { preset, width, height, text, fill: paint(props, "#dbeafe", child(style, "fillRef")), stroke: paint(line, "#2563eb", child(style, "lnRef")), strokeWidth: Number.isFinite(strokeWidth) && strokeWidth >= 0 && strokeWidth <= 100 ? strokeWidth : 1.5, rotation, flipH: ["1", "true"].includes(attr(transform, "flipH") ?? ""), flipV: ["1", "true"].includes(attr(transform, "flipV") ?? ""), color: textStyle.color ?? "#172554", fontSize: textStyle.fontSize ?? 14 } };
}
