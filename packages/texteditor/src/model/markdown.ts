import { getMarkdownCompatibilityWarnings, parseMarkdownDocument } from "../markdown/index";
import { normalizeTextEditorModel } from "./document";
import type { TextEditorModel } from "./types";

/** Rich-document positions; these are not offsets into the Markdown source. */
export type TextEditorMarkdownBlock = Readonly<{
  type: string;
  /** Position immediately before the node; use for markdown.toggleTask. */
  position: number;
  /** Content range for markdown.format. A leaf block's range covers the node. */
  from: number;
  to: number;
  text: string;
  level?: number;
  checked?: boolean;
}>;

/** Interpret the source as Markdown, regardless of display mode. Return nested blocks in preorder. */
export function getTextEditorMarkdownBlocks(input: TextEditorModel | string): readonly TextEditorMarkdownBlock[] {
  const model = typeof input === "string" ? undefined : normalizeTextEditorModel(input);
  const source = model ? model.text : input as string;
  if (getMarkdownCompatibilityWarnings(source).length) throw new Error("このMarkdownの拡張記法はソースモードで編集してください。");
  const blocks: TextEditorMarkdownBlock[] = [];
  parseMarkdownDocument(source).descendants((node, position) => {
    if (!node.isBlock) return;
    blocks.push(Object.freeze({
      type: node.type.name, position,
      from: position + (node.isLeaf ? 0 : 1), to: position + node.nodeSize - (node.isLeaf ? 0 : 1),
      text: node.textContent,
      ...(node.type.name === "heading" ? { level: node.attrs.level as number } : {}),
      ...(typeof node.attrs.checked === "boolean" ? { checked: node.attrs.checked } : {}),
    }));
  });
  return Object.freeze(blocks);
}
