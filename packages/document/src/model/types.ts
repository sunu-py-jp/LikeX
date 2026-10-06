import type { ConnectorEndpoint, ConnectorArrowhead } from "./core-connectors";
import type { OfficeShapePreset } from "./core-office-shapes";
/** Standard .dcon files contain this JSON model; measurements use mm, except image pixels and font points. */
export type DocumentAlignment = "left" | "center" | "right" | "justify";
export type DocumentPage = {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
};
/** A section delimited by explicit page_break nodes, in ProseMirror positions. */
export type DocumentPageInfo = Readonly<{ pageNumber: number; from: number; to: number }>;
export type DocumentTextStyle = {
  fontFamily?: string | null;
  fontSize?: number | null;
  color?: string | null;
  backgroundColor?: string | null;
};
export type DocumentMarkName = "strong" | "em" | "underline" | "strike" | "text_style" | "link";
export type DocumentMark =
  | { type: "strong" | "em" | "underline" | "strike" }
  | { type: "text_style"; attrs?: DocumentTextStyle }
  | { type: "link"; attrs: { href: string; title?: string | null } };
export type DocumentTextNode = { type: "text"; text: string; marks?: DocumentMark[] };
export type DocumentInlineNode = DocumentTextNode | { type: "hard_break"; marks?: DocumentMark[] };
export type DocumentParagraphNode = {
  type: "paragraph";
  attrs?: { id?: string | null; align?: DocumentAlignment };
  content?: DocumentInlineNode[];
};
export type DocumentHeadingNode = {
  type: "heading";
  attrs?: { id?: string | null; align?: DocumentAlignment; level?: number };
  content?: DocumentInlineNode[];
};
export type DocumentListItemNode = { type: "list_item"; attrs?: { id?: string | null }; content: DocumentBlock[] };
export type DocumentListNode =
  | { type: "bullet_list"; attrs?: { id?: string | null }; content: DocumentListItemNode[] }
  | { type: "ordered_list"; attrs?: { id?: string | null; order?: number }; content: DocumentListItemNode[] };
export type DocumentTableCellNode = {
  type: "table_cell" | "table_header";
  attrs?: { id?: string | null; colspan?: number; rowspan?: number; colwidth?: number[] | null; backgroundColor?: string | null };
  content: DocumentBlock[];
};
export type DocumentTableRowNode = { type: "table_row"; attrs?: { id?: string | null }; content: DocumentTableCellNode[] };
export type DocumentTableNode = { type: "table"; attrs?: { id?: string | null }; content: DocumentTableRowNode[] };
export type DocumentImageNode = {
  type: "image";
  attrs: { id?: string | null; src: string; alt?: string; width?: number; height?: number };
};
/** Editable Office preset shape. Dimensions and stroke width use pixels; rotation uses degrees. */
export type DocumentShapeAttributes = {
  id?: string | null; preset: OfficeShapePreset; text?: string; width?: number; height?: number;
  fill?: string | null; stroke?: string | null; strokeWidth?: number; rotation?: number;
  flipH?: boolean; flipV?: boolean; color?: string; fontSize?: number;
};
export type DocumentShapeNode = { type: "shape"; attrs: DocumentShapeAttributes };
/** Canvas coordinates use pixels. Bindings always reference a shape in the same canvas. */
export type DocumentCanvasShape = Omit<DocumentShapeAttributes, "id"> & { id: string; x: number; y: number };
export type DocumentCanvasConnector = { id: string; start: ConnectorEndpoint; end: ConnectorEndpoint;
  routing?: "straight" | "elbow"; stroke?: string; strokeWidth?: number; startArrow?: ConnectorArrowhead; endArrow?: ConnectorArrowhead };
export type DocumentCanvasAttributes = { id?: string | null; width?: number; height?: number;
  shapes?: DocumentCanvasShape[]; connectors?: DocumentCanvasConnector[] };
export type DocumentCanvasNode = { type: "drawing_canvas"; attrs: DocumentCanvasAttributes };
export type DocumentCanvasCommand =
  | ({ type: "canvas.insert"; at: number } & Omit<DocumentCanvasAttributes, "id">)
  | { type: "canvas.update"; id: string; width?: number; height?: number }
  | { type: "canvas.shape.insert"; canvasId: string; shape: Omit<DocumentCanvasShape, "id"> & { id?: string } }
  | { type: "canvas.shape.update"; canvasId: string; id: string; patch: Partial<Omit<DocumentCanvasShape, "id">> }
  | { type: "canvas.shape.delete"; canvasId: string; id: string }
  | { type: "canvas.connector.insert"; canvasId: string; connector: Omit<DocumentCanvasConnector, "id"> & { id?: string } }
  | { type: "canvas.connector.update"; canvasId: string; id: string; patch: Partial<Omit<DocumentCanvasConnector, "id">> }
  | { type: "canvas.connector.delete"; canvasId: string; id: string };
export type DocumentPageBreakNode = { type: "page_break"; attrs?: { id?: string | null } };
export type DocumentBlock = DocumentParagraphNode | DocumentHeadingNode | DocumentListNode | DocumentTableNode | DocumentImageNode | DocumentShapeNode | DocumentCanvasNode | DocumentPageBreakNode;
export type DocumentRootNode = { type: "doc"; content: DocumentBlock[] };
export type DocumentNode = DocumentRootNode | DocumentBlock | DocumentListItemNode | DocumentTableRowNode | DocumentTableCellNode | DocumentInlineNode;
export type DocumentModel = {
  format: "likex.document";
  version: 1;
  id: string;
  title: string;
  page: DocumentPage;
  content: DocumentRootNode;
};
export type DocumentInput = Partial<Pick<DocumentModel, "id" | "title" | "content">> & { page?: Omit<Partial<DocumentPage>, "margins"> & { margins?: Partial<DocumentPage["margins"]> } };
/** ProseMirror positions: the first paragraph's first text position is 1. Empty selections are allowed. */
export type DocumentSelection = { from: number; to: number };
export type DocumentJsonValue = null | boolean | number | string | DocumentJsonValue[] | DocumentJsonObject;
export type DocumentJsonObject = { [key: string]: DocumentJsonValue };
export type DocumentCommand =
  | DocumentCanvasCommand
  | { type: "text.insert"; from: number; to?: number; text: string }
  | { type: "text.delete"; from: number; to: number }
  | { type: "mark.set"; from: number; to: number; mark: DocumentMarkName; attrs?: DocumentTextStyle | { href: string; title?: string | null }; enabled?: boolean }
  | { type: "paragraph.set"; from: number; to: number; nodeType?: "paragraph" | "heading"; level?: number; align?: DocumentAlignment }
  | { type: "list.set"; from: number; to: number; kind: "bullet" | "ordered" | "none" }
  | { type: "table.insert"; at: number; rows: number; columns: number; header?: boolean }
  | { type: "image.insert"; at: number; src: string; alt?: string; width?: number; height?: number }
  | { type: "image.update"; id: string; src?: string; alt?: string; width?: number; height?: number }
  | ({ type: "shape.insert"; at: number } & Omit<DocumentShapeAttributes, "id">)
  | ({ type: "shape.update"; id: string } & Partial<Omit<DocumentShapeAttributes, "id">>)
  | { type: "pageBreak.insert"; at: number }
  | { type: "block.delete"; id: string }
  | { type: "document.update"; title?: string; page?: Omit<Partial<DocumentPage>, "margins"> & { margins?: Partial<DocumentPage["margins"]> } }
  | { type: "document.replace"; document: DocumentModel }
  | { type: "transaction.apply"; steps: readonly DocumentJsonObject[]; selection?: DocumentSelection };
export type DocumentCommandResult = { document: DocumentModel; selection?: DocumentSelection };
export type DocumentBlockInfo = { id: string; node: Exclude<DocumentNode, DocumentRootNode | DocumentInlineNode>; from: number; to: number; contentFrom: number; contentTo: number };
