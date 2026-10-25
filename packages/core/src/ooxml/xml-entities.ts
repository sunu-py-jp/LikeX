const namedEntities: Readonly<Record<string, string>> = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" });
const fail = (): never => { throw new Error("Office内のXMLが不正、または安全な読み込み上限を超えています"); };

/** Decode once, scanning forward and rejecting the first malformed entity.
 * A global pattern with `[^;]*` retries the remaining suffix at every bare `&`
 * before String.replace invokes its first callback, making invalid input quadratic.
 */
export function decodeXmlEntities(value: string): string {
  let ampersand = value.indexOf("&");
  if (ampersand < 0) return value;
  const parts: string[] = [];
  let start = 0;
  while (ampersand >= 0) {
    parts.push(value.slice(start, ampersand));
    const end = value.indexOf(";", ampersand + 1);
    if (end < 0) return fail();
    const entity = value.slice(ampersand + 1, end);
    if (Object.hasOwn(namedEntities, entity)) parts.push(namedEntities[entity]);
    else {
      if (!/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) return fail();
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!Number.isInteger(code) || code > 0x10ffff || (code < 32 && ![9, 10, 13].includes(code)) ||
        (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) return fail();
      parts.push(String.fromCodePoint(code));
    }
    start = end + 1;
    ampersand = value.indexOf("&", start);
  }
  parts.push(value.slice(start));
  return parts.join("");
}
