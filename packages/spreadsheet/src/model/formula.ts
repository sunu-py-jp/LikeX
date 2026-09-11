import { cellTextValue, isFormulaCell } from "./cell-value";
import { cellAddress, parseCellAddress } from "./address";
import { SUPPORTED_SPREADSHEET_FUNCTIONS } from "./function-definitions";
import { SPREADSHEET_LIMITS, type SpreadsheetCalculatedValue as Value, type SpreadsheetWorkbook } from "./types";

export type FormulaReference = { sheet?: string; address: string; prefix: string };
export type FormulaToken = { kind: "number" | "string" | "reference" | "name" | "operator" | "error" | "end";
  text: string; start: number; end: number; reference?: FormulaReference };
class FormulaError extends Error { constructor(readonly code: string) { super(code); } }
const fail = (code = "#ERROR!"): never => { throw new FormulaError(code); };
const errorPattern = /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|NUM!|N\/A|CYCLE!|LIMIT!|ERROR!)/;
const recoverableErrors = new Set(["#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#NUM!", "#N/A"]);
const functionNames = new Set<string>(SUPPORTED_SPREADSHEET_FUNCTIONS.map(definition => definition.name));

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

type Node = { type: "value"; value: Value } | { type: "error"; code: string } |
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
  const is = (text: string) => tokens[cursor].text === text;
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
          do { if (args.length) take(); args.push(expression(0, depth + 1)); } while (is(",") || is(";"));
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

function finite(value: number): number { return Number.isFinite(value) ? value : fail("#NUM!"); }
function checked(value: Value): Value {
  if (typeof value === "string" && errorPattern.test(value) && errorPattern.exec(value)![0] === value) return fail(value);
  return value;
}
function number(value: Value): number {
  checked(value);
  if (typeof value === "number") return finite(value);
  if (typeof value === "boolean") return Number(value);
  if (!value.trim()) return 0;
  return numeric.test(value.trim()) ? finite(Number(value)) : fail("#VALUE!");
}
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function literal(value: string): Value {
  if (value.startsWith("'")) return value.slice(1);
  if (numeric.test(value.trim())) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : value; }
  if (/^(true|false)$/i.test(value)) return value.toUpperCase() === "TRUE";
  return value;
}

function logical(value: Value): boolean {
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) return value.trim().toUpperCase() === "TRUE";
  return number(value) !== 0;
}
function text(value: Value): string { return typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value); }

/** Round decimal digits, avoiding binary multiplication's 1.005 * 100 boundary error. */
function round(value: number, places: number): number {
  const digits = Math.trunc(places);
  const [coefficient, power = "0"] = Math.abs(value).toString().split("e");
  const fraction = coefficient.split(".")[1]?.length ?? 0;
  const significant = coefficient.replace(".", "");
  const remove = fraction - Number(power) - digits;
  if (remove <= 0 || value === 0) return value === 0 ? 0 : value;
  if (remove > significant.length) return 0;
  const boundary = significant.length - remove;
  let rounded = BigInt(significant.slice(0, boundary) || "0");
  if (significant[boundary] >= "5") rounded++;
  if (!rounded) return 0;
  return finite(Math.sign(value) * Number(`${rounded}e${-digits}`));
}

/** Calculate only populated cells. Empty references are zero; absent display cells remain absent. */
export function calculateWorkbook(workbook: SpreadsheetWorkbook): Record<string, Record<string, Value>> {
  const result: Record<string, Record<string, Value>> = Object.create(null);
  const sheets = new Map(workbook.sheets.map(sheet => [sheet.name.toLocaleLowerCase("en-US"), sheet]));
  const byId = new Map(workbook.sheets.map(sheet => [sheet.id, sheet]));
  const active = new Set<string>(), parsed = new Map<string, Node>();
  let steps = 0;
  for (const sheet of workbook.sheets) result[sheet.id] = Object.create(null);
  function get(sheetId: string, address: string, depth: number): Value {
    if (depth > SPREADSHEET_LIMITS.referenceDepth) return "#LIMIT!";
    const sheet = byId.get(sheetId), position = parseCellAddress(address);
    if (!sheet || !position || position.row >= sheet.rowCount || position.column >= sheet.columnCount) return "#REF!";
    const canonical = cellAddress(position.row, position.column), cache = result[sheetId];
    if (Object.hasOwn(cache, canonical)) return cache[canonical];
    const cell = sheet.cells[canonical];
    if (!cell || !cell.value) return 0;
    if (cell.format?.numberFormat === "text") return cache[canonical] = cellTextValue(cell.value);
    if (!isFormulaCell(cell)) return cache[canonical] = literal(cell.value);
    const key = `${sheetId}\0${canonical}`;
    if (active.has(key)) return "#CYCLE!";
    active.add(key);
    try {
      let node = parsed.get(cell.value);
      if (!node) { node = parseFormula(cell.value); parsed.set(cell.value, node); }
      const calculated = evaluate(node, sheetId, depth + 1);
      cache[canonical] = Array.isArray(calculated) ? "#VALUE!" : checked(calculated);
    } catch (error) { cache[canonical] = error instanceof FormulaError ? error.code : "#ERROR!"; }
    finally { active.delete(key); }
    return cache[canonical];
  }
  function target(reference: FormulaReference, current: string) {
    return reference.sheet === undefined ? byId.get(current) : sheets.get(reference.sheet.toLocaleLowerCase("en-US"));
  }
  function scalar(node: Node, sheet: string, depth: number): Value {
    const value = evaluate(node, sheet, depth); return Array.isArray(value) ? fail("#VALUE!") : checked(value);
  }
  function blankReference(node: Node, current: string): boolean {
    if (node.type !== "reference") return false;
    const sheet = target(node.reference, current), position = parseCellAddress(node.reference.address);
    return !!sheet && !!position && position.row < sheet.rowCount && position.column < sheet.columnCount &&
      !sheet.cells[cellAddress(position.row, position.column)]?.value;
  }
  function textScalar(node: Node, current: string, depth: number): Value {
    return blankReference(node, current) ? "" : scalar(node, current, depth);
  }
  // COUNTA may count ordinary error values, but it cannot hide cycles or resource limits.
  function argumentValues(node: Node, current: string, depth: number, countErrors = false): Value[] {
    if (blankReference(node, current)) return [];
    try {
      const value = evaluate(node, current, depth, countErrors);
      return Array.isArray(value) ? value : [countErrors ? countable(value) : checked(value)];
    } catch (error) {
      if (countErrors && error instanceof FormulaError && recoverableErrors.has(error.code)) return [error.code];
      throw error;
    }
  }
  function countable(value: Value): Value {
    return typeof value === "string" && recoverableErrors.has(value) ? value : checked(value);
  }
  function evaluate(node: Node, current: string, depth: number, countErrors = false): Value | Value[] {
    if (++steps > SPREADSHEET_LIMITS.evaluationSteps || depth > SPREADSHEET_LIMITS.referenceDepth) return fail("#LIMIT!");
    switch (node.type) {
      case "value": return node.value;
      case "error": return fail(node.code);
      case "reference": {
        const sheet = target(node.reference, current);
        if (!sheet) return fail("#REF!");
        const value = get(sheet.id, node.reference.address, depth);
        return countErrors ? countable(value) : checked(value);
      }
      case "range": {
        const sheet = target(node.first, current), endSheet = target(node.last, sheet?.id ?? current);
        const first = parseCellAddress(node.first.address), last = parseCellAddress(node.last.address);
        if (!sheet || sheet !== endSheet || !first || !last) return fail("#REF!");
        const r0 = Math.min(first.row, last.row), r1 = Math.max(first.row, last.row);
        const c0 = Math.min(first.column, last.column), c1 = Math.max(first.column, last.column);
        if (r1 >= sheet.rowCount || c1 >= sheet.columnCount) return fail("#REF!");
        if ((r1 - r0 + 1) * (c1 - c0 + 1) > SPREADSHEET_LIMITS.rangeCells) return fail("#LIMIT!");
        const values: Value[] = [];
        for (let row = r0; row <= r1; row++) for (let column = c0; column <= c1; column++) {
          if (++steps > SPREADSHEET_LIMITS.evaluationSteps) return fail("#LIMIT!");
          const address = cellAddress(row, column);
          // Blank cells do not contribute to COUNT or the denominator of AVERAGE.
          if (sheet.cells[address]?.value) {
            const value = get(sheet.id, address, depth);
            values.push(countErrors ? countable(value) : checked(value));
          }
        }
        return values;
      }
      case "unary": {
        const value = number(scalar(node.value, current, depth + 1));
        return node.operator === "-" ? -value : node.operator === "%" ? value / 100 : value;
      }
      case "binary": {
        const left = scalar(node.left, current, depth + 1), right = scalar(node.right, current, depth + 1);
        if (node.operator === "&") {
          const a = String(left), b = String(right);
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
        if (!functionNames.has(node.name)) return fail("#NAME?");
        if (node.name === "IF") {
          if (node.args.length < 2 || node.args.length > 3) return fail("#VALUE!");
          const condition = scalar(node.args[0], current, depth + 1);
          const branch = number(condition) ? node.args[1] : node.args[2];
          return branch ? scalar(branch, current, depth + 1) : false;
        }
        if (node.name === "IFERROR") {
          if (node.args.length !== 2) return fail("#VALUE!");
          try { return textScalar(node.args[0], current, depth + 1); }
          catch (error) {
            if (!(error instanceof FormulaError) || !recoverableErrors.has(error.code)) throw error;
            return textScalar(node.args[1], current, depth + 1);
          }
        }
        if (["ROUND", "ABS", "NOT", "LEN"].includes(node.name)) {
          if (node.args.length !== (node.name === "ROUND" ? 2 : 1)) return fail("#VALUE!");
          if (node.name === "LEN") {
            const value = text(textScalar(node.args[0], current, depth + 1));
            let length = 0;
            for (let index = 0; index < value.length; length++) index += value.codePointAt(index)! > 0xffff ? 2 : 1;
            return length;
          }
          const value = scalar(node.args[0], current, depth + 1);
          if (node.name === "NOT") return !logical(value);
          const numericValue = number(value);
          return node.name === "ABS" ? Math.abs(numericValue) : round(numericValue, number(scalar(node.args[1], current, depth + 1)));
        }
        if (["COUNTA", "AND", "OR", "CONCAT"].includes(node.name)) {
          if (!node.args.length) return fail("#VALUE!");
          let count = 0, truth = node.name === "AND", joined = "";
          for (const argument of node.args) {
            const referenced = argument.type === "reference" || argument.type === "range";
            for (const value of argumentValues(argument, current, depth + 1, node.name === "COUNTA")) {
              if (node.name === "COUNTA") { count++; continue; }
              if (node.name === "CONCAT") {
                const next = text(value);
                if (joined.length + next.length > SPREADSHEET_LIMITS.cellLength) return fail("#LIMIT!");
                joined += next;
              } else if (!referenced || typeof value !== "string") {
                const condition = logical(value);
                truth = node.name === "AND" ? truth && condition : truth || condition;
                count++;
              }
            }
          }
          if (node.name === "COUNTA") return count;
          if (node.name === "CONCAT") return joined;
          return count ? truth : fail("#VALUE!");
        }
        const values = node.args.flatMap(arg => argumentValues(arg, current, depth + 1));
        const numbers = values.filter((value): value is number => typeof value === "number");
        if (node.name === "COUNT") return numbers.length;
        if (node.name === "AVERAGE" && !numbers.length) return fail("#DIV/0!");
        if (!numbers.length) return 0;
        if (node.name === "MIN") return numbers.reduce((value, next) => Math.min(value, next), Infinity);
        if (node.name === "MAX") return numbers.reduce((value, next) => Math.max(value, next), -Infinity);
        const sum = numbers.reduce((total, value) => total + value, 0);
        return finite(node.name === "AVERAGE" ? sum / numbers.length : sum);
      }
    }
  }
  for (const sheet of workbook.sheets) for (const [address, cell] of Object.entries(sheet.cells)) {
    if (cell.value) get(sheet.id, address, 0);
    else result[sheet.id][address] = "";
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
