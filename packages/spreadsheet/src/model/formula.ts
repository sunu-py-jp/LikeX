import { cellTextValue, isFormulaCell } from "./cell-value";
import { cellAddress, parseCellAddress } from "./address";
import { FUNCTION_HANDLERS } from "./formula-functions";
import { FormulaError, fail, errorPattern, finite, checked, number, literal, text, countable,
  type FunctionContext, type FormulaRange } from "./formula-functions/runtime";
import { SPREADSHEET_LIMITS, type SpreadsheetCalculatedValue as Value, type SpreadsheetWorkbook } from "./types";

export type FormulaReference = { sheet?: string; address: string; prefix: string };
export type FormulaToken = { kind: "number" | "string" | "reference" | "name" | "operator" | "error" | "end";
  text: string; start: number; end: number; reference?: FormulaReference };

/** A bounded tokenizer shared by evaluation and reference rewriting. Never executes source text. */
export function tokenizeFormula(formula: string): FormulaToken[] {
  if (formula.length > SPREADSHEET_LIMITS.formulaLength) return fail("#LIMIT!");
  const tokens: FormulaToken[] = [];
  let index = formula.startsWith("=") ? 1 : 0;
  while (index < formula.length) {
    if (/\s/.test(formula[index])) { index++; continue; }
    if (tokens.length >= SPREADSHEET_LIMITS.formulaTokens) return fail("#LIMIT!");
    const start = index, tail = formula.slice(index);
    let match: RegExpExecArray | null;
    if (tail[0] === '"') {
      let text = "", closed = false; index++;
      while (index < formula.length) {
        if (formula[index] === '"') {
          if (formula[index + 1] === '"') { text += '"'; index += 2; }
          else { index++; closed = true; break; }
        } else text += formula[index++];
      }
      if (!closed) return fail();
      tokens.push({ kind: "string", text, start, end: index });
    } else if ((match = /^(?:(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?[A-Za-z]+\$?[1-9]\d*)/.exec(tail)) &&
      !/[A-Za-z0-9_]/.test(tail[match[0].length] ?? "")) {
      index += match[0].length;
      const address = match[3];
      tokens.push({ kind: "reference", text: match[0], start, end: index,
        reference: { sheet: match[1]?.replaceAll("''", "'") ?? match[2], address,
          prefix: match[0].slice(0, match[0].length - address.length) } });
    } else if ((match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(tail))) {
      index += match[0].length; tokens.push({ kind: "number", text: match[0], start, end: index });
    } else if ((match = errorPattern.exec(tail))) {
      index += match[0].length; tokens.push({ kind: "error", text: match[0], start, end: index });
    } else if ((match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(tail))) {
      index += match[0].length; tokens.push({ kind: "name", text: match[0].toUpperCase(), start, end: index });
    } else if ((match = /^(?:<=|>=|<>|[+\-*/^&=<>():,;%])/.exec(tail))) {
      index += match[0].length; tokens.push({ kind: "operator", text: match[0], start, end: index });
    } else return fail();
  }
  tokens.push({ kind: "end", text: "", start: index, end: index });
  return tokens;
}

type Node = { type: "omitted" } | { type: "value"; value: Value } | { type: "error"; code: string } |
  { type: "reference"; reference: FormulaReference } |
  { type: "range"; first: FormulaReference; last: FormulaReference } |
  { type: "unary"; operator: string; value: Node } |
  { type: "binary"; operator: string; left: Node; right: Node } |
  { type: "call"; name: string; args: Node[] };
const precedence: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1,
  "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 6 };

/** Internal bounded parser shared by evaluation and export; not part of the package API. */
export function parseFormula(formula: string): Node {
  const tokens = tokenizeFormula(formula);
  let cursor = 0;
  const take = () => tokens[cursor++];
  const is = (text: string) => tokens[cursor].kind === "operator" && tokens[cursor].text === text;
  const expect = (text: string) => { if (!is(text)) fail(); take(); };
  function expression(minimum = 0, depth = 0): Node {
    if (depth > SPREADSHEET_LIMITS.referenceDepth) return fail("#LIMIT!");
    const token = take();
    let node: Node;
    if (token.kind === "number") node = { type: "value", value: finite(Number(token.text)) };
    else if (token.kind === "string") node = { type: "value", value: token.text };
    else if (token.kind === "error") node = { type: "error", code: token.text };
    else if (token.kind === "reference") {
      node = { type: "reference", reference: token.reference! };
      if (is(":")) {
        take(); const end = take();
        if (end.kind !== "reference") return fail();
        node = { type: "range", first: token.reference!, last: end.reference! };
      }
    } else if (token.text === "+" || token.text === "-")
      node = { type: "unary", operator: token.text, value: expression(5, depth + 1) };
    else if (token.text === "(") { node = expression(0, depth + 1); expect(")"); }
    else if (token.kind === "name") {
      if (!is("(")) {
        node = token.text === "TRUE" || token.text === "FALSE"
          ? { type: "value", value: token.text === "TRUE" } : { type: "error", code: "#NAME?" };
      } else {
        take(); const args: Node[] = [];
        if (!is(")")) {
          do {
            if (args.length) take();
            args.push(is(",") || is(";") || is(")") ? { type: "omitted" } : expression(0, depth + 1));
          } while (is(",") || is(";"));
        }
        expect(")"); node = { type: "call", name: token.text, args };
      }
    } else return fail();
    while (true) {
      if (is("%")) { take(); node = { type: "unary", operator: "%", value: node }; continue; }
      const operator = tokens[cursor].text, level = precedence[operator];
      if (level === undefined || level < minimum) break;
      take(); const right = expression(operator === "^" ? level : level + 1, depth + 1);
      node = { type: "binary", operator, left: node, right };
    }
    return node;
  }
  const node = expression();
  if (tokens[cursor].kind !== "end") return fail();
  return node;
}

/** Calculate populated cells only; reference matrices retain blanks and their exact shape. */
export function calculateWorkbook(workbook: SpreadsheetWorkbook): Record<string, Record<string, Value>> {
  const result: Record<string, Record<string, Value>> = Object.create(null);
  const sheets = new Map(workbook.sheets.map(sheet => [sheet.name.toLocaleLowerCase("en-US"), sheet]));
  const byId = new Map(workbook.sheets.map(sheet => [sheet.id, sheet]));
  const active = new Set<string>(), parsed = new Map<string, Node>();
  let steps = 0;
  const tick = (cost = 1) => { if ((steps += cost) > SPREADSHEET_LIMITS.evaluationSteps) fail("#LIMIT!"); };
  for (const sheet of workbook.sheets) result[sheet.id] = Object.create(null);
  function get(sheetId: string, address: string, depth: number): Value | null {
    if (depth > SPREADSHEET_LIMITS.referenceDepth) return fail("#LIMIT!");
    const sheet = byId.get(sheetId), position = parseCellAddress(address);
    if (!sheet || !position || position.row >= sheet.rowCount || position.column >= sheet.columnCount) return fail("#REF!");
    const canonical = cellAddress(position.row, position.column), cache = result[sheetId];
    const cell = sheet.cells[canonical];
    if (!cell || !cell.value) return null;
    if (Object.hasOwn(cache, canonical)) return countable(cache[canonical]);
    if (cell.format?.numberFormat === "text") return cache[canonical] = cellTextValue(cell.value);
    if (!isFormulaCell(cell)) return cache[canonical] = literal(cell.value);
    const key = `${sheetId}\0${canonical}`;
    if (active.has(key)) return fail("#CYCLE!");
    active.add(key);
    try {
      let node = parsed.get(cell.value);
      if (!node) { node = parseFormula(cell.value); parsed.set(cell.value, node); }
      cache[canonical] = scalar(node, sheetId, depth + 1, position);
    } catch (error) { cache[canonical] = error instanceof FormulaError ? error.code : "#ERROR!"; }
    finally { active.delete(key); }
    return countable(cache[canonical]);
  }
  function target(reference: FormulaReference, current: string) {
    return reference.sheet === undefined ? byId.get(current) : sheets.get(reference.sheet.toLocaleLowerCase("en-US"));
  }
  type Position = { row: number; column: number };
  function scalar(node: Node, sheet: string, depth: number, position: Position): Value {
    const value = evaluate(node, sheet, depth, position);
    return typeof value === "object" && value !== null ? fail("#VALUE!") : checked(value ?? 0);
  }
  function referenceRange(node: Node, current: string, depth: number): FormulaRange {
    if (node.type !== "reference" && node.type !== "range") return fail("#VALUE!");
    const a = node.type === "reference" ? node.reference : node.first;
    const b = node.type === "reference" ? node.reference : node.last;
    const sheet = target(a, current), endSheet = target(b, sheet?.id ?? current);
    const first = parseCellAddress(a.address), last = parseCellAddress(b.address);
    if (!sheet || sheet !== endSheet || !first || !last) return fail("#REF!");
    const row = Math.min(first.row, last.row), column = Math.min(first.column, last.column);
    const bottom = Math.max(first.row, last.row), right = Math.max(first.column, last.column);
    if (bottom >= sheet.rowCount || right >= sheet.columnCount) return fail("#REF!");
    const rows = bottom - row + 1, columns = right - column + 1;
    const at = (index: number) => {
      if (!Number.isInteger(index) || index < 0 || index >= rows * columns) return fail("#REF!");
      tick(); return get(sheet.id, cellAddress(row + Math.floor(index / columns), column + index % columns), depth);
    };
    let cached: (Value | null)[] | undefined;
    return {
      rows, columns, row, column, at,
      get values() {
        if (rows * columns > SPREADSHEET_LIMITS.rangeCells) return fail("#LIMIT!");
        return cached ??= Array.from({ length: rows * columns }, (_, index) => at(index));
      },
    };
  }

  function evaluate(node: Node, current: string, depth: number, position: Position): Value | null | FormulaRange {
    tick();
    if (depth > SPREADSHEET_LIMITS.referenceDepth) return fail("#LIMIT!");
    switch (node.type) {
      case "omitted": return 0;
      case "value": return node.value;
      case "error": return countable(node.code);
      case "reference": {
        const sheet = target(node.reference, current);
        if (!sheet) return fail("#REF!");
        return get(sheet.id, node.reference.address, depth);
      }
      case "range": return referenceRange(node, current, depth);
      case "unary": {
        const value = number(scalar(node.value, current, depth + 1, position));
        return node.operator === "-" ? -value : node.operator === "%" ? value / 100 : value;
      }
      case "binary": {
        const left = scalar(node.left, current, depth + 1, position), right = scalar(node.right, current, depth + 1, position);
        if (node.operator === "&") {
          const a = text(left), b = text(right);
          if (a.length + b.length > SPREADSHEET_LIMITS.cellLength) return fail("#LIMIT!");
          return a + b;
        }
        if (["=", "<>", "<", ">", "<=", ">="].includes(node.operator)) {
          const a = typeof left === "string" ? left.toLocaleLowerCase("en-US") : left;
          const b = typeof right === "string" ? right.toLocaleLowerCase("en-US") : right;
          const compare = a === b ? 0 : a < b ? -1 : 1;
          return node.operator === "=" ? compare === 0 : node.operator === "<>" ? compare !== 0 :
            node.operator === "<" ? compare < 0 : node.operator === ">" ? compare > 0 : node.operator === "<=" ? compare <= 0 : compare >= 0;
        }
        const a = number(left), b = number(right);
        if (node.operator === "/" && b === 0) return fail("#DIV/0!");
        return finite(node.operator === "+" ? a + b : node.operator === "-" ? a - b :
          node.operator === "*" ? a * b : node.operator === "/" ? a / b : a ** b);
      }
      case "call": {
        const handler = Object.hasOwn(FUNCTION_HANDLERS, node.name) ? FUNCTION_HANDLERS[node.name as keyof typeof FUNCTION_HANDLERS] : undefined;
        if (!handler) return fail("#NAME?");
        const read = (index: number) => {
          if (!node.args[index]) return fail("#VALUE!");
          return evaluate(node.args[index], current, depth + 1, position);
        };
        const context: FunctionContext = {
          count: node.args.length, position, tick,
          scalar: index => scalar(node.args[index] ?? fail("#VALUE!"), current, depth + 1, position),
          raw: index => {
            const value = read(index);
            return typeof value === "object" && value !== null ? fail("#VALUE!") : value;
          },
          text: index => {
            const value = read(index);
            if (typeof value === "object" && value !== null) return fail("#VALUE!");
            const output = text(checked(value ?? ""));
            tick(Math.ceil(output.length / 64));
            return output;
          },
          values: index => {
            const value = read(index);
            return typeof value === "object" && value !== null ? value.values : [value];
          },
          range: index => referenceRange(node.args[index] ?? fail("#VALUE!"), current, depth + 1),
          criterion: index => {
            const argument = node.args[index];
            return argument?.type === "value" && typeof argument.value === "string" ? argument.value : context.scalar(index);
          },
          referenced: index => ["reference", "range"].includes(node.args[index]?.type),
          omitted: index => !node.args[index] || node.args[index].type === "omitted",
          checkArity(minimum, maximum = minimum) {
            if (node.args.length < minimum || node.args.length > maximum) fail("#VALUE!");
          },
        };
        return handler(context);
      }
    }
  }
  for (const sheet of workbook.sheets) for (const [address, cell] of Object.entries(sheet.cells)) {
    try { if (cell.value) get(sheet.id, address, 0); else result[sheet.id][address] = ""; }
    catch (error) { result[sheet.id][address] = error instanceof FormulaError ? error.code : "#ERROR!"; }
  }
  return result;
}


function shiftedReference(reference: FormulaReference, row: number, column: number): string {
  if (row < 0 || column < 0 || row >= SPREADSHEET_LIMITS.rows || column >= SPREADSHEET_LIMITS.columns) return "#REF!";
  const match = /^(\$?)[A-Za-z]+(\$?)\d+$/.exec(reference.address)!;
  const address = cellAddress(row, column), parts = /^([A-Z]+)(\d+)$/.exec(address)!;
  return `${reference.prefix}${match[1]}${parts[1]}${match[2]}${parts[2]}`;
}

/** Rewrite references while leaving string literals, whitespace and function names untouched. */
export function rewriteFormulaReferences(formula: string,
  rewrite: (reference: FormulaReference) => string | undefined,
  range?: (first: FormulaReference, last: FormulaReference) => string | undefined): string {
  if (!formula.startsWith("=")) return formula;
  let tokens: FormulaToken[];
  try { tokens = tokenizeFormula(formula); } catch { return formula; }
  const replacements: { start: number; end: number; value: string }[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.reference) continue;
    if (range && tokens[index + 1]?.text === ":" && tokens[index + 2]?.reference) {
      const end = tokens[index + 2], value = range(token.reference, end.reference!);
      if (value !== undefined) replacements.push({ start: token.start, end: end.end, value });
      index += 2; continue;
    }
    const value = rewrite(token.reference);
    if (value !== undefined) replacements.push({ start: token.start, end: token.end, value });
  }
  let result = formula;
  for (const replacement of replacements.reverse()) result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  return result;
}

/** Copy/fill offset: $ fixes its row or column; quoted text is never rewritten. */
export function translateFormula(formula: string, rowDelta: number, columnDelta: number): string {
  if (!Number.isInteger(rowDelta) || !Number.isInteger(columnDelta)) throw new Error("数式の移動量が正しくありません");
  const translate = (reference: FormulaReference) => {
    const position = parseCellAddress(reference.address);
    if (!position) return "#REF!";
    return shiftedReference(reference, position.row + (/\$\d+$/.test(reference.address) ? 0 : rowDelta),
      position.column + (reference.address.startsWith("$") ? 0 : columnDelta));
  };
  return rewriteFormulaReferences(formula, translate, (first, last) => {
    const a = translate(first), b = translate(last);
    return a === "#REF!" || b === "#REF!" ? "#REF!" : `${a}:${b}`;
  });
}

export function moveFormulaReference(reference: FormulaReference, row: number, column: number): string {
  return shiftedReference(reference, row, column);
}
