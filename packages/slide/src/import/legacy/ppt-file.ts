import { ByteReader, officeArtRecordAt, officeArtRecords, type CompoundFile, type OfficeArtRecord } from "../../core";

/**
 * Container-level structures of a PowerPoint 97–2003 presentation ([MS-PPT]). Its records use
 * the same eight-byte header as Office drawing records, so both share one record reader.
 */
export const fail = (message: string): never => { throw new Error(`PowerPointを読み込めません: ${message}`); };
export const RT = Object.freeze({
  document: 0x03e8, documentAtom: 0x03e9, slide: 0x03ee, slideAtom: 0x03ef, notes: 0x03f0, notesAtom: 0x03f1, environment: 0x03f2, slidePersist: 0x03f3,
  mainMaster: 0x03f8, slideShowInfo: 0x03f9, drawingGroup: 0x040b, drawing: 0x040c, colorScheme: 0x07f0, fontCollection: 0x07d5, placeholder: 0x0bc3,
  outlineTextReference: 0x0f9e, textHeader: 0x0f9f, textCharacters: 0x0fa0, styleTextProperties: 0x0fa1, textMasterStyle: 0x0fa3, textBytes: 0x0fa8,
  fontEntity: 0x0fb7, slideList: 0x0ff0, userEdit: 0x0ff5, currentUser: 0x0ff6, animationInfo: 0x1014, programTags: 0x1388, persistDirectory: 0x1772, connectorRule: 0xf012,
});
export type PptSlideEntry = { persist: number; slideId: number; texts: OfficeArtRecord[][] };
export type PptFile = {
  document: Uint8Array; pictures: Uint8Array | undefined;
  /** Records directly inside a container record. */
  children(record: OfficeArtRecord): OfficeArtRecord[];
  /** The live record of a persist object, or undefined when the directory does not list it. */
  persist(id: number): OfficeArtRecord | undefined;
  documentRecord: OfficeArtRecord;
  slides: PptSlideEntry[]; masters: PptSlideEntry[]; notes: PptSlideEntry[];
};
const MAX_EDITS = 10_000;

/**
 * Opens the streams and resolves which copy of every object is current. A presentation is
 * appended to on each save, so only the persist directories of the edit chain say what is live.
 */
export function openPptFile(file: CompoundFile): PptFile {
  if (!file.has("PowerPoint Document") || !file.has("Current User")) return fail(".ppt形式（PowerPoint 97–2003）のプレゼンテーションではありません");
  const document = file.read("PowerPoint Document"), user = file.read("Current User"), view = new DataView(document.buffer, document.byteOffset, document.byteLength);
  const current = officeArtRecords(user)[0];
  if (!current || current.type !== RT.currentUser || current.end - current.start < 12) return fail("プレゼンテーションの構造が不正です");
  const head = new ByteReader(user, current.start, current.end);
  head.skip(4);
  if (head.u32() === 0xf3d1c4df) return fail("パスワードで保護または暗号化されたファイルには対応していません");
  const recordAt = (offset: number): OfficeArtRecord | undefined => officeArtRecordAt(document, offset);
  // Follow the chain of edits from the newest to the oldest, then apply them oldest first.
  const edits: OfficeArtRecord[] = [], seen = new Set<number>();
  for (let offset = head.u32(); offset && !seen.has(offset) && edits.length < MAX_EDITS;) {
    seen.add(offset);
    const edit = recordAt(offset);
    if (!edit || edit.type !== RT.userEdit || edit.end - edit.start < 28) return fail("プレゼンテーションの構造が不正です");
    if (edit.end - edit.start >= 32) return fail("パスワードで保護または暗号化されたファイルには対応していません");
    edits.unshift(edit);
    offset = view.getUint32(edit.start + 8, true);
  }
  if (!edits.length) return fail("プレゼンテーションの構造が不正です");
  const offsets = new Map<number, number>();
  for (const edit of edits) {
    const directory = recordAt(view.getUint32(edit.start + 12, true));
    if (!directory || directory.type !== RT.persistDirectory) return fail("プレゼンテーションの構造が不正です");
    const reader = new ByteReader(document, directory.start, directory.end);
    while (reader.remaining >= 4) {
      const entry = reader.u32(), first = entry & 0xfffff, count = entry >>> 20;
      for (let index = 0; index < count && reader.remaining >= 4; index++) offsets.set(first + index, reader.u32());
    }
  }
  const persist = (id: number) => { const offset = offsets.get(id); return offset === undefined ? undefined : recordAt(offset); };
  const children = (record: OfficeArtRecord) => officeArtRecords(document, record.start, record.end);
  const documentRecord = persist(view.getUint32(edits.at(-1)!.start + 16, true));
  if (!documentRecord || documentRecord.type !== RT.document) return fail("プレゼンテーションの構造が不正です");
  // Slide lists name each slide's persist object; the text of its placeholders follows the entry.
  const lists: PptSlideEntry[][] = [[], [], []];
  for (const list of children(documentRecord).filter(record => record.type === RT.slideList)) {
    const target = lists[list.instance];
    if (!target) continue;
    for (const record of children(list)) {
      if (record.type === RT.slidePersist && record.end - record.start >= 16) target.push({ persist: view.getUint32(record.start, true), slideId: view.getUint32(record.start + 12, true), texts: [] });
      else if (target.length) { const entry = target.at(-1)!; if (record.type === RT.textHeader) entry.texts.push([record]); else entry.texts.at(-1)?.push(record); }
    }
  }
  return { document, pictures: file.has("Pictures") ? file.read("Pictures") : undefined, children, persist, documentRecord, slides: lists[0], masters: lists[1], notes: lists[2] };
}
