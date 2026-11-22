import type { Node as MarkdownNode, NodeType } from "prosemirror-model";
import { defaultMarkdownSerializer, MarkdownSerializer } from "prosemirror-markdown";
import { getMarkdownCompatibilityWarnings } from "./compatibility";

/**
 * prosemirror-markdown appends every block to one growing string and reads its last character
 * back, which copies the whole output each time: a 1 MB document takes seconds per pass.
 * Top-level blocks and the items of top-level lists are therefore rendered on their own and
 * joined with the separators the library would write. Unchanged nodes keep their Markdown, so
 * an edit re-renders only the block or list item it touched.
 */
type Chunk = { text: string; marker?: string; warnings?: readonly string[] };
const chunks = new WeakMap<MarkdownNode, Chunk>();
const base = defaultMarkdownSerializer.nodes;
/** A one-item copy of a list being rendered with the marker and indentation of the real item. */
let lone: { list: MarkdownNode; first: string; indent: string } | null = null;
const listOf = (name: "bullet_list" | "ordered_list"): typeof base[string] => (state, node, parent, index) => {
  if (lone?.list === node) { const first = lone.first; state.renderList(node, lone.indent, () => first); }
  else base[name](state, node, parent, index);
};
const serializer = new MarkdownSerializer({ ...base, bullet_list: listOf("bullet_list"), ordered_list: listOf("ordered_list"),
  list_item(state, node) { if (node.attrs.checked !== null) state.write(node.attrs.checked ? "[x] " : "[ ] "); state.renderContent(node); },
}, defaultMarkdownSerializer.marks);

const isList = (node: MarkdownNode) => node.type.name === "bullet_list" || node.type.name === "ordered_list";
const alone = (node: MarkdownNode) => serializer.serialize(node.type.schema.topNodeType.create(null, node));
const newline = (blank: boolean) => blank ? "" : "\n";

/** Item markers and continuation indentation, as the library's list serializers choose them. */
function markers(list: MarkdownNode): { indent: string; first(index: number): string } {
  if (list.type.name === "bullet_list") { const first = (list.attrs.bullet || "*") + " "; return { indent: "  ", first: () => first }; }
  const start: number = list.attrs.order ?? 1, width = String(start + list.childCount - 1).length;
  return { indent: " ".repeat(width + 2), first: index => String(start + index).padStart(width) + ". " };
}

function itemChunk(list: MarkdownNode, item: MarkdownNode, first: string, indent: string): Chunk {
  const marker = `${list.attrs.tight ? 1 : 0}${first}\n${indent}`;
  let chunk = chunks.get(item);
  if (chunk?.marker !== marker) {
    const copy = list.type.create(list.attrs, item);
    lone = { list: copy, first, indent };
    try { chunk = { text: alone(copy), marker }; } finally { lone = null; }
    chunks.set(item, chunk);
  }
  return chunk;
}

function listChunk(list: MarkdownNode, wantWarnings: boolean): Chunk {
  const { indent, first } = markers(list), parts: string[] = [], found = wantWarnings ? new Set<string>() : null;
  let blank = false;
  list.forEach((item, _offset, index) => {
    const chunk = itemChunk(list, item, first(index), indent);
    // Tight items start on the next line; loose items are separated by an empty line.
    if (index) parts.push(newline(blank) + (list.attrs.tight ? "" : "\n"));
    parts.push(chunk.text); blank = chunk.text.endsWith("\n");
    if (found) for (const warning of chunk.warnings ??= getMarkdownCompatibilityWarnings(chunk.text)) found.add(warning);
  });
  return { text: parts.join(""), ...(found ? { warnings: [...found] } : {}) };
}

function blockChunk(node: MarkdownNode, wantWarnings: boolean): Chunk {
  let chunk = chunks.get(node);
  if (!chunk || wantWarnings && !chunk.warnings) {
    if (isList(node)) chunk = listChunk(node, wantWarnings);
    else { chunk ??= { text: alone(node) }; chunk.warnings = wantWarnings ? getMarkdownCompatibilityWarnings(chunk.text) : undefined; }
    chunks.set(node, chunk);
  }
  return chunk;
}

/**
 * Markdown of the whole document. With `wantWarnings`, also the compatibility warnings of
 * each rendered block, in document order; the text is the same either way.
 */
export function serializeMarkdownBlocks(document: MarkdownNode, wantWarnings = false): { text: string; warnings: readonly string[] } {
  const parts: string[] = [], found = new Set<string>();
  let closed: NodeType | null = null, blank = true;
  document.forEach(node => {
    const chunk = blockChunk(node, wantWarnings);
    // The library closes the previous block only when the next one writes: two empty lines
    // between lists of the same kind, one before any other block that has output.
    if (closed && isList(node) && closed === node.type) { parts.push(newline(blank) + "\n\n"); blank = true; }
    else if (closed && chunk.text) { parts.push(newline(blank) + "\n"); blank = true; }
    if (chunk.text) { parts.push(chunk.text); blank = chunk.text.endsWith("\n"); }
    if (chunk.warnings) for (const warning of chunk.warnings) found.add(warning);
    closed = node.type;
  });
  return { text: parts.join(""), warnings: [...found] };
}
