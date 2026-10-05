import { officeXml, type OfficeXmlNode as XmlNode } from "../ooxml";
const { parseXml } = officeXml;
import { SLIDE_LIMITS } from "./limits";

const SVG_NS = "http://www.w3.org/2000/svg";
/** SVG is a static, bounded embedded asset. It never loads fonts, images or external resources. */
export const SLIDE_SVG_LIMITS = Object.freeze({ bytes: 1024 * 1024, nodes: 10_000, depth: 32 });
const NUMBER_TOKEN_LIMIT = 128;
const tags = new Set(["svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "linearGradient", "radialGradient", "stop", "clipPath", "text", "tspan", "title", "desc"]);
const attributes = new Set(["id", "xmlns", "viewBox", "width", "height", "preserveAspectRatio", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "d", "points", "transform", "fill", "color", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "clip-path", "clip-rule", "clipPathUnits", "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "alignment-baseline", "letter-spacing", "word-spacing", "dx", "dy", "rotate", "textLength", "lengthAdjust", "xml:space", "vector-effect"]);
const numeric = new Set(["width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "stroke-width", "stroke-miterlimit", "stroke-dashoffset", "offset", "font-size", "letter-spacing", "word-spacing", "dx", "dy", "rotate", "textLength"]);
const fail = (detail: string): never => { throw new Error(`SVGを使用できません: ${detail}`); };
const hasInvalidNumber = (value: string): boolean => {
  // The integer and leading-dot branches do not overlap; each match consumes a complete token.
  // Bound each number, not the entire path/points/transform attribute containing many numbers.
  for (const match of value.matchAll(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g)) {
    if (match[0].length > NUMBER_TOKEN_LIMIT) return true;
    const number = Number(match[0]); if (!Number.isFinite(number) || Math.abs(number) > 1_000_000) return true;
  }
  return false;
};
const dimension = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (value.length > NUMBER_TOKEN_LIMIT) return fail("width / height は128文字以下にしてください");
  if (!/^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:px)?\s*$/.test(value)) return fail("width / height は正の px 値にしてください");
  return Number(value.trim().replace(/px$/, ""));
};

/** Validates source without DOM/XML entity expansion/network access; preserves source bytes. */
export function inspectSlideSvg(svg: string): { width: number; height: number } {
  if (typeof svg !== "string" || !svg.length || svg.length > SLIDE_SVG_LIMITS.bytes) return fail("SVGのサイズは1 MiB以下にしてください");
  const bytes = new TextEncoder().encode(svg);
  if (bytes.byteLength > SLIDE_SVG_LIMITS.bytes) return fail("SVGのサイズは1 MiB以下にしてください");
  // The shared XML parser ignores processing instructions; SVG does not allow stylesheets.
  if (/<\?(?!xml\s)/i.test(svg) || /<!DOCTYPE|<!ENTITY/i.test(svg)) return fail("処理命令・DTD・エンティティ宣言は使用できません");
  let root: XmlNode;
  try { root = parseXml(bytes); } catch { return fail("XMLの構造が不正です"); }
  if (root.name !== "svg" || root.attributes.xmlns !== SVG_NS) return fail('ルートに <svg xmlns="http://www.w3.org/2000/svg"> を指定してください');
  const viewBox = root.attributes.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (viewBox && (viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value) || Math.abs(value) > 1_000_000) || viewBox[2] <= 0 || viewBox[3] <= 0)) return fail("viewBox は x y 幅 高さの4つの有限数にしてください");
  const width = dimension(root.attributes.width) ?? viewBox?.[2], height = dimension(root.attributes.height) ?? viewBox?.[3];
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width > SLIDE_LIMITS.imageDimension || height > SLIDE_LIMITS.imageDimension || width * height > SLIDE_LIMITS.imagePixels) return fail("有効な width / height または viewBox が必要です。寸法は16,384 px、総画素数は40,000,000以下です");
  const ids = new Map<string, string>(), references: { id: string; clip: boolean }[] = [];
  const pending = [{ node: root, depth: 0 }]; let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > SLIDE_SVG_LIMITS.nodes || depth >= SLIDE_SVG_LIMITS.depth) return fail("要素数または入れ子の深さが上限を超えています");
    if (!tags.has(node.name) || node.name === "svg" && node !== root) return fail(`${node.name} 要素には対応していません。静的な図形・グラデーション・テキストを使ってください`);
    if (node.text.trim() && !["text", "tspan", "title", "desc"].includes(node.name)) return fail(`${node.name} 内のテキストには対応していません`);
    if ((node.name === "title" || node.name === "desc") && node.children.length) return fail("title / desc 内はプレーンテキストにしてください");
    for (const [key, value] of Object.entries(node.attributes)) {
      if (!attributes.has(key) || key === "xmlns" && (node !== root || value !== SVG_NS)) return fail(`${key} 属性は使用できません。外部参照・イベント・CSSには対応していません`);
      if (key === "id") {
        if (!/^[A-Za-z_][\w.-]{0,127}$/.test(value) || ids.has(value)) return fail("id は重複しない英数字にしてください");
        ids.set(value, node.name);
      }
      if (/[\\\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return fail(`${key} 属性に使用できない文字が含まれています`);
      if (/url\s*\(/i.test(value)) {
        const ref = /^url\(#[A-Za-z_][\w.-]{0,127}\)$/.test(value) ? value.slice(5, -1) : undefined;
        if (!ref || !["fill", "stroke", "clip-path"].includes(key)) return fail("参照は fill / stroke / clip-path の url(#id) のみ使用できます");
        references.push({ id: ref, clip: key === "clip-path" });
      } else if (["fill", "stroke", "stop-color", "color"].includes(key) && !/^(?:#[0-9a-f]{3,8}|[A-Za-z]+|(?:rgb|rgba|hsl|hsla)\([0-9.,%+\-\s]+\))$/i.test(value)) return fail(`${key} は色または url(#id) にしてください`);
      else if (key === "clip-path" && value !== "none") return fail("clip-path は url(#id) または none にしてください");
      if (numeric.has(key) || ["viewBox", "points", "d", "transform", "gradientTransform", "stroke-dasharray"].includes(key)) {
        if (hasInvalidNumber(value)) return fail(`${key} の数値が大きすぎるか、数値表記が128文字を超えています`);
      }
    }
    if (count + pending.length + node.children.length > SLIDE_SVG_LIMITS.nodes) return fail("要素数が上限を超えています");
    for (const child of node.children) pending.push({ node: child, depth: depth + 1 });
  }
  for (const reference of references) if (!(reference.clip ? ids.get(reference.id) === "clipPath" : ["linearGradient", "radialGradient"].includes(ids.get(reference.id) ?? ""))) return fail(`参照先 ${reference.id} が存在しないか、種類が不正です`);
  return { width, height };
}

/** Encode authored SVG as a validated image source for ordinary SlideImageElement.src. */
export function createSlideSvgSource(svg: string): string {
  inspectSlideSvg(svg);
  const bytes = new TextEncoder().encode(svg), chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return `data:image/svg+xml;base64,${btoa(chunks.join(""))}`;
}
