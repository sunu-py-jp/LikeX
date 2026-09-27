import type { AIChatContentPart, AIChatJSONValue } from "./types";
import { AICHAT_LIMITS, freeze, identifier, list, record, string } from "./validation";

/** Copy strict JSON without invoking accessors or silently losing unsupported values. */
function copyData(input: unknown): AIChatJSONValue {
  const ancestors = new Set<object>();
  let nodes = 0, length = 0;
  function addLength(size: number) {
    length += size;
    if (length > AICHAT_LIMITS.partDataLength) throw new Error("Content part data exceeds its size limit.");
  }
  function copy(value: unknown, depth: number): AIChatJSONValue {
    if (++nodes > AICHAT_LIMITS.partNodes || depth > AICHAT_LIMITS.partDepth) throw new Error("Content part data exceeds its structure limit.");
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
      addLength(JSON.stringify(value).length); return value;
    }
    if (typeof value === "string") {
      string(value, "Content part string", AICHAT_LIMITS.partDataLength);
      addLength(JSON.stringify(value).length); return value;
    }
    if (!value || typeof value !== "object") throw new Error("Content part data must contain only JSON values.");
    if (ancestors.has(value)) throw new Error("Content part data cannot contain cycles.");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype || value.length > AICHAT_LIMITS.partNodes || Reflect.ownKeys(value).length !== value.length + 1) throw new Error("Content part arrays must contain only JSON elements.");
        addLength(2 + Math.max(0, value.length - 1));
        const result: AIChatJSONValue[] = [];
        for (let index = 0; index < value.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new Error("Content part arrays cannot contain holes or accessors.");
          result.push(copy(descriptor.value, depth + 1));
        }
        return result;
      }
      const raw = record(value, "Content part data"), keys = Object.keys(raw);
      if (Reflect.ownKeys(raw).length !== keys.length || keys.length > AICHAT_LIMITS.partNodes) throw new Error("Content part objects require enumerable JSON properties.");
      addLength(2 + Math.max(0, keys.length - 1));
      const result: { [key: string]: AIChatJSONValue } = {};
      for (const key of keys) {
        string(key, "Content part property", AICHAT_LIMITS.partDataLength);
        addLength(JSON.stringify(key).length + 1);
        Object.defineProperty(result, key, { value: copy(raw[key], depth + 1), enumerable: true, configurable: true, writable: true });
      }
      return result;
    } finally { ancestors.delete(value); }
  }
  return copy(input, 0);
}

export function normalizeAIChatContentPart(input: unknown): AIChatContentPart {
  const raw = record(input, "Content part", ["id", "type", "data"]);
  return freeze({ id: identifier(raw.id), type: string(raw.type, "Content part type", 200, false), data: copyData(raw.data) });
}

export function normalizeAIChatContentParts(input: unknown): AIChatContentPart[] {
  const values = list(input, "Content parts", AICHAT_LIMITS.parts);
  if (Object.getPrototypeOf(values) !== Array.prototype || Reflect.ownKeys(values).length !== values.length + 1) throw new Error("Content parts must be a plain dense array.");
  const parts: AIChatContentPart[] = [];
  for (let index = 0; index < values.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new Error("Content parts cannot contain holes or accessors.");
    parts.push(normalizeAIChatContentPart(descriptor.value));
  }
  if (new Set(parts.map(part => part.id)).size !== parts.length) throw new Error("Duplicate content part IDs.");
  return parts;
}
