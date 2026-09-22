import { EncryptedPDFError, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import type { ExplorerUploadContentMetadata, ExplorerUploadInspectFileRequest } from "../model/upload-content";

const inputBytes = 100 * 1024 * 1024, treeNodes = 100_000, treeDepth = 256;
const invalid = (): never => { throw new Error("PDFのページ構造が不正、または安全な読み込み上限を超えています"); };

export async function inspectPdf({ file, signal }: ExplorerUploadInspectFileRequest): Promise<ExplorerUploadContentMetadata> {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > inputBytes)
    throw new Error("PDF情報の確認は100 MiB以下のファイルに対応しています。必要に応じてupload.inspectFileを指定してください");
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  if (bytes.length !== file.size || bytes.length > inputBytes) invalid();
  // Signature checks alone never determine a page count; pdf-lib parses objects
  // and compressed object streams before the page tree is inspected below.
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-" ||
    !new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 1024))).includes("%%EOF")) invalid();
  let document: PDFDocument;
  try { document = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true, parseSpeed: 100 }); }
  catch (error) {
    signal.throwIfAborted();
    // pdf-lib's ES5 build returns a plain Error from this subclass, so compare
    // its library-defined message as well as its prototype.
    if (error instanceof EncryptedPDFError || error instanceof Error && error.message === new EncryptedPDFError().message)
      throw new Error("暗号化・パスワード付きPDFのページ数は確認できません");
    throw error;
  }
  signal.throwIfAborted();
  if (document.isEncrypted || document.context.trailerInfo.Encrypt)
    throw new Error("暗号化・パスワード付きPDFのページ数は確認できません");
  const catalog = document.catalog;
  if (!(catalog instanceof PDFDict) || catalog.lookup(PDFName.of("Type")) !== PDFName.of("Catalog")) invalid();
  const root = catalog.lookup(PDFName.of("Pages"), PDFDict);
  type Frame = { node: PDFDict; depth: number; end?: { expected: number; start: number } };
  const stack: Frame[] = [{ node: root, depth: 0 }], seen = new Set<PDFDict>();
  let pages = 0;
  while (stack.length) {
    signal.throwIfAborted();
    const { node, depth, end } = stack.pop()!;
    if (end) { if (pages - end.start !== end.expected) invalid(); continue; }
    if (seen.has(node) || seen.size >= treeNodes || depth > treeDepth) invalid();
    seen.add(node);
    const type = node.lookup(PDFName.of("Type"));
    if (type === PDFName.of("Page")) pages++;
    else if (type === PDFName.of("Pages")) {
      const kids = node.lookup(PDFName.of("Kids"), PDFArray), expected = node.lookup(PDFName.of("Count"), PDFNumber).asNumber();
      if (!Number.isSafeInteger(expected) || expected < 0 || kids.size() > treeNodes || stack.length + kids.size() > treeNodes) invalid();
      stack.push({ node, depth, end: { expected, start: pages } });
      for (let i = kids.size() - 1; i >= 0; i--) stack.push({ node: kids.lookup(i, PDFDict), depth: depth + 1 });
    } else invalid();
    if (seen.size % 100 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  return { kind: "pdf", pages };
}
