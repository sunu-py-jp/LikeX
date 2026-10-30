import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

const scalarMarks = {
  string: Decoration.mark({ class: "lxte-syntax-string" }),
  number: Decoration.mark({ class: "lxte-syntax-number" }),
  atom: Decoration.mark({ class: "lxte-syntax-atom" }),
};

/** A visual hint for YAML 1.2 plain scalars, never a value conversion or validation. */
function scalarKind(value: string): keyof typeof scalarMarks {
  if (/^(?:true|false|null|~)$/i.test(value)) return "atom";
  if (/^(?:[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?|0o[0-7]+|0x[\da-f]+|[+-]?\.inf|\.nan)$/i.test(value)) return "number";
  return "string";
}

/** Only visits the parsed visible ranges. Large offscreen scalar values are never copied. */
export function yamlScalarDecorations(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
  const tree = syntaxTree(state), seen = new Set<number>();
  const decorations: Range<Decoration>[] = [];
  for (const range of ranges) tree.iterate({ from: range.from, to: range.to, enter(node) {
    if (node.name !== "Literal" || node.node.parent?.name === "Key" || seen.has(node.from)) return;
    seen.add(node.from);
    // Explicit YAML tags may change the type. Keep those values neutral to schema-specific typing.
    const typed = node.node.parent?.name === "Tagged";
    const kind = !typed && node.to - node.from <= 128 ? scalarKind(state.sliceDoc(node.from, node.to)) : "string";
    if (node.to > node.from) decorations.push(scalarMarks[kind].range(node.from, node.to));
  } });
  return Decoration.set(decorations, true);
}

export const yamlScalarHighlighting = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = yamlScalarDecorations(view.state, view.visibleRanges); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state))
      this.decorations = yamlScalarDecorations(update.state, update.view.visibleRanges);
  }
}, { decorations: plugin => plugin.decorations });
