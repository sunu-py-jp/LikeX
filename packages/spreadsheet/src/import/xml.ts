import { XLSX_IMPORT_LIMITS as limits } from "./types";

export type XmlNode = { name: string; attributes: Record<string, string>; children: XmlNode[]; text: string };
export const localName = (name: string): string => name.slice(name.indexOf(":") + 1);
export const children = (node: XmlNode | undefined, name: string): XmlNode[] => node?.children.filter(item => localName(item.name) === name) ?? [];
export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => node?.children.find(item => localName(item.name) === name);
export const attribute = (node: XmlNode | undefined, name: string): string | undefined => node && Object.entries(node.attributes).find(([key]) => localName(key) === name)?.[1];
export const textContent = (node: XmlNode | undefined): string => node ? node.text + node.children.map(textContent).join("") : "";
const fail = (): never => { throw new Error("Excel内のXMLが不正、または安全な読み込み上限を超えています"); };
function entities(value: string): string {
  return value.replace(/&([^;]*);|&/g, (match, entity: string | undefined) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (entity && Object.hasOwn(named, entity)) return named[entity];
    if (!entity || !/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) return fail();
    const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(code) || code > 0x10ffff || (code < 32 && ![9, 10, 13].includes(code)) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) return fail();
    return String.fromCodePoint(code);
  });
}
/** No DTD, entity declarations, external resolution, DOM, or recursive parser. */
export function parseXml(bytes: Uint8Array): XmlNode {
  if (bytes.byteLength > limits.xmlBytes) fail();
  let source: string;
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    source = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
  } catch { return fail(); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(source)) fail();
  const stack: XmlNode[] = [], namePattern = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
  let root: XmlNode | undefined, pos = 0, nodes = 0, characters = 0;
  const space = () => { while (/\s/.test(source[pos] ?? "") && pos < source.length) pos++; };
  const name = () => { namePattern.lastIndex = pos; const match = namePattern.exec(source); if (!match) return fail(); pos = namePattern.lastIndex; return match[0]; };
  const append = (value: string) => { characters += value.length; if (characters > limits.xmlText) fail(); if (stack.length) stack[stack.length - 1].text += value; else if (value.trim()) fail(); };
  while (pos < source.length) {
    if (source[pos] !== "<") { const end = source.indexOf("<", pos); const next = end < 0 ? source.length : end; const value = source.slice(pos, next); if (value.includes("]]>")) fail(); append(entities(value)); pos = next; continue; }
    if (source.startsWith("<!--", pos)) { const end = source.indexOf("-->", pos + 4); if (end < 0 || source.slice(pos + 4, end).includes("--")) fail(); pos = end + 3; continue; }
    if (source.startsWith("<![CDATA[", pos)) { if (!stack.length) fail(); const end = source.indexOf("]]>", pos + 9); if (end < 0) fail(); append(source.slice(pos + 9, end)); pos = end + 3; continue; }
    if (source.startsWith("<?", pos)) { const end = source.indexOf("?>", pos + 2); if (end < 0) fail(); if (/^<\?xml\s/i.test(source.slice(pos, pos + 7)) && (root || pos !== 0)) fail(); pos = end + 2; continue; }
    if (source.startsWith("<!", pos)) fail();
    pos++;
    if (source[pos] === "/") { pos++; const closing = name(); space(); if (source[pos++] !== ">" || stack.pop()?.name !== closing) fail(); continue; }
    const node: XmlNode = { name: name(), attributes: Object.create(null), children: [], text: "" };
    if (++nodes > limits.xmlNodes || stack.length >= limits.xmlDepth) fail();
    while (true) {
      const before = pos; space();
      if (source[pos] === ">" || source.startsWith("/>", pos)) break;
      if (before === pos) fail();
      const key = name(); space(); if (source[pos++] !== "=") fail(); space();
      const quote = source[pos++]; if (quote !== '"' && quote !== "'") fail();
      const end = source.indexOf(quote, pos); if (end < 0) fail();
      const value = source.slice(pos, end); if (value.includes("<") || Object.hasOwn(node.attributes, key)) fail();
      node.attributes[key] = entities(value); characters += value.length; if (characters > limits.xmlText || Object.keys(node.attributes).length > 100) fail(); pos = end + 1;
    }
    if (stack.length) stack[stack.length - 1].children.push(node); else { if (root) fail(); root = node; }
    if (source.startsWith("/>", pos)) pos += 2; else { pos++; stack.push(node); }
  }
  if (!root || stack.length) return fail();
  return root;
}
/** OOXML literal escapes are decoded once, preserving escaped escape markers. */
export const spreadsheetText = (value: string): string => value.replace(/_x([0-9a-f]{4})_/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
