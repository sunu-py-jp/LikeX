import { SPREADSHEET_LIMITS, type SpreadsheetCalculatedValue as Value } from "../types";
import { checked, compareValues, fail, integerArgument, logical, number,
  type FormulaRange, type FunctionContext, type FunctionHandler } from "./runtime";
import { wildcardMatcher } from "./matching";

interface LookupVector { length: number; at(index: number): Value | null; }
function vector(range: FormulaRange): LookupVector {
  if (range.rows !== 1 && range.columns !== 1) return fail("#VALUE!");
  if (range.rows * range.columns > SPREADSHEET_LIMITS.rangeCells) return fail("#LIMIT!");
  return { length: range.rows * range.columns, at: range.at };
}
function equalMatcher(value: Value, c: FunctionContext, wildcards: boolean) {
  const matches = wildcards && typeof value === "string" ? wildcardMatcher(value, c.tick) : undefined;
  return (candidate: Value) => matches ? typeof candidate === "string" && matches(candidate) : compareValues(candidate, value) === 0;
}
/** Linear lookups stay bounded and keep the original row/column position, including blank cells. */
function findIndex(values: LookupVector, value: Value, c: FunctionContext,
  mode: number, backwards = false, lastApproximateDuplicate = false) {
  const matches = equalMatcher(value, c, mode === 2);
  let best = -1, bestValue: Value | undefined;
  for (let offset = 0; offset < values.length; offset++) {
    c.tick(); const index = backwards ? values.length - offset - 1 : offset, candidate = checked(values.at(index) ?? 0);
    if (matches(candidate)) {
      if (!lastApproximateDuplicate) return index;
      best = index; bestValue = candidate; continue;
    }
    if (mode !== -1 && mode !== 1) continue;
    // Approximate numeric lookup must not select a text or logical candidate (or the reverse).
    if (typeof value !== typeof candidate) continue;
    const compared = compareValues(candidate, value);
    if (mode === -1 ? compared > 0 : compared < 0) continue;
    const improvement = bestValue === undefined ? 0 : compareValues(candidate, bestValue);
    if (best === -1 || (mode === -1 ? improvement > 0 : improvement < 0) || (lastApproximateDuplicate && improvement === 0)) {
      best = index; bestValue = candidate;
    }
  }
  return best;
}
function tableLookup(c: FunctionContext, horizontal: boolean) {
  c.checkArity(3, 4);
  const value = c.scalar(0), table = c.range(1), selected = integerArgument(c, 2);
  if (selected < 1) return fail("#VALUE!");
  if (selected > (horizontal ? table.rows : table.columns)) return fail("#REF!");
  const approximate = c.omitted(3) ? true : logical(c.scalar(3));
  const length = horizontal ? table.columns : table.rows;
  if (length > SPREADSHEET_LIMITS.rangeCells) return fail("#LIMIT!");
  const keys = { length, at: (offset: number) => table.at(horizontal ? offset : offset * table.columns) };
  const found = findIndex(keys, value, c, approximate ? -1 : 2, false, approximate);
  if (found === -1) return fail("#N/A");
  return checked(table.at(horizontal ? (selected - 1) * table.columns + found : found * table.columns + selected - 1) ?? 0);
}
export const LOOKUP_FUNCTIONS = {
  INDEX: c => {
    c.checkArity(2, 3); const table = c.range(0);
    let row = integerArgument(c, 1), column = integerArgument(c, 2, 1);
    if (c.omitted(2) && table.rows === 1) { column = row; row = 1; }
    else if (c.omitted(2) && table.columns !== 1) return fail("#VALUE!");
    // Array/whole-row return forms are deliberately outside this scalar evaluator.
    if (row < 1 || column < 1) return fail("#VALUE!");
    if (row > table.rows || column > table.columns) return fail("#REF!");
    return checked(table.at((row - 1) * table.columns + column - 1) ?? 0);
  },
  MATCH: c => {
    c.checkArity(2, 3); const value = c.scalar(0), keys = vector(c.range(1));
    const mode = c.omitted(2) ? 1 : number(c.scalar(2));
    if (![0, 1, -1].includes(mode)) return fail("#VALUE!");
    const found = findIndex(keys, value, c, mode === 0 ? 2 : -mode, false, mode !== 0);
    return found === -1 ? fail("#N/A") : found + 1;
  },
  VLOOKUP: c => tableLookup(c, false), HLOOKUP: c => tableLookup(c, true),
  XLOOKUP: c => {
    c.checkArity(3, 6);
    const value = c.scalar(0), lookup = c.range(1), returned = c.range(2), keys = vector(lookup);
    vector(returned);
    if (lookup.rows !== returned.rows || lookup.columns !== returned.columns) return fail("#VALUE!");
    const mode = c.omitted(4) ? 0 : number(c.scalar(4)), direction = c.omitted(5) ? 1 : number(c.scalar(5));
    if (![0, -1, 1, 2].includes(mode) || ![1, -1].includes(direction)) return fail("#VALUE!");
    const found = findIndex(keys, value, c, mode, direction === -1);
    if (found === -1) return c.omitted(3) ? fail("#N/A") : c.scalar(3);
    return checked(returned.at(found) ?? 0);
  },
} satisfies Record<string, FunctionHandler>;
