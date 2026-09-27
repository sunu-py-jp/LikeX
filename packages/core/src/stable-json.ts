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
  type FrameBase = { depth: number; popPath: boolean };
  type Frame = FrameBase & (
    | { kind: "value"; item: unknown }
    | { kind: "array"; item: unknown[]; index: number; count: number }
    | { kind: "object"; item: Record<string, unknown>; keys: string[]; index: number; written: boolean }
  );
  // Resume containers one child at a time. Deep documents do not consume the
  // JavaScript call stack, and wide documents do not create one task per child.
  const frames: Frame[] = [{ kind: "value", item: value, depth: 0, popPath: false }];
  const finish = (frame: Frame) => {
    frames.pop();
    if (frame.popPath) path.pop();
  };
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (frame.kind === "array") {
      if (frame.index === frame.count) {
        if (frame.count) newLine(frame.depth);
        append("]"); ancestors.delete(frame.item); finish(frame); continue;
      }
      const index = frame.index++;
      if (index) append(",");
      newLine(frame.depth + 1);
      const element = frame.item[index];
      if (compareKeys) path.push(index);
      frames.push({ kind: "value", item: element === undefined ? null : element, depth: frame.depth + 1, popPath: !!compareKeys });
      continue;
    }
    if (frame.kind === "object") {
      if (frame.index === frame.keys.length) {
        if (frame.written) newLine(frame.depth);
        append("}"); ancestors.delete(frame.item); finish(frame); continue;
      }
      const key = frame.keys[frame.index++], property = frame.item[key];
      if (property === undefined) continue;
      if (frame.written) append(",");
      newLine(frame.depth + 1); frame.written = true;
      writeString(key); append(space ? ": " : ":");
      if (compareKeys) path.push(key);
      frames.push({ kind: "value", item: property, depth: frame.depth + 1, popPath: !!compareKeys });
      continue;
    }
    const item = frame.item;
    if (item === null) { append("null"); finish(frame); continue; }
    switch (typeof item) {
      case "string": writeString(item); finish(frame); continue;
      case "boolean": append(item ? "true" : "false"); finish(frame); continue;
      case "number":
        if (!Number.isFinite(item)) throw new TypeError("JSON numbers must be finite.");
        append(JSON.stringify(item)); finish(frame); continue;
      case "object": break;
      default: throw new TypeError(`Unsupported JSON value: ${typeof item}.`);
    }
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError("JSON objects must be plain objects or arrays.");
    }
    if (Object.getOwnPropertySymbols(item).length > 0) throw new TypeError("JSON objects cannot have symbol keys.");
    if (ancestors.has(item)) throw new TypeError("JSON cannot contain a circular reference.");
    ancestors.add(item);
    if (array) {
      append("[");
      frames[frames.length - 1] = { kind: "array", item, index: 0, count: item.length, depth: frame.depth, popPath: frame.popPath };
    } else {
      append("{");
      // Sorting serialized keys directly preserves lexical order even for
      // numeric-looking keys ("10" before "2").
      const keys = Object.keys(item);
      if (compareKeys && keys.length > 1) {
        const objectPath = Object.freeze([...path]);
        keys.sort((left, right) => {
          const order = compareKeys(left, right, objectPath);
          return Number.isFinite(order) && order !== 0 ? order : left < right ? -1 : left > right ? 1 : 0;
        });
      } else keys.sort();
      frames[frames.length - 1] = { kind: "object", item: item as Record<string, unknown>, keys, index: 0, written: false, depth: frame.depth, popPath: frame.popPath };
    }
  }

  if (buffer) chunks.push(buffer);
  return chunks.join("");
}
