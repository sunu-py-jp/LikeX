import { PdfBudget, invalidPdf, pdfLimit } from "./pdf-budget";
import { decodePdfStream } from "./pdf-filters";
import { PdfLexer } from "./pdf-lexer";
import { isPdfName, isPdfRef, pdfDict, pdfInteger, type PdfDict, type PdfRef, type PdfValue } from "./pdf-values";

type XrefEntry = { type: 0; generation: number } | { type: 1; generation: number; offset: number }
  | { type: 2; generation: 0; stream: number; index: number };
type Section = { entries: Map<number, XrefEntry>; trailer: PdfDict };
type Indirect = { value: PdfValue; reference: PdfRef; stream?: Uint8Array };
type ObjectStream = { bytes: Uint8Array; first: number; objects: number[]; offsets: number[] };
const whitespace = (byte: number | undefined) => byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
const referenceKey = (ref: PdfRef) => `${ref.object}:${ref.generation}`;
const encrypted = (): never => { throw new Error("暗号化・パスワード付きPDFのページ数は確認できません"); };

/** Resolves only the catalog/page-tree and the indexing streams needed to reach them. */
class PdfMetadataDocument {
  private readonly xref = new Map<number, XrefEntry>();
  private readonly sections = new Set<number>();
  private readonly values = new Map<string, PdfValue>();
  private readonly activeReferences = new Set<string>();
  private readonly objectStreams = new Map<number, ObjectStream>();
  private readonly activeStreams = new Set<number>();
  private xrefEntries = 0;
  private streamMembers = 0;
  private root: PdfValue | undefined;
  constructor(private readonly bytes: Uint8Array, private readonly budget: PdfBudget) {}

  private matches(offset: number, text: string): boolean {
    if (offset < 0 || text.length > this.bytes.length - offset) return false;
    for (let index = 0; index < text.length; index++) if (this.bytes[offset + index] !== text.charCodeAt(index)) return false;
    return true;
  }

  private async startXref(): Promise<number> {
    if (!this.matches(0, "%PDF-")) invalidPdf("PDFヘッダーがありません");
    let end = this.bytes.length;
    while (end > 0 && whitespace(this.bytes[end - 1])) { this.budget.work(); end--; await this.budget.checkpoint(); }
    if (!this.matches(end - 5, "%%EOF")) invalidPdf("PDFの終端がありません");
    const eof = end - 5, minimum = Math.max(0, eof - this.budget.limits.startXrefSearchBytes);
    for (let at = eof - 9; at >= minimum; at--) {
      this.budget.work(); await this.budget.checkpoint();
      if (!this.matches(at, "startxref") || at > 0 && !whitespace(this.bytes[at - 1])) continue;
      const lexer = new PdfLexer(this.bytes, this.budget, at, eof);
      if (!await lexer.consume("startxref")) continue;
      const offset = await lexer.integer(this.bytes.length - 1);
      if (!await lexer.atEnd()) invalidPdf("最終参照位置が不正です");
      return offset;
    }
    return invalidPdf("最終参照位置がありません");
  }

  private beginSection(offset: number): void {
    if (this.sections.has(offset)) invalidPdf("参照テーブルが循環しています");
    if (this.sections.size >= this.budget.limits.sections) pdfLimit();
    this.sections.add(offset);
  }

  private addEntry(entries: Map<number, XrefEntry>, object: number, entry: XrefEntry): void {
    this.budget.work();
    if (++this.xrefEntries > this.budget.limits.xrefEntries) pdfLimit();
    if (entries.has(object)) invalidPdf("参照テーブルの項目が重複しています");
    entries.set(object, entry);
  }

  private acceptTrailer(dict: PdfDict): void {
    const encryption = dict.get("Encrypt");
    if (encryption !== undefined && encryption !== null) encrypted();
    if (this.root === undefined && dict.has("Root")) this.root = dict.get("Root");
  }

  private async readClassic(lexer: PdfLexer): Promise<Section> {
    const entries = new Map<number, XrefEntry>();
    while (!await lexer.consume("trailer")) {
      const first = await lexer.integer(), count = await lexer.integer(this.budget.limits.xrefEntries);
      if (count > this.budget.limits.xrefEntries - this.xrefEntries || first > Number.MAX_SAFE_INTEGER - count) pdfLimit();
      for (let index = 0; index < count; index++) {
        const offset = await lexer.integer(), generation = await lexer.integer(65535), flag = await lexer.word();
        if (flag !== "f" && flag !== "n") invalidPdf("参照テーブルの種類が不正です");
        if (flag === "n" && offset >= this.bytes.length) invalidPdf("オブジェクトの位置が不正です");
        this.addEntry(entries, first + index, flag === "f" ? { type: 0, generation } : { type: 1, generation, offset });
        await this.budget.checkpoint();
      }
    }
    const trailer = pdfDict(await lexer.value()), size = pdfInteger(trailer.get("Size"));
    for (const object of entries.keys()) {
      this.budget.work();
      if (object >= size) invalidPdf("参照テーブルのサイズが不正です");
      await this.budget.checkpoint();
    }
    return { entries, trailer };
  }

  private async indirect(offset: number, expected?: PdfRef, allowStream = false, bootstrap = false): Promise<Indirect> {
    const lexer = new PdfLexer(this.bytes, this.budget, offset);
    const object = await lexer.integer(), generation = await lexer.integer(65535);
    if (!object || expected && (object !== expected.object || generation !== expected.generation) || !await lexer.consume("obj"))
      invalidPdf("参照先のオブジェクト番号が一致しません");
    const reference: PdfRef = { kind: "ref", object, generation }, value = await lexer.value();
    if (!await lexer.consume("stream")) {
      if (!await lexer.consume("endobj")) invalidPdf("オブジェクトの終端がありません");
      return { reference, value };
    }
    if (!allowStream || !(value instanceof Map)) invalidPdf("必要な辞書の代わりにストリームがあります");
    // The stream delimiter's EOL is not part of Length. Never search binary data
    // for endstream: compressed/image bytes may contain a misleading delimiter.
    if (this.bytes[lexer.offset] === 13) { lexer.offset++; if (this.bytes[lexer.offset] === 10) lexer.offset++; }
    else if (this.bytes[lexer.offset] === 10) lexer.offset++;
    else invalidPdf("ストリーム開始の改行がありません");
    let lengthValue = value.get("Length");
    if (isPdfRef(lengthValue)) {
      if (bootstrap && !this.xref.has(lengthValue.object)) invalidPdf("最初の参照ストリームの間接Lengthは内蔵検査に対応していません");
      lengthValue = await this.dereference(lengthValue);
    }
    const length = pdfInteger(lengthValue, this.bytes.length);
    if (length > this.bytes.length - lexer.offset) invalidPdf("ストリームが途中で終わっています");
    const stream = this.bytes.subarray(lexer.offset, lexer.offset + length);
    lexer.offset += length;
    if (!await lexer.consume("endstream") || !await lexer.consume("endobj")) invalidPdf("ストリームの長さまたは終端が不正です");
    return { reference, value, stream };
  }

  private async readXrefStream(offset: number): Promise<Section> {
    const object = await this.indirect(offset, undefined, true, true), dict = pdfDict(object.value);
    if (!isPdfName(dict.get("Type"), "XRef") || !object.stream) invalidPdf("参照ストリームが必要です");
    const size = pdfInteger(dict.get("Size")), widths = dict.get("W"), index = dict.get("Index") ?? [0, size];
    if (!Array.isArray(widths) || widths.length !== 3 || !Array.isArray(index) || index.length % 2 || index.length / 2 > this.budget.limits.xrefEntries)
      invalidPdf("参照ストリームの項目指定が不正です");
    const fieldWidths = widths.map(value => pdfInteger(value, 8)), rowWidth = fieldWidths.reduce((sum, value) => sum + value, 0);
    if (!rowWidth) invalidPdf("参照ストリームの項目幅が不正です");
    const sections: { first: number; count: number }[] = [];
    let rows = 0;
    for (let at = 0; at < index.length; at += 2) {
      const first = pdfInteger(index[at]), count = pdfInteger(index[at + 1], this.budget.limits.xrefEntries);
      if (first > size || count > size - first || count > this.budget.limits.xrefEntries - this.xrefEntries - rows) pdfLimit();
      rows += count; sections.push({ first, count }); this.budget.work(); await this.budget.checkpoint();
    }
    const expectedBytes = rows * rowWidth;
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes > this.budget.limits.streamBytes) pdfLimit();
    // XRef dictionary entries used to bootstrap resolution, including filters,
    // must be direct. The decoder validates Filter/DecodeParms without resolving.
    const decoded = await decodePdfStream(object.stream!, dict, this.budget);
    if (decoded.length !== expectedBytes) invalidPdf("参照ストリームの長さが項目数と一致しません");
    const entries = new Map<number, XrefEntry>();
    let at = 0;
    const field = (width: number): number => {
      let value = 0;
      for (let index = 0; index < width; index++) {
        const byte = decoded[at++];
        if (value > Math.floor((Number.MAX_SAFE_INTEGER - byte) / 256)) invalidPdf("参照ストリームの数値が大きすぎます");
        value = value * 256 + byte;
      }
      return value;
    };
    for (const section of sections) for (let index = 0; index < section.count; index++) {
      this.budget.work(rowWidth);
      const type = fieldWidths[0] ? field(fieldWidths[0]) : 1, second = field(fieldWidths[1]), third = field(fieldWidths[2]);
      let entry: XrefEntry;
      if (type === 1) {
        if (second >= this.bytes.length || third > 65535) invalidPdf("参照先または世代が不正です");
        entry = { type: 1, offset: second, generation: third };
      } else if (type === 2) {
        if (!second || third >= this.budget.limits.objectStreamObjects) invalidPdf("圧縮オブジェクトの参照が不正です");
        entry = { type: 2, stream: second, index: third, generation: 0 };
      } else {
        if (type === 0 && third > 65535) invalidPdf("参照の世代が不正です");
        // Unknown entry types resolve to null, and still hide older revisions.
        entry = { type: 0, generation: type === 0 ? third : 0 };
      }
      this.addEntry(entries, section.first + index, entry);
      await this.budget.checkpoint();
    }
    return { entries, trailer: dict };
  }

  async initialize(): Promise<void> {
    let offset: number | undefined = await this.startXref();
    while (offset !== undefined) {
      this.beginSection(offset);
      const lexer: PdfLexer = new PdfLexer(this.bytes, this.budget, offset);
      const classic: boolean = await lexer.consume("xref");
      const section: Section = classic ? await this.readClassic(lexer) : await this.readXrefStream(offset);
      this.acceptTrailer(section.trailer);
      if (classic && section.trailer.has("XRefStm")) {
        const hybridOffset = pdfInteger(section.trailer.get("XRefStm"), this.bytes.length - 1);
        this.beginSection(hybridOffset);
        const hybrid = await this.readXrefStream(hybridOffset);
        this.acceptTrailer(hybrid.trailer);
        // The hybrid stream supplements and overrides the table in this revision.
        // Its Prev is ignored; follow the table's Prev after the combined section.
        for (const [object, entry] of hybrid.entries) { this.budget.work(); section.entries.set(object, entry); await this.budget.checkpoint(); }
      }
      for (const [object, entry] of section.entries) {
        this.budget.work();
        if (!this.xref.has(object)) this.xref.set(object, entry);
        await this.budget.checkpoint();
      }
      offset = section.trailer.has("Prev") ? pdfInteger(section.trailer.get("Prev"), this.bytes.length - 1) : undefined;
      await this.budget.checkpoint();
    }
    if (this.root === undefined) invalidPdf("文書カタログの参照がありません");
  }

  private async resolve(ref: PdfRef): Promise<PdfValue> {
    this.budget.work();
    const key = referenceKey(ref);
    if (this.values.has(key)) return this.values.get(key)!;
    if (this.activeReferences.has(key)) invalidPdf("間接参照が循環しています");
    if (this.activeReferences.size >= this.budget.limits.depth || this.values.size >= this.budget.limits.objects) pdfLimit();
    const entry = this.xref.get(ref.object);
    if (!entry || entry.type === 0 || entry.generation !== ref.generation) return null;
    this.activeReferences.add(key);
    try {
      let value: PdfValue;
      if (entry.type === 1) value = (await this.indirect(entry.offset, ref)).value;
      else {
        const stream = await this.objectStream(entry.stream);
        if (entry.index >= stream.objects.length || stream.objects[entry.index] !== ref.object) invalidPdf("圧縮オブジェクトの番号が一致しません");
        const start = stream.first + stream.offsets[entry.index], end = entry.index + 1 < stream.offsets.length
          ? stream.first + stream.offsets[entry.index + 1] : stream.bytes.length;
        const lexer = new PdfLexer(stream.bytes, this.budget, start, end);
        value = await lexer.value();
        if (!await lexer.atEnd()) invalidPdf("圧縮オブジェクトの範囲が不正です");
      }
      // Nested Length/filter references may have populated the cache meanwhile.
      if (this.values.size >= this.budget.limits.objects) pdfLimit();
      this.values.set(key, value);
      return value;
    } finally { this.activeReferences.delete(key); }
  }

  private async dereference(value: PdfValue | undefined): Promise<PdfValue | undefined> {
    const seen = new Set<string>();
    while (isPdfRef(value)) {
      const key = referenceKey(value);
      if (seen.has(key)) invalidPdf("間接参照が循環しています");
      if (seen.size >= this.budget.limits.depth) pdfLimit();
      seen.add(key); value = await this.resolve(value);
    }
    return value;
  }

  private async directParameters(value: PdfValue, depth = 0, references = new Set<string>()): Promise<PdfValue> {
    // Resolving repeated references can expand a compact graph into many values.
    // Charge the copied value count, not just traversal work, before allocation.
    this.budget.value();
    if (depth > this.budget.limits.depth) pdfLimit();
    await this.budget.checkpoint();
    if (isPdfRef(value)) {
      const key = referenceKey(value);
      if (references.has(key)) invalidPdf("ストリームの復号設定が循環しています");
      references.add(key);
      try { return await this.directParameters(await this.resolve(value), depth + 1, references); }
      finally { references.delete(key); }
    }
    if (Array.isArray(value)) {
      const result: PdfValue[] = [];
      for (const item of value) { result.push(await this.directParameters(item, depth + 1, references)); await this.budget.checkpoint(); }
      return result;
    }
    if (value instanceof Map) {
      const result: PdfDict = new Map();
      for (const [key, item] of value) { result.set(key, await this.directParameters(item, depth + 1, references)); await this.budget.checkpoint(); }
      return result;
    }
    return value;
  }

  private async objectStream(object: number): Promise<ObjectStream> {
    const cached = this.objectStreams.get(object);
    if (cached) return cached;
    if (this.activeStreams.has(object)) invalidPdf("圧縮オブジェクトの参照が循環しています");
    if (this.activeStreams.size >= this.budget.limits.depth || this.objectStreams.size >= this.budget.limits.objects) pdfLimit();
    const entry = this.xref.get(object);
    if (!entry || entry.type !== 1 || entry.generation !== 0) invalidPdf("オブジェクトストリームの参照が不正です");
    this.activeStreams.add(object);
    try {
      const indirect = await this.indirect(entry.offset, { kind: "ref", object, generation: 0 }, true), dict = pdfDict(indirect.value);
      if (!isPdfName(await this.dereference(dict.get("Type")), "ObjStm") || !indirect.stream) invalidPdf("オブジェクトストリームが必要です");
      const count = pdfInteger(await this.dereference(dict.get("N")), this.budget.limits.objectStreamObjects), first = pdfInteger(await this.dereference(dict.get("First")), this.budget.limits.streamBytes);
      if (count > this.budget.limits.objectStreamObjects - this.streamMembers) pdfLimit();
      this.streamMembers += count;
      const parameters = new Map(dict);
      for (const name of ["Filter", "DecodeParms"]) if (parameters.has(name)) parameters.set(name, await this.directParameters(parameters.get(name)!));
      const decoded = await decodePdfStream(indirect.stream!, parameters, this.budget);
      if (first > decoded.length) invalidPdf("圧縮オブジェクトの開始位置が不正です");
      const header = new PdfLexer(decoded, this.budget, 0, first), objects: number[] = [], offsets: number[] = [], seen = new Set<number>();
      for (let index = 0; index < count; index++) {
        const id = await header.integer(), at = await header.integer(decoded.length - first);
        if (!id || seen.has(id) || at >= decoded.length - first || index > 0 && at <= offsets[index - 1]) invalidPdf("圧縮オブジェクトの位置または番号が不正です");
        seen.add(id); objects.push(id); offsets.push(at); await this.budget.checkpoint();
      }
      if (!await header.atEnd()) invalidPdf("圧縮オブジェクトのヘッダー長が不正です");
      const result = { bytes: decoded, first, objects, offsets };
      if (this.objectStreams.size >= this.budget.limits.objects) pdfLimit();
      this.objectStreams.set(object, result);
      return result;
    } finally { this.activeStreams.delete(object); }
  }

  async pageCount(): Promise<number> {
    const catalog = pdfDict(await this.dereference(this.root));
    if (!isPdfName(await this.dereference(catalog.get("Type")), "Catalog")) invalidPdf("文書カタログが不正です");
    type Frame = { value: PdfValue | undefined; depth: number } | { expected: number; start: number };
    const stack: Frame[] = [{ value: catalog.get("Pages"), depth: 0 }], seen = new Set<PdfDict>();
    let pages = 0;
    while (stack.length) {
      this.budget.work(); await this.budget.checkpoint();
      const frame = stack.pop()!;
      if ("expected" in frame) { if (pages - frame.start !== frame.expected) invalidPdf("ページ数とページツリーが一致しません"); continue; }
      const node = pdfDict(await this.dereference(frame.value));
      if (seen.has(node)) invalidPdf("ページツリーが循環、またはページが重複しています");
      if (seen.size >= this.budget.limits.treeNodes || frame.depth > this.budget.limits.treeDepth) pdfLimit();
      seen.add(node);
      const type = await this.dereference(node.get("Type"));
      if (isPdfName(type, "Page")) { pages++; continue; }
      if (!isPdfName(type, "Pages")) invalidPdf("ページツリーの種類が不正です");
      const kids = await this.dereference(node.get("Kids")), expected = pdfInteger(await this.dereference(node.get("Count")), this.budget.limits.treeNodes);
      if (!Array.isArray(kids)) invalidPdf("ページ一覧が不正です");
      if (kids.length > this.budget.limits.treeNodes || kids.length >= this.budget.limits.treeNodes - stack.length) pdfLimit();
      stack.push({ expected, start: pages });
      for (let index = kids.length - 1; index >= 0; index--) { this.budget.work(); stack.push({ value: kids[index], depth: frame.depth + 1 }); await this.budget.checkpoint(); }
    }
    return pages;
  }
}

export async function readPdfPageCount(bytes: Uint8Array, budget: PdfBudget): Promise<number> {
  budget.work();
  if (!bytes.length || bytes.length > budget.limits.inputBytes) pdfLimit();
  const document = new PdfMetadataDocument(bytes, budget);
  await document.initialize();
  return document.pageCount();
}
