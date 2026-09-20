export type StableJsonOptions = {
  /** Maximum serialized UTF-16 length, including quotes and punctuation. */
  maxLength?: number;
  /** Optional domain order; ties retain UTF-16 key order. Arrays are never sorted. */
  compareKeys?: (left: string, right: string, path: readonly (string | number)[]) => number;
  /** Fixed indentation, from 0 (compact) to 10 spaces. Newlines are always LF. */
  space?: number;
};

/**
 * LikeX's stable JSON encoding: sorted object keys, unchanged array order,
 * fixed indentation, and JSON.stringify's primitive representations.
 * This is a document encoding rule, not an RFC 8785 implementation.
 */
export function serializeStableJson(value: unknown, options: StableJsonOptions = {}): string {
  const maxLength = options.maxLength ?? Infinity;
  if (options.maxLength !== undefined && (!Number.isSafeInteger(maxLength) || maxLength < 1)) {
    throw new RangeError("maxLength must be a positive safe integer.");
  }
  const space = options.space ?? 0;
  if (options.space !== undefined && (!Number.isInteger(options.space) || space < 0 || space > 10)) {
    throw new RangeError("space must be an integer between 0 and 10.");
  }
  const compareKeys = options.compareKeys;

  const chunks: string[] = [];
  const ancestors = new WeakSet<object>();
  const path: (string | number)[] = [];
  let length = 0;
  let buffer = "";
  const checkLength = (addition: number) => {
    if (addition > maxLength - length) throw new RangeError("Serialized JSON exceeds maxLength.");
  };
  const append = (part: string) => {
    checkLength(part.length);
    length += part.length;
    // Keep punctuation and short values together without building the whole
    // document through repeated string concatenation or one chunk per token.
    if (buffer.length + part.length > 16_384) {
      if (buffer) chunks.push(buffer);
      buffer = "";
    }
    if (part.length >= 16_384) chunks.push(part);
    else buffer += part;
  };
  const newLine = (depth: number) => {
    if (space === 0) return;
    checkLength(1 + space * depth);
    append("\n" + " ".repeat(space * depth));
  };
  const writeString = (text: string) => {
    if (maxLength !== Infinity) {
      // Reject oversized strings before allocating their escaped JSON form.
      let quotedLength = text.length + 2;
      checkLength(quotedLength);
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) {
          quotedLength += 1;
        } else if (code < 32) {
          quotedLength += 5;
        } else if (code >= 0xd800 && code <= 0xdbff) {
          const next = text.charCodeAt(index + 1);
          if (next >= 0xdc00 && next <= 0xdfff) index += 1;
          else quotedLength += 5;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          quotedLength += 5;
        }
        checkLength(quotedLength);
      }
    }
    append(JSON.stringify(text));
  };
  const write = (item: unknown, depth = 0): void => {
    if (item === null) {
      append("null");
      return;
    }
    switch (typeof item) {
      case "string":
        writeString(item);
        return;
      case "boolean":
        append(item ? "true" : "false");
        return;
      case "number":
        if (!Number.isFinite(item)) throw new TypeError("JSON numbers must be finite.");
        append(JSON.stringify(item));
        return;
      case "object":
        break;
      default:
        throw new TypeError(`Unsupported JSON value: ${typeof item}.`);
    }

    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError("JSON objects must be plain objects or arrays.");
    }
    if (Object.getOwnPropertySymbols(item).length > 0) throw new TypeError("JSON objects cannot have symbol keys.");
    if (ancestors.has(item)) throw new TypeError("JSON cannot contain a circular reference.");
    ancestors.add(item);
    try {
      if (array) {
        append("[");
        const count = item.length;
        for (let index = 0; index < count; index += 1) {
          if (index > 0) append(",");
          newLine(depth + 1);
          const element: unknown = item[index];
          if (compareKeys) path.push(index);
          write(element === undefined ? null : element, depth + 1);
          if (compareKeys) path.pop();
        }
        if (count > 0) newLine(depth);
        append("]");
      } else {
        append("{");
        let first = true;
        // Sorting the serialized keys directly also preserves lexical order
        // for numeric-looking keys ("10" before "2").
        const keys = Object.keys(item);
        if (compareKeys) {
          const objectPath = Object.freeze([...path]);
          keys.sort((left, right) => {
            const order = compareKeys(left, right, objectPath);
            return Number.isFinite(order) && order !== 0 ? order : left < right ? -1 : left > right ? 1 : 0;
          });
        } else keys.sort();
        for (const key of keys) {
          const property: unknown = (item as Record<string, unknown>)[key];
          if (property === undefined) continue;
          if (!first) append(",");
          newLine(depth + 1);
          first = false;
          writeString(key);
          append(space ? ": " : ":");
          if (compareKeys) path.push(key);
          write(property, depth + 1);
          if (compareKeys) path.pop();
        }
        if (!first) newLine(depth);
        append("}");
      }
    } finally {
      ancestors.delete(item);
    }
  };

  write(value);
  if (buffer) chunks.push(buffer);
  return chunks.join("");
}
