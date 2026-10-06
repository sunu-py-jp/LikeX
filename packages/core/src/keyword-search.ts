/** Literal keyword search shared by the server-side document search APIs. */
export type KeywordSearchQuery = Readonly<{
  keywords: readonly string[];
  operator?: "and" | "or";
  matchCase?: boolean;
}>;
/** Half-open UTF-16 positions in the original string, suitable for String.slice. */
export type KeywordTextMatch = Readonly<{ keyword: string; from: number; to: number }>;
export type KeywordSearchMatcher = Readonly<{
  readonly empty: boolean;
  /** Arrays group separate fields. A keyword never spans field boundaries. */
  test(text: string | readonly string[]): boolean;
  /** All literal occurrences, independent of the group's AND/OR condition. */
  find(text: string): readonly KeywordTextMatch[];
}>;

export function createKeywordSearchMatcher(query: KeywordSearchQuery): KeywordSearchMatcher {
  if (!query || typeof query !== "object" || Array.isArray(query) || ![Object.prototype, null].includes(Object.getPrototypeOf(query)))
    throw new Error("検索条件は64個以内のキーワードとAND/ORで指定してください");
  const fields = Object.getOwnPropertyDescriptors(query);
  if (Reflect.ownKeys(fields).some(key => typeof key !== "string" || !["keywords", "operator", "matchCase"].includes(key) || !Object.hasOwn(fields[key], "value")))
    throw new Error("検索条件はデータのみのオブジェクトで指定してください");
  const input: unknown = fields.keywords?.value;
  if (!Array.isArray(input) || input.length > 64 || Reflect.ownKeys(input).some(key => typeof key !== "string" || key !== "length" && !/^(0|[1-9]\d*)$/.test(key)))
    throw new Error("検索条件は64個以内のキーワード配列で指定してください");
  const operator = fields.operator?.value ?? "and", matchCase = fields.matchCase?.value ?? false;
  if (fields.operator?.value === null || fields.matchCase?.value === null) throw new Error("検索条件にnullは指定できません");
  if (!["and", "or"].includes(operator) || typeof matchCase !== "boolean")
    throw new Error("検索のoperatorはandまたはor、matchCaseはbooleanで指定してください");
  let length = 0;
  const keywords: string[] = [];
  for (let index = 0; index < input.length; index++) {
    const field = Object.getOwnPropertyDescriptor(input, String(index));
    if (!field || !Object.hasOwn(field, "value")) throw new Error("キーワード配列は空き・アクセサーのない文字列配列で指定してください");
    const keyword: unknown = field.value;
    if (typeof keyword !== "string" || !keyword.length || keyword.length > 4096)
      throw new Error("各キーワードは1〜4,096文字で指定してください");
    length += keyword.length;
    if (length > 16384) throw new Error("検索キーワードの合計は16,384文字以内で指定してください");
    if (!keywords.includes(keyword)) keywords.push(keyword);
  }
  // Escaping prevents supplied punctuation from becoming executable regex syntax.
  // Unicode ignore-case preserves offsets (unlike lowercasing a copy of the text).
  const patterns = keywords.map(keyword => new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu"));
  const matches = (pattern: RegExp, text: string) => { pattern.lastIndex = 0; return pattern.test(text); };
  return Object.freeze({
    empty: keywords.length === 0,
    test(input: string | readonly string[]) {
      const texts = typeof input === "string" ? [input] : input;
      if (!Array.isArray(texts) || texts.some(text => typeof text !== "string"))
        throw new Error("検索対象は文字列または文字列配列で指定してください");
      if (!patterns.length) return false;
      const found = (pattern: RegExp) => texts.some(text => matches(pattern, text));
      return operator === "and" ? patterns.every(found) : patterns.some(found);
    },
    find(text: string) {
      if (typeof text !== "string") throw new Error("検索対象は文字列で指定してください");
      const result: KeywordTextMatch[] = [];
      patterns.forEach((pattern, index) => {
        pattern.lastIndex = 0;
        for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
          if (result.length >= 10000) throw new Error("1つの検索対象文字列の一致位置は10,000件までです");
          result.push(Object.freeze({ keyword: keywords[index], from: match.index, to: match.index + match[0].length }));
        }
      });
      // Stable order for different keywords starting at the same position.
      result.sort((left, right) => left.from - right.from || left.to - right.to);
      return Object.freeze(result);
    },
  });
}
