import { checkedText, TEXT_EDITOR_LIMITS } from "./validation";

/** Decode complete files. BOMs take precedence; BOM-free invalid UTF-8 falls back to Shift_JIS. */
export function decodeTextEditorBytes(input: Uint8Array | ArrayBuffer): string {
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) throw new TypeError("ファイルの内容をUint8ArrayまたはArrayBufferで指定してください。");
  if (input.byteLength > TEXT_EDITOR_LIMITS.fileBytes) throw new RangeError("ファイルのサイズが40,000,000バイトの上限を超えています。");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be"
    : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "utf-8" : undefined;
  let text: string;
  if (bom) {
    // A malformed explicitly encoded file must not be reinterpreted as another encoding.
    text = new TextDecoder(bom, { fatal: true }).decode(bytes);
  } else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder("shift_jis", { fatal: true }).decode(bytes); }
  }
  return checkedText(text);
}
