import { ByteReader } from "./bytes";
import { decodeCodePage } from "./code-page";
import type { CompoundFile } from "./compound-file";

const SUMMARY_STREAM = "\u0005SummaryInformation", STREAM_BYTES = 1024 * 1024, PROPERTIES = 1024, TITLE_UNITS = 4096;
const VT_I2 = 2, VT_LPSTR = 0x1e, VT_LPWSTR = 0x1f, PID_CODEPAGE = 1, PID_TITLE = 2;

/**
 * Reads the title from the summary property set ([MS-OLEPS]). The stream is optional metadata,
 * so a missing or malformed one yields undefined rather than failing the document.
 */
export function readCompoundFileTitle(file: CompoundFile): string | undefined {
  if (!file.has(SUMMARY_STREAM) || file.size(SUMMARY_STREAM) > STREAM_BYTES) return undefined;
  try {
    const bytes = file.read(SUMMARY_STREAM), header = new ByteReader(bytes);
    if (header.u16() !== 0xfffe) return undefined;
    header.skip(22);
    if (header.u32() < 1) return undefined;
    header.skip(16);
    const base = header.u32(), set = new ByteReader(bytes, base);
    set.skip(4);
    const count = set.u32(), offsets = new Map<number, number>();
    if (count > PROPERTIES) return undefined;
    for (let index = 0; index < count; index++) { const id = set.u32(), offset = set.u32(); if (!offsets.has(id)) offsets.set(id, offset); }
    const property = (id: number) => { const offset = offsets.get(id); return offset === undefined ? undefined : new ByteReader(bytes, base + offset); };
    const codePageProperty = property(PID_CODEPAGE), title = property(PID_TITLE);
    const codePage = codePageProperty && (codePageProperty.u32() & 0xffff) === VT_I2 ? codePageProperty.u16() : 1252;
    if (!title) return undefined;
    const type = title.u32() & 0xffff, length = title.u32();
    let text: string;
    if (type === VT_LPWSTR) { if (length > TITLE_UNITS) return undefined; text = title.utf16(length); }
    else if (type === VT_LPSTR) { if (length > TITLE_UNITS * 4) return undefined; text = decodeCodePage(title.take(length), codePage); }
    else return undefined;
    const end = text.indexOf("\u0000");
    text = (end < 0 ? text : text.slice(0, end)).trim();
    return text || undefined;
  } catch { return undefined; }
}
