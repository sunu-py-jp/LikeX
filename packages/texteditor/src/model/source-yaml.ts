import { Composer, isAlias, isCollection, isMap, isPair, isScalar, Parser } from "yaml";
import type { CST, Document } from "yaml";
import type { TextEditorDiagnostic, TextEditorRangeEdit } from "./types";
import { applySourceEdits, sourceDiagnostic, SOURCE_MAX_DEPTH } from "./source-format-utils";

type YamlSource = { tokens: CST.Token[]; documents: Document.Parsed[]; diagnostics: TextEditorDiagnostic[] };

function tokenChildren(token: CST.Token): CST.Token[] {
  if (token.type === "document") return [...token.start, ...(token.value ? [token.value] : []), ...(token.end ?? [])];
  if (token.type === "block-map" || token.type === "block-seq" || token.type === "flow-collection") {
    const result: CST.Token[] = token.type === "flow-collection" ? [token.start] : [];
    for (const item of token.items) result.push(...item.start, ...(item.key ? [item.key] : []), ...(item.sep ?? []), ...(item.value ? [item.value] : []));
    if (token.type === "flow-collection") result.push(...token.end);
    return result;
  }
  if (token.type === "block-scalar") return token.props;
  return "end" in token ? token.end ?? [] : [];
}

export function inspectYamlSource(text: string): YamlSource {
  const tokens: CST.Token[] = [], documents: Document.Parsed[] = [], diagnostics: TextEditorDiagnostic[] = [];
  const source = { tokens, documents, diagnostics };
  for (const token of new Parser().parse(text)) {
    tokens.push(token);
    const stack = [{ token, depth: 0 }];
    while (stack.length) {
      const entry = stack.pop()!;
      if (entry.depth > SOURCE_MAX_DEPTH) {
        diagnostics.push(sourceDiagnostic(text, entry.token.offset, entry.token.offset, "YAML: 入れ子が深すぎるため構文確認・整形できません。")); return source;
      }
      if (entry.token.type === "error") {
        diagnostics.push(sourceDiagnostic(text, entry.token.offset, entry.token.offset + entry.token.source.length, `YAML構文エラー: ${entry.token.message}`)); return source;
      }
      for (const child of tokenChildren(entry.token)) stack.push({ token: child, depth: entry.depth + (child.type === "block-map" || child.type === "block-seq" || child.type === "flow-collection" ? 1 : 0) });
    }
  }
  // Composer validates syntax without toJS(), alias expansion, or custom tag
  // callbacks. Unknown explicit tags remain source data, never executable code.
  const composer = new Composer({ strict: true, prettyErrors: false, schema: "failsafe", resolveKnownTags: false, uniqueKeys: false });
  for (const document of composer.compose(tokens, true, text.length)) {
    documents.push(document);
    if (document.errors.length) {
      const error = document.errors[0];
      diagnostics.push(sourceDiagnostic(text, error.pos[0], error.pos[1], `YAML構文エラー: ${error.message}`)); return source;
    }
    // The upstream pairwise unique-key check is quadratic for wide maps. Check
    // ordinary scalar keys with a Set instead, leaving complex-key semantics
    // (and schema-specific key coercion) to the application.
    const nodes: unknown[] = [document.contents];
    while (nodes.length) {
      const node = nodes.pop();
      if (isMap(node)) {
        const keys = new Set<string>();
        for (const pair of node.items) {
          if (isScalar(pair.key)) {
            const key = `${pair.key.tag ?? ""}\u0000${String(pair.key.value)}`;
            if (keys.has(key)) {
              diagnostics.push(sourceDiagnostic(text, pair.key.range?.[0] ?? 0, pair.key.range?.[1] ?? 0, "YAML構文エラー: マッピングのキーが重複しています。")); return source;
            }
            keys.add(key);
          }
          nodes.push(pair.key, pair.value);
        }
      } else if (isCollection(node)) for (const item of node.items) nodes.push(item);
      else if (isPair(node)) nodes.push(node.key, node.value);
    }
  }
  return source;
}

/** Verify composition is unchanged without resolving aliases or coercing maps into JS objects. */
function sameYamlMeaning(before: readonly Document.Parsed[], after: readonly Document.Parsed[]): boolean {
  if (before.length !== after.length) return false;
  const stack: [unknown, unknown][] = [];
  for (let index = 0; index < before.length; index++) stack.push([before[index].contents, after[index].contents]);
  while (stack.length) {
    const [left, right] = stack.pop()!;
    if (left == null || right == null) { if (left !== right) return false; continue; }
    if (isPair(left)) {
      if (!isPair(right)) return false;
      stack.push([left.key, right.key], [left.value, right.value]);
    } else if (isScalar(left)) {
      if (!isScalar(right) || !Object.is(left.value, right.value) || left.tag !== right.tag || left.anchor !== right.anchor) return false;
    } else if (isAlias(left)) {
      if (!isAlias(right) || left.source !== right.source) return false;
    } else if (isCollection(left)) {
      if (!isCollection(right) || left.constructor !== right.constructor || left.tag !== right.tag || left.anchor !== right.anchor || left.items.length !== right.items.length) return false;
      for (let index = 0; index < left.items.length; index++) stack.push([left.items[index], right.items[index]]);
    } else return false;
  }
  return true;
}

export function formatYamlSource(text: string, indent: number, inspected: YamlSource): string {
  const changes = new Map<number, TextEditorRangeEdit>();
  const lines: { start: number; content: number }[] = [];
  for (let offset = 0; offset <= text.length;) {
    const start = offset;
    while (text[offset] === " ") offset++;
    lines.push({ start, content: offset });
    while (offset < text.length && text[offset] !== "\r" && text[offset] !== "\n") offset++;
    if (offset >= text.length) break;
    offset += text[offset] === "\r" && text[offset + 1] === "\n" ? 2 : 1;
  }
  const lineAt = (offset: number) => {
    let low = 0, high = lines.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (lines[middle].start <= offset) low = middle; else high = middle - 1; }
    return lines[low];
  };
  const sameLine = (a: number, b: number) => lineAt(a) === lineAt(b);
  const leading = (offset: number, target: number) => {
    const line = lineAt(offset);
    if (line.content === offset && line.content - line.start !== target) changes.set(line.start, { from: line.start, to: offset, text: " ".repeat(Math.max(0, target)) });
  };
  const shift = (token: CST.Token, delta: number) => {
    if (token.type === "space" || token.type === "newline") return;
    const line = lineAt(token.offset);
    if (line.content === token.offset) leading(token.offset, line.content - line.start + delta);
  };
  const shiftScalar = (token: CST.Token, target: number) => {
    if (!("indent" in token)) return;
    const delta = target - token.indent;
    shift(token, delta);
    // Preserve scalar spelling and all relative indentation, including |2/>
    // block scalar indicators, chomping, blank lines and folded/quoted strings.
    if ("source" in token && token.source.includes("\n")) {
      const bodyStart = token.type === "block-scalar" ? token.props.reduce((offset, prop) => "source" in prop ? Math.max(offset, prop.offset + prop.source.length) : offset, token.offset) : token.offset;
      const expression = /(?:^|\n)( *)(?=[^\r\n])/g;
      for (let match = expression.exec(token.source); match; match = expression.exec(token.source)) {
        if (!match[0].length) expression.lastIndex++;
        const offset = bodyStart + match.index + (match[0][0] === "\n" ? 1 : 0) + match[1].length;
        if (offset === token.offset) continue;
        if (match[1].length + delta < 0) return false;
        leading(offset, match[1].length + delta);
      }
    }
    for (const child of tokenChildren(token)) shift(child, delta);
    return true;
  };
  const stack = inspected.tokens.filter(token => token.type === "document" && token.value).map(token => ({ token: (token as CST.Document).value!, target: 0 }));
  while (stack.length) {
    const { token, target } = stack.pop()!;
    if (token.type !== "block-map" && token.type !== "block-seq") {
      if (token.type === "flow-collection") {
        // Keep flow collections in their existing style; shift their complete
        // subtree uniformly instead of changing commas, quotes or inline tags.
        const delta = target - token.indent, flow = [token as CST.Token];
        while (flow.length) {
          const item = flow.pop()!;
          if ("source" in item && !shiftScalar(item, ("indent" in item ? item.indent : 0) + delta)) return text;
          else shift(item, delta);
          for (const child of tokenChildren(item)) flow.push(child);
        }
      } else if (shiftScalar(token, target) === false) return text;
      continue;
    }
    const delta = target - token.indent;
    for (const item of token.items) {
      // Explicit complex keys use indentation as part of a second structure.
      // Conservatively keep those documents unchanged rather than guessing.
      if ("explicitKey" in item && item.explicitKey) return text;
      for (const sourceToken of [...item.start, ...(item.sep ?? [])]) shift(sourceToken, delta);
      if (item.key) stack.push({ token: item.key, target });
      if (item.value) {
        const anchor = item.key?.offset ?? item.start.find(start => start.type === "seq-item-ind")?.offset ?? token.offset;
        const inline = sameLine(anchor, item.value.offset);
        const childIndent = "indent" in item.value ? item.value.indent : token.indent;
        const childTarget = inline ? target + childIndent - token.indent : target + indent;
        stack.push({ token: item.value, target: childTarget });
      }
    }
  }
  if (!changes.size) return text;
  const result = applySourceEdits(text, [...changes.values()]);
  const checked = inspectYamlSource(result);
  return !checked.diagnostics.length && sameYamlMeaning(inspected.documents, checked.documents) ? result : text;
}
