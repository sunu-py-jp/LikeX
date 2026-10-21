import { OFFICE_PACKAGE_LIMITS, type OfficePackageSignal } from "./types";
import type { XmlNode } from "./xml";

export type XmlStreamOptions = {
  signal?: OfficePackageSignal;
  limits?: Partial<{
    xmlBytes: number;
    xmlDepth: number;
    /** Counts every visited element, including elements subsequently discarded. */
    xmlNodes: number;
    xmlText: number;
    /** Bounds the live tree independently of the visited-element budget. */
    retainedNodes: number;
    /** Bounds a single text, tag, comment, CDATA, or processing-instruction token. */
    tokenCharacters: number;
  }>;
  /** Called after validation of a complete element. Return false to discard it.
   * Ancestors exclude the element itself; the last ancestor is its parent.
   * The document root cannot be discarded. Attributes may be normalized by the
   * consumer; names, text, and children must not be mutated. Limits count the
   * original input, not attribute values supplied by the consumer.
   */
  onElement?: (node: XmlNode, parent: XmlNode | undefined, ancestors: readonly XmlNode[]) => boolean | void;
};

const fail = (): never => { throw new Error("Office内のXMLが不正、または安全な読み込み上限を超えています"); };
const namedEntities: Readonly<Record<string, string>> = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" });
function entities(value: string): string {
  return value.replace(/&([^;]*);|&/g, (_match, entity: string | undefined) => {
    if (entity && Object.hasOwn(namedEntities, entity)) return namedEntities[entity];
    if (!entity || !/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) return fail();
    const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(code) || code > 0x10ffff || (code < 32 && ![9, 10, 13].includes(code)) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) return fail();
    return String.fromCodePoint(code);
  });
}

/** An abort must not wait for a stalled producer. Both promise outcomes remain observed. */
function abortable<T>(operation: Promise<T>, signal: OfficePackageSignal | undefined): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

/** Incremental, DOM-free XML parsing. Discarded subtrees are still fully validated.
 * Decoded input and individual tokens are bounded; only retained nodes form a tree.
 * No DTD, entity declarations, external resolution, or recursive parser is used.
 */
export async function parseXmlStream(chunks: AsyncIterable<Uint8Array>, options: XmlStreamOptions = {}): Promise<XmlNode> {
  const limits = {
    xmlBytes: OFFICE_PACKAGE_LIMITS.xmlBytes,
    xmlDepth: OFFICE_PACKAGE_LIMITS.xmlDepth,
    xmlNodes: OFFICE_PACKAGE_LIMITS.xmlNodes,
    xmlText: OFFICE_PACKAGE_LIMITS.xmlText,
    retainedNodes: OFFICE_PACKAGE_LIMITS.xmlNodes,
    tokenCharacters: OFFICE_PACKAGE_LIMITS.xmlBytes,
    ...options.limits,
  };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 0)) fail();
  const signal = options.signal;
  signal?.throwIfAborted();
  const stack: { node: XmlNode; size: number }[] = [];
  let root: XmlNode | undefined, visitedNodes = 0, retainedNodes = 0, characters = 0;
  const append = (value: string) => {
    characters += value.length;
    if (characters > limits.xmlText) fail();
    if (stack.length) stack[stack.length - 1].node.text += value;
    else if (value.trim()) fail();
  };
  const close = () => {
    const frame = stack.pop();
    if (!frame) return fail();
    const parent = stack[stack.length - 1];
    const keep = options.onElement?.(frame.node, parent?.node, stack.map(item => item.node)) !== false;
    signal?.throwIfAborted();
    if (!keep) {
      if (!parent) fail();
      parent.node.children.pop();
      retainedNodes -= frame.size;
    } else if (parent) parent.size += frame.size;
  };
  const tag = (source: string) => {
    let pos = 1;
    const namePattern = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
    const space = () => { while (pos < source.length && /\s/.test(source[pos])) pos++; };
    const name = () => {
      namePattern.lastIndex = pos;
      const match = namePattern.exec(source);
      if (!match) return fail();
      pos = namePattern.lastIndex;
      return match[0];
    };
    if (source[pos] === "/") {
      pos++;
      const closing = name();
      space();
      if (source[pos++] !== ">" || pos !== source.length || stack[stack.length - 1]?.node.name !== closing) fail();
      close();
      return;
    }
    const node: XmlNode = { name: name(), attributes: Object.create(null), children: [], text: "" };
    if (++visitedNodes > limits.xmlNodes || ++retainedNodes > limits.retainedNodes || stack.length >= limits.xmlDepth) fail();
    let attributeCount = 0;
    while (true) {
      const before = pos;
      space();
      if (source[pos] === ">" || source.startsWith("/>", pos)) break;
      if (before === pos) fail();
      const key = name();
      space();
      if (source[pos++] !== "=") fail();
      space();
      const quote = source[pos++];
      if (quote !== '"' && quote !== "'") fail();
      const end = source.indexOf(quote, pos);
      if (end < 0) fail();
      const value = source.slice(pos, end);
      if (value.includes("<") || Object.hasOwn(node.attributes, key)) fail();
      characters += value.length;
      if (characters > limits.xmlText || ++attributeCount > 100) fail();
      node.attributes[key] = entities(value);
      pos = end + 1;
    }
    const selfClosing = source.startsWith("/>", pos);
    pos += selfClosing ? 2 : 1;
    if (pos !== source.length) fail();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else {
      if (root) fail();
      root = node;
    }
    stack.push({ node, size: 1 });
    if (selfClosing) close();
  };

  type Mode = "text" | "markup" | "tag" | "comment" | "cdata" | "pi";
  let mode: Mode = "text", prefix = "", quote = "", tail = "";
  let parts: string[] = [], tokenLength = 0, sourceOffset = 0, tokenOffset = 0;
  const addPart = (part: string) => {
    if (!part) return;
    tokenLength += part.length;
    if (tokenLength > limits.tokenCharacters) fail();
    const last = parts.length - 1;
    if (last >= 0 && parts[last].length + part.length <= 65_536) parts[last] += part;
    else parts.push(part);
  };
  const finish = () => {
    const token = parts.join("");
    parts = []; tokenLength = 0;
    if (mode === "text") {
      if (token.includes("]]>")) fail();
      append(entities(token));
    } else if (mode === "comment") {
      if (token.slice(4, -3).includes("--")) fail();
    } else if (mode === "cdata") {
      if (!stack.length) fail();
      append(token.slice(9, -3));
    } else if (mode === "pi") {
      if (/^<\?xml\s/i.test(token) && (root || tokenOffset !== 0)) fail();
    } else if (mode === "tag") tag(token);
    else fail();
  };
  const consume = (source: string) => {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(source)) fail();
    let start = 0;
    for (let index = 0; index < source.length; index++) {
      const value = source[index];
      if (mode === "text") {
        if (value !== "<") continue;
        addPart(source.slice(start, index));
        finish();
        mode = "markup"; prefix = "<"; quote = ""; tail = "";
        tokenOffset = sourceOffset + index;
        start = index;
        continue;
      }
      let complete = false;
      if (mode === "markup") {
        prefix += value;
        if (prefix === "<?") mode = "pi";
        else if (prefix === "<!--") mode = "comment";
        else if (prefix === "<![CDATA[") mode = "cdata";
        else if (prefix.startsWith("<!")) {
          if (!"<!--".startsWith(prefix) && !"<![CDATA[".startsWith(prefix)) fail();
        } else {
          mode = "tag";
          if (value === '"' || value === "'") quote = value;
          else complete = value === ">";
        }
      } else if (mode === "tag") {
        if (quote) { if (value === quote) quote = ""; }
        else if (value === '"' || value === "'") quote = value;
        else complete = value === ">";
      } else {
        tail = (tail + value).slice(-3);
        complete = mode === "comment" ? tail === "-->" : mode === "cdata" ? tail === "]]>" : tail.endsWith("?>");
      }
      if (complete) {
        addPart(source.slice(start, index + 1));
        finish();
        mode = "text";
        start = index + 1;
      }
    }
    addPart(source.slice(start));
    sourceOffset += source.length;
  };

  let decoder: TextDecoder | undefined, firstByte: number | undefined, previousCR = false;
  let bytesRead = 0, sinceYield = 0;
  const decode = (bytes: Uint8Array, final = false) => {
    let source: string;
    try { source = decoder!.decode(bytes, { stream: !final }); }
    catch { return fail(); }
    if (!source) return;
    const endsCR = source.endsWith("\r");
    if (previousCR && source[0] === "\n") source = source.slice(1);
    previousCR = endsCR;
    consume(source.replace(/\r\n?/g, "\n"));
  };
  const iterator = chunks[Symbol.asyncIterator]();
  let exhausted = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const item = await abortable(Promise.resolve().then(() => { signal?.throwIfAborted(); return iterator.next(); }), signal);
      if (item.done) { exhausted = true; break; }
      const chunk = item.value;
      bytesRead += chunk.byteLength;
      if (bytesRead > limits.xmlBytes) fail();
      for (let start = 0; start < chunk.byteLength; start += 65_536) {
        signal?.throwIfAborted();
        const bytes = chunk.subarray(start, Math.min(start + 65_536, chunk.byteLength));
        if (!decoder) {
          if (firstByte !== undefined) {
            const encoding = firstByte === 0xff && bytes[0] === 0xfe ? "utf-16le" : firstByte === 0xfe && bytes[0] === 0xff ? "utf-16be" : "utf-8";
            decoder = new TextDecoder(encoding, { fatal: true });
            decode(new Uint8Array([firstByte]));
          } else if (bytes.length === 1) { firstByte = bytes[0]; continue; }
          else {
            const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
            decoder = new TextDecoder(encoding, { fatal: true });
          }
        }
        decode(bytes);
        sinceYield += bytes.length;
        if (sinceYield >= 262_144) {
          sinceYield = 0;
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          signal?.throwIfAborted();
        }
      }
    }
    if (!decoder) {
      decoder = new TextDecoder("utf-8", { fatal: true });
      if (firstByte !== undefined) decode(new Uint8Array([firstByte]));
    }
    decode(new Uint8Array(), true);
    if (mode !== "text") fail();
    finish();
    signal?.throwIfAborted();
    if (!root || stack.length) return fail();
    return root;
  } finally {
    if (!exhausted && iterator.return) {
      // A producer's pending next()/return() must not hold up cancellation.
      try { void Promise.resolve(iterator.return()).catch(() => {}); } catch { /* Preserve the parsing error. */ }
    }
  }
}
