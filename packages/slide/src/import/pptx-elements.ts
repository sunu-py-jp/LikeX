import { createSlideElement } from "../model";
import { SLIDE_LIMITS } from "../model/limits";
import type { SlideElement, SlideShapeKind } from "../model/types";
import { child, children, attribute, localName, plainText, nonVisual, placeholder, color, readFill, type Node, type Theme, type PptxContext, type Relations } from "./pptx-reader";

type ElementContext = { context: PptxContext; theme: Theme; mapping: Record<string, string>; links: Relations; defaults: Node[] };
const first = (chain: (Node | undefined)[], lookup: (node: Node) => Node | undefined) => chain.map(node => node ? lookup(node) : undefined).find(Boolean);
function geometry(chain: Node[], context: PptxContext) {
  const transform = first(chain, node => child(child(node, "spPr"), "xfrm"));
  const off = child(transform, "off"), ext = child(transform, "ext");
  if (!off || !ext) { context.warn("位置が特定できないオブジェクトを省略しました"); return; }
  const x = Number(off.attributes.x) / 9525, y = Number(off.attributes.y) / 9525;
  let width = Number(ext.attributes.cx) / 9525, height = Number(ext.attributes.cy) / 9525;
  const rotation = Number(transform?.attributes.rot ?? 0) / 60000;
  if (![x, y, width, height, rotation].every(Number.isFinite) || width < 0 || height < 0) throw new Error("PowerPointのオブジェクトの位置が不正です");
  if (width < 1 || height < 1) { width = Math.max(1, width); height = Math.max(1, height); context.warn("幅・高さが1ピクセル未満のオブジェクトを調整しました"); }
  if (["1", "true"].includes(transform?.attributes.flipH ?? "") || ["1", "true"].includes(transform?.attributes.flipV ?? "")) context.warn("オブジェクトの反転を省略しました");
  return { x, y, width, height, rotation: ((rotation % 360) + 360) % 360 };
}
function textStyle(chain: Node[], options: ElementContext) {
  const { context, theme, mapping } = options;
  let fontSize = 24, fontFamily = theme.minorFont, textColor = "#000000", bold = false, italic = false;
  let align: "left" | "center" | "right" = "left", verticalAlign: "top" | "middle" | "bottom" = "top";
  const properties: Node[] = [...options.defaults];
  const reference = first(chain, shape => child(child(shape, "style"), "fontRef"));
  if (reference) properties.push({ name: "rPr", attributes: {}, text: "", children: [
    { name: "solidFill", attributes: {}, text: "", children: reference.children },
    { name: "latin", attributes: { typeface: reference.attributes.idx === "major" ? theme.majorFont : theme.minorFont }, children: [], text: "" },
  ] });
  for (const shape of [...chain].reverse()) {
    const body = child(shape, "txBody"), paragraph = child(body, "p");
    const level = child(child(body, "lstStyle"), "lvl1pPr");
    for (const value of [child(level, "defRPr"), child(child(paragraph, "pPr"), "defRPr"), child(paragraph, "endParaRPr"), child(paragraph?.children.find(node => ["r", "fld"].includes(localName(node.name))), "rPr")]) if (value) properties.push(value);
    const paragraphAlign = child(paragraph, "pPr")?.attributes.algn ?? level?.attributes.algn;
    if (paragraphAlign) {
      if (paragraphAlign === "ctr") align = "center"; else if (paragraphAlign === "r") align = "right"; else if (paragraphAlign === "l") align = "left";
      else context.warn("均等割り付けなどの段落配置を左揃えへ変更しました");
    }
    const anchor = child(body, "bodyPr")?.attributes.anchor;
    if (anchor) verticalAlign = anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top";
  }
  for (const value of properties) {
    if (value.attributes.sz !== undefined) fontSize = Number(value.attributes.sz) / 75;
    if (value.attributes.b !== undefined) bold = ["1", "true"].includes(value.attributes.b);
    if (value.attributes.i !== undefined) italic = ["1", "true"].includes(value.attributes.i);
    textColor = readFill(value, theme, mapping, context) ?? textColor;
    const face = child(value, "latin")?.attributes.typeface ?? child(value, "ea")?.attributes.typeface;
    if (face) fontFamily = face.startsWith("+mj") ? theme.majorFont : face.startsWith("+mn") ? theme.minorFont : face;
  }
  const body = child(chain[0], "txBody"), signatures = new Set<string>();
  for (const paragraph of children(body, "p")) {
    for (const run of paragraph.children.filter(node => ["r", "fld"].includes(localName(node.name)))) signatures.add(JSON.stringify(child(run, "rPr")));
    const ppr = child(paragraph, "pPr");
    if (ppr && (Number(ppr.attributes.lvl) || ppr.children.some(node => ["buChar", "buAutoNum", "buBlip", "lnSpc", "spcBef", "spcAft"].includes(localName(node.name))))) context.warn("箇条書き・インデント・段落間隔を通常の文章へ変更しました");
  }
  if (signatures.size > 1) context.warn("文字ごとに異なる書式を、テキスト全体で共通の書式へ変更しました");
  const bodyProperties = child(body, "bodyPr")?.attributes;
  if (bodyProperties?.vert && bodyProperties.vert !== "horz" || Number(bodyProperties?.rot)) context.warn("縦書き・テキスト単独の回転を省略しました");
  return { fontSize, fontFamily, textColor, bold, italic, align, verticalAlign };
}
async function imageSource(path: string, context: PptxContext): Promise<string | undefined> {
  const cached = context.images.get(path); if (cached) return cached;
  const bytes = await context.archive.read(path);
  if (bytes.length > SLIDE_LIMITS.imageBytes) throw new Error("PowerPointの画像1件のサイズが10 MiBを超えています");
  const signature = String.fromCharCode(...bytes.subarray(0, 12));
  const mime = bytes[0] === 137 && signature.slice(1, 4) === "PNG" ? "image/png" : bytes[0] === 255 && bytes[1] === 216 ? "image/jpeg" : signature.startsWith("GIF8") ? "image/gif" : signature.startsWith("RIFF") && signature.slice(8) === "WEBP" ? "image/webp" : undefined;
  if (!mime) { context.warn("PNG・JPEG・GIF・WebP以外の画像を省略しました"); return; }
  const chunks: string[] = []; for (let at = 0; at < bytes.length; at += 8192) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 8192)));
  const source = `data:${mime};base64,${btoa(chunks.join(""))}`; context.images.set(path, source); return source;
}
export async function readElement(chain: Node[], options: ElementContext, id: string): Promise<SlideElement | undefined> {
  const node = chain[0], kind = localName(node.name), { context, theme, mapping } = options;
  if (!["sp", "pic", "cxnSp"].includes(kind)) { context.warn("グループ・表・グラフ・SmartArtなど未対応のオブジェクトを省略しました"); return; }
  const nv = nonVisual(node);
  if (["1", "true"].includes(nv?.attributes.hidden ?? "")) { context.warn("非表示のオブジェクトを省略しました"); return; }
  const position = geometry(chain, context); if (!position) return;
  const name = nv?.attributes.name || `Object ${id}`;
  const locks = child(node.children.find(value => localName(value.name).startsWith("nv"))?.children.find(value => ["cNvSpPr", "cNvPicPr", "cNvCxnSpPr"].includes(localName(value.name))), kind === "pic" ? "picLocks" : "spLocks");
  const locked = ["noMove", "noResize", "noRot"].some(key => ["1", "true"].includes(locks?.attributes[key] ?? ""));
  const props = first(chain, shape => child(shape, "spPr"));
  if (child(props, "effectLst")?.children.length || child(props, "effectDag") || child(props, "scene3d") || child(props, "sp3d") || Number(child(child(node, "style"), "effectRef")?.attributes.idx)) context.warn("影・立体効果などの装飾を省略しました");
  if (kind === "pic") {
    const blipFill = child(node, "blipFill"), blip = child(blipFill, "blip"), imageId = attribute(blip, "embed"), link = imageId ? options.links.get(imageId) : undefined;
    if (!link || link.external || !link.type.endsWith("/image")) { context.warn("外部参照または参照先のない画像を省略しました"); return; }
    const src = await imageSource(link.target, context); if (!src) return;
    const crop = child(blipFill, "srcRect"); if (crop && Object.values(crop.attributes).some(value => Number(value))) context.warn("画像のトリミングを解除して元画像を読み込みました");
    const alpha = Number(child(blip, "alphaModFix")?.attributes.amt ?? 100000) / 100000;
    return createSlideElement({ type: "image", id, name, ...position, opacity: alpha, locked, src, alt: nv?.attributes.descr ?? "" });
  }
  const text = plainText(child(node, "txBody"));
  if (text.length > SLIDE_LIMITS.textLength || (context.textCharacters += text.length) > SLIDE_LIMITS.totalTextLength) throw new Error("PowerPointのテキスト量が読み込み上限を超えています");
  const style = textStyle(chain, options), isText = !!placeholder(node) || child(child(node, "nvSpPr"), "cNvSpPr")?.attributes.txBox === "1";
  const fillValue = chain.map(shape => readFill(child(shape, "spPr"), theme, mapping, context)).find(value => value !== undefined)
    ?? color(first(chain, shape => child(child(shape, "style"), "fillRef")), theme, mapping, context) ?? (isText ? "transparent" : "#4F81BD");
  if (isText) return createSlideElement({ type: "text", id, name, ...position, locked, text, fill: fillValue,
    fontSize: style.fontSize, fontFamily: style.fontFamily, color: style.textColor, bold: style.bold, italic: style.italic, align: style.align, verticalAlign: style.verticalAlign });
  const preset = child(props, "prstGeom")?.attributes.prst ?? (kind === "cxnSp" ? "line" : "rect");
  const kinds: Record<string, SlideShapeKind> = { rect: "rect", roundRect: "roundRect", ellipse: "ellipse", triangle: "triangle", diamond: "diamond", rightArrow: "arrow", line: "line", straightConnector1: "line" };
  const shape = kinds[preset] ?? "rect";
  if (!kinds[preset] || child(props, "custGeom")) context.warn("未対応の図形・自由曲線を長方形へ変更しました");
  if (child(child(props, "prstGeom"), "avLst")?.children.length) context.warn("図形の角丸・矢印などの調整値を標準値へ変更しました");
  const line = first(chain, shape => child(child(shape, "spPr"), "ln"));
  if (child(line, "custDash") || child(line, "prstDash") && child(line, "prstDash")?.attributes.val !== "solid" ||
    ["headEnd", "tailEnd"].some(key => child(line, key) && child(line, key)?.attributes.type !== "none")) context.warn("破線・線の端の装飾を通常の線へ変更しました");
  const stroke = readFill(line, theme, mapping, context) ?? color(first(chain, shape => child(child(shape, "style"), "lnRef")), theme, mapping, context) ?? "transparent";
  if (text && (style.bold || style.italic || style.fontFamily !== "Arial" || style.align !== "center" || style.verticalAlign !== "middle")) context.warn("図形内の文字書式をLikeSlideの共通書式へ変更しました");
  return createSlideElement({ type: "shape", id, name, ...position, locked, shape, fill: fillValue, stroke,
    strokeWidth: Number(line?.attributes.w ?? 9525) / 9525, text, fontSize: style.fontSize, textColor: style.textColor });
}
