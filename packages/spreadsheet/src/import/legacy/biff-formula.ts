import { ByteReader } from "../../core";
import { columnName, readString } from "./biff";
import type { XlsBook } from "./biff-book";

/**
 * Built-in function table ([MS-XLS] Ftab): index, name and the fixed argument count used by
 * PtgFunc. Functions marked * take a variable count, which the token itself states.
 * An index that is absent here makes the whole formula fall back to its cached result.
 */
const FUNCTION_TABLE = `0 COUNT *|1 IF *|2 ISNA 1|3 ISERROR 1|4 SUM *|5 AVERAGE *|6 MIN *|7 MAX *|8 ROW *|9 COLUMN *|10 NA 0|11 NPV *|12 STDEV *|13 DOLLAR *|14 FIXED *|
15 SIN 1|16 COS 1|17 TAN 1|18 ATAN 1|19 PI 0|20 SQRT 1|21 EXP 1|22 LN 1|23 LOG10 1|24 ABS 1|25 INT 1|26 SIGN 1|27 ROUND 2|28 LOOKUP *|29 INDEX *|30 REPT 2|31 MID 3|
32 LEN 1|33 VALUE 1|34 TRUE 0|35 FALSE 0|36 AND *|37 OR *|38 NOT 1|39 MOD 2|40 DCOUNT 3|41 DSUM 3|42 DAVERAGE 3|43 DMIN 3|44 DMAX 3|45 DSTDEV 3|46 VAR *|47 DVAR 3|
48 TEXT 2|49 LINEST *|50 TREND *|51 LOGEST *|52 GROWTH *|56 PV *|57 FV *|58 NPER *|59 PMT *|60 RATE *|61 MIRR 3|62 IRR *|63 RAND 0|64 MATCH *|65 DATE 3|66 TIME 3|
67 DAY 1|68 MONTH 1|69 YEAR 1|70 WEEKDAY *|71 HOUR 1|72 MINUTE 1|73 SECOND 1|74 NOW 0|75 AREAS 1|76 ROWS 1|77 COLUMNS 1|78 OFFSET *|82 SEARCH *|83 TRANSPOSE 1|86 TYPE 1|
97 ATAN2 2|98 ASIN 1|99 ACOS 1|100 CHOOSE *|101 HLOOKUP *|102 VLOOKUP *|105 ISREF 1|109 LOG *|111 CHAR 1|112 LOWER 1|113 UPPER 1|114 PROPER 1|115 LEFT *|116 RIGHT *|
117 EXACT 2|118 TRIM 1|119 REPLACE 4|120 SUBSTITUTE *|121 CODE 1|124 FIND *|125 CELL *|126 ISERR 1|127 ISTEXT 1|128 ISNUMBER 1|129 ISBLANK 1|130 T 1|131 N 1|
140 DATEVALUE 1|141 TIMEVALUE 1|142 SLN 3|143 SYD 4|144 DDB *|148 INDIRECT *|162 CLEAN 1|163 MDETERM 1|164 MINVERSE 1|165 MMULT 2|167 IPMT *|168 PPMT *|169 COUNTA *|
183 PRODUCT *|184 FACT 1|189 DPRODUCT 3|190 ISNONTEXT 1|193 STDEVP *|194 VARP *|195 DSTDEVP 3|196 DVARP 3|197 TRUNC *|198 ISLOGICAL 1|199 DCOUNTA 3|204 USDOLLAR *|
205 FINDB *|206 SEARCHB *|207 REPLACEB 4|208 LEFTB *|209 RIGHTB *|210 MIDB 3|211 LENB 1|212 ROUNDUP 2|213 ROUNDDOWN 2|214 ASC 1|215 DBCS 1|216 RANK *|219 ADDRESS *|
220 DAYS360 *|221 TODAY 0|222 VDB *|227 MEDIAN *|228 SUMPRODUCT *|229 SINH 1|230 COSH 1|231 TANH 1|232 ASINH 1|233 ACOSH 1|234 ATANH 1|235 DGET 3|244 INFO 1|247 DB *|
252 FREQUENCY 2|261 ERROR.TYPE 1|269 AVEDEV *|270 BETADIST *|271 GAMMALN 1|272 BETAINV *|273 BINOMDIST 4|274 CHIDIST 2|275 CHIINV 2|276 COMBIN 2|277 CONFIDENCE 3|
278 CRITBINOM 3|279 EVEN 1|280 EXPONDIST 3|281 FDIST 3|282 FINV 3|283 FISHER 1|284 FISHERINV 1|285 FLOOR 2|286 GAMMADIST 4|287 GAMMAINV 3|288 CEILING 2|
289 HYPGEOMDIST 4|290 LOGNORMDIST 3|291 LOGINV 3|292 NEGBINOMDIST 3|293 NORMDIST 4|294 NORMSDIST 1|295 NORMINV 3|296 NORMSINV 1|297 STANDARDIZE 3|298 ODD 1|
299 PERMUT 2|300 POISSON 3|301 TDIST 3|302 WEIBULL 4|303 SUMXMY2 2|304 SUMX2MY2 2|305 SUMX2PY2 2|306 CHITEST 2|307 CORREL 2|308 COVAR 2|309 FORECAST 3|310 FTEST 2|
311 INTERCEPT 2|312 PEARSON 2|313 RSQ 2|314 STEYX 2|315 SLOPE 2|316 TTEST 4|317 PROB *|318 DEVSQ *|319 GEOMEAN *|320 HARMEAN *|321 SUMSQ *|322 KURT *|323 SKEW *|
324 ZTEST *|325 LARGE 2|326 SMALL 2|327 QUARTILE 2|328 PERCENTILE 2|329 PERCENTRANK *|330 MODE *|331 TRIMMEAN 2|332 TINV 2|336 CONCATENATE *|337 POWER 2|
342 RADIANS 1|343 DEGREES 1|344 SUBTOTAL *|345 SUMIF *|346 COUNTIF 2|347 COUNTBLANK 1|350 ISPMT 4|351 DATEDIF 3|352 DATESTRING 1|353 NUMBERSTRING 2|354 ROMAN *|
358 GETPIVOTDATA *|359 HYPERLINK *|360 PHONETIC 1|361 AVERAGEA *|362 MAXA *|363 MINA *|364 STDEVPA *|365 VARPA *|366 STDEVA *|367 VARA *|368 BAHTTEXT 1`;
const FUNCTIONS = new Map(FUNCTION_TABLE.split("|").map(entry => {
  const [index, name, count] = entry.trim().split(" ");
  return [Number(index), { name, fixed: count === "*" ? undefined : Number(count) }] as const;
}));
const BINARY: Readonly<Record<number, string>> = { 0x03: "+", 0x04: "-", 0x05: "*", 0x06: "/", 0x07: "^", 0x08: "&", 0x09: "<", 0x0a: "<=", 0x0b: "=", 0x0c: ">=",
  0x0d: ">", 0x0e: "<>", 0x0f: " ", 0x10: ",", 0x11: ":" };
export const XLS_ERRORS: Readonly<Record<number, string>> = { 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A" };
const MAX_DEPTH = 256;

export type FormulaContext = {
  book: XlsBook;
  /** Names of every sheet entry, in workbook order; three-dimensional references index into it. */
  sheetNames: readonly string[];
  /** The cell that owns the expression. Relative tokens of shared formulas, names and rules are offsets from it. */
  row: number; column: number;
};
export const numberText = (value: number): string | undefined => Number.isFinite(value) ? String(value).replace("e", "E") : undefined;
/** Sheet names need quoting unless they are plain identifiers that cannot be read as a cell address. */
export function sheetReference(name: string): string {
  return /^[A-Za-z_¡-￿][\w.¡-￿]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^[Rr]\d*[Cc]\d*$/.test(name) ? name : `'${name.replaceAll("'", "''")}'`;
}

/** BIFF8 packs the relative flags into the column field; relative parts of shared tokens are signed offsets. */
function reference(row: number, packed: number, context: FormulaContext, offsets: boolean): string {
  const rowRelative = !!(packed & 0x8000), columnRelative = !!(packed & 0x4000);
  let column = packed & 0xff;
  if (offsets) {
    if (rowRelative) row = (context.row + (row << 16 >> 16)) & 0xffff;
    if (columnRelative) column = (context.column + (column << 24 >> 24)) & 0xff;
  }
  return `${columnRelative ? "" : "$"}${columnName(column)}${rowRelative ? "" : "$"}${row + 1}`;
}
function area(reader: ByteReader, context: FormulaContext, offsets: boolean): string {
  const firstRow = reader.u16(), lastRow = reader.u16(), firstColumn = reader.u16(), lastColumn = reader.u16();
  const first = reference(firstRow, firstColumn, context, offsets), last = reference(lastRow, lastColumn, context, offsets);
  return first === last ? first : `${first}:${last}`;
}
/** Prefix for a three-dimensional reference; undefined when it leaves this workbook. */
function sheetPrefix(index: number, context: FormulaContext): string | undefined {
  const entry = context.book.externSheets[index], target = entry && context.book.supBooks[entry.book];
  if (!target || target.kind !== "self") return undefined;
  if (entry.first === 0xfffe) return "";
  const first = context.sheetNames[entry.first], last = context.sheetNames[entry.last];
  if (first === undefined || last === undefined) return "#REF!";
  return entry.first === entry.last ? `${sheetReference(first)}!` : `${sheetReference(`${first}:${last}`)}!`;
}
function arrayConstant(reader: ByteReader): string | undefined {
  const columns = reader.u8() + 1, rows = reader.u16() + 1, lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    const values: string[] = [];
    for (let column = 0; column < columns; column++) {
      const type = reader.u8();
      if (type === 0x01) { const text = numberText(reader.f64()); if (text === undefined) return undefined; values.push(text); }
      else if (type === 0x02) values.push(`"${readString(reader).replaceAll('"', '""')}"`);
      else if (type === 0x04) { values.push(reader.u8() ? "TRUE" : "FALSE"); reader.skip(7); }
      else if (type === 0x10) { const error = XLS_ERRORS[reader.u8()]; if (!error) return undefined; values.push(error); reader.skip(7); }
      else if (type === 0x00) { values.push(""); reader.skip(8); }
      else return undefined;
    }
    lines.push(values.join(","));
  }
  return `{${lines.join(";")}}`;
}

/**
 * Rebuilds formula text from a parsed expression. The stored tokens already contain every
 * parenthesis the author typed, so operands are joined without adding any. Returns undefined
 * for expressions that cannot be stated as text; the caller keeps the cached result instead.
 * Nothing is evaluated.
 */
export function formulaText(tokens: Uint8Array, extra: Uint8Array | undefined, context: FormulaContext): string | undefined {
  try {
    const reader = new ByteReader(tokens), extras = new ByteReader(extra ?? new Uint8Array()), stack: string[] = [];
    const pop = () => { const value = stack.pop(); if (value === undefined) throw new Error("operand"); return value; };
    while (reader.remaining) {
      const raw = reader.u8(), token = raw >= 0x20 ? 0x20 | raw & 0x1f : raw;
      if (stack.length > MAX_DEPTH) return undefined;
      if (BINARY[token]) { const right = pop(), left = pop(); stack.push(`${left}${BINARY[token]}${right}`); }
      else if (token === 0x12) stack.push(`+${pop()}`);
      else if (token === 0x13) stack.push(`-${pop()}`);
      else if (token === 0x14) stack.push(`${pop()}%`);
      else if (token === 0x15) stack.push(`(${pop()})`);
      else if (token === 0x16) stack.push("");
      else if (token === 0x17) stack.push(`"${readString(reader, 1).replaceAll('"', '""')}"`);
      else if (token === 0x19) {
        const flags = reader.u8(), data = reader.u16();
        if (flags & 0x04) reader.skip((data + 1) * 2);
        else if (flags & 0x10) stack.push(`SUM(${pop()})`);
      } else if (token === 0x1c) { const error = XLS_ERRORS[reader.u8()]; if (!error) return undefined; stack.push(error); }
      else if (token === 0x1d) stack.push(reader.u8() ? "TRUE" : "FALSE");
      else if (token === 0x1e) stack.push(String(reader.u16()));
      else if (token === 0x1f) { const text = numberText(reader.f64()); if (text === undefined) return undefined; stack.push(text); }
      else if (token === 0x20) { reader.skip(7); const constant = arrayConstant(extras); if (constant === undefined) return undefined; stack.push(constant); }
      else if (token === 0x21 || token === 0x22) {
        const stated = token === 0x22 ? reader.u8() & 0x7f : undefined, index = reader.u16();
        if (index & 0x8000) return undefined;
        const known = FUNCTIONS.get(index), count = stated ?? known?.fixed;
        if (count === undefined || index !== 0xff && !known) return undefined;
        const parameters: string[] = [];
        for (let position = 0; position < count; position++) parameters.unshift(pop());
        // Index 255 calls an add-in or user function whose name is the first operand.
        const name = index === 0xff ? parameters.shift() : known!.name;
        if (!name || !/^[A-Za-z_][\w.]*$/.test(name)) return undefined;
        stack.push(`${name}(${parameters.join(",")})`);
      } else if (token === 0x23) {
        const name = context.book.names[reader.u16() - 1];
        reader.skip(2);
        if (!name || name.builtin !== undefined) return undefined;
        stack.push(name.name);
      } else if (token === 0x24) { const row = reader.u16(); stack.push(reference(row, reader.u16(), context, false)); }
      else if (token === 0x25) stack.push(area(reader, context, false));
      else if (token === 0x26) { reader.skip(6); extras.skip(extras.u16() * 8); }
      else if (token === 0x27 || token === 0x28) reader.skip(6);
      else if (token === 0x29 || token === 0x2e || token === 0x2f) reader.skip(2);
      else if (token === 0x2a) { reader.skip(4); stack.push("#REF!"); }
      else if (token === 0x2b) { reader.skip(8); stack.push("#REF!"); }
      else if (token === 0x2c) { const row = reader.u16(); stack.push(reference(row, reader.u16(), context, true)); }
      else if (token === 0x2d) stack.push(area(reader, context, true));
      else if (token === 0x39) {
        const entry = context.book.externSheets[reader.u16()], index = reader.u16(), target = entry && context.book.supBooks[entry.book];
        reader.skip(2);
        const name = target?.kind === "self" ? context.book.names[index - 1]?.name : target?.kind === "addin" ? target.names[index - 1] : undefined;
        if (!name) return undefined;
        stack.push(name);
      } else if (token === 0x3a || token === 0x3b || token === 0x3c || token === 0x3d) {
        const prefix = sheetPrefix(reader.u16(), context);
        if (prefix === undefined) return undefined;
        if (token === 0x3c) { reader.skip(4); stack.push("#REF!"); continue; }
        if (token === 0x3d) { reader.skip(8); stack.push("#REF!"); continue; }
        const target = token === 0x3a ? reference(reader.u16(), reader.u16(), context, false) : area(reader, context, false);
        stack.push(prefix === "#REF!" ? "#REF!" : `${prefix}${target}`);
      } else return undefined;
    }
    return stack.length === 1 && stack[0] ? stack[0] : undefined;
  } catch { return undefined; }
}
/** The cell a PtgExp or PtgTbl expression points at, when the expression is nothing else. */
export function sharedFormulaTarget(tokens: Uint8Array): { row: number; column: number; table: boolean } | undefined {
  if (tokens.length !== 5 || tokens[0] !== 0x01 && tokens[0] !== 0x02) return undefined;
  const reader = new ByteReader(tokens, 1);
  return { row: reader.u16(), column: reader.u16(), table: tokens[0] === 0x02 };
}
