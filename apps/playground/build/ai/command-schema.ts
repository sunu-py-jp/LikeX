import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { invalidArgument } from "./tool-errors.ts";

export type JSONSchema = {
  type?: string | string[]; const?: unknown; enum?: unknown[]; $ref?: string; $defs?: Record<string, JSONSchema>;
  properties?: Record<string, JSONSchema>; required?: string[]; additionalProperties?: boolean | JSONSchema;
  patternProperties?: Record<string, JSONSchema>; anyOf?: JSONSchema[]; items?: JSONSchema | false;
  prefixItems?: JSONSchema[]; minItems?: number; maxItems?: number; minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number; pattern?: string; description?: string; [key: string]: unknown;
};
const cache = new Map<string, { modified: number; schema: JSONSchema; strict: JSONSchema }>();
export function commandSchemas(repository: string, module: "slide" | "spreadsheet") {
  const filename = path.join(repository, "packages", module, "skills", `likex-${module}`, "references/commands.schema.json");
  const modified = statSync(filename).mtimeMs;
  let entry = cache.get(filename);
  if (!entry || entry.modified !== modified) {
    const schema = JSON.parse(readFileSync(filename, "utf8")) as JSONSchema;
    entry = { modified, schema, strict: strictSchema(schema) };
    cache.set(filename, entry);
  }
  return entry;
}
function dereference(schema: JSONSchema, root: JSONSchema): JSONSchema {
  return schema.$ref ? dereference(root.$defs![schema.$ref.split("/").at(-1)!], root) : schema;
}
/** Select one native discriminated command without maintaining a second tool schema. */
export function commandVariant(root: JSONSchema, type: string): JSONSchema {
  const command = dereference(root.items || {}, root);
  const variant = (command.anyOf ?? [command]).map(item => dereference(item, root)).find(item => {
    const tag = dereference(item.properties?.type ?? {}, root);
    return tag.const === type || tag.enum?.includes(type);
  });
  if (!variant) throw new Error(`Native command schema is missing ${type}; rebuild the installed skills.`);
  return variant;
}
function acceptsNull(schema: JSONSchema, root: JSONSchema): boolean {
  const value = dereference(schema, root);
  return value.const === null || value.type === "null" || Array.isArray(value.type) && value.type.includes("null") || !!value.anyOf?.some(item => acceptsNull(item, root));
}
function mapValue(schema: JSONSchema): JSONSchema | undefined {
  return typeof schema.additionalProperties === "object" ? schema.additionalProperties : Object.values(schema.patternProperties ?? {})[0];
}
/** OpenAI's strict subset requires closed objects and explicit nullable optional properties. */
export function strictSchema(schema: JSONSchema, root = schema): JSONSchema {
  if (schema.$ref) {
    // Responses rejects all $ref siblings, including documentation annotations.
    // Never drop an unknown validation constraint added by a future schema generator.
    const unsupported = Object.keys(schema).filter(key => !["$ref", "description", "title", "$comment"].includes(key));
    if (unsupported.length) throw new Error(`Unsupported command schema $ref siblings: ${unsupported.join(", ")}`);
    return { $ref: schema.$ref };
  }
  const result: JSONSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["$schema", "$comment", "title", "properties", "required", "additionalProperties", "patternProperties", "prefixItems", "const"].includes(key)) continue;
    if (key === "$defs") result.$defs = Object.fromEntries(Object.entries(value as Record<string, JSONSchema>).map(([name, definition]) => [name, strictSchema(definition, root)]));
    else if (key === "anyOf") result.anyOf = (value as JSONSchema[]).map(item => strictSchema(item, root));
    else if (key === "items") { if (value !== false) result.items = strictSchema(value as JSONSchema, root); }
    else result[key] = value;
  }
  if ("const" in schema) { result.enum = [schema.const]; result.type = schema.const === null ? "null" : typeof schema.const; }
  if (schema.prefixItems) {
    // Fail closed if a future native API adds a heterogeneous tuple, rather than silently widening it.
    if (schema.prefixItems.some(item => JSON.stringify(item) !== JSON.stringify(schema.prefixItems![0]))) throw new Error("Unsupported heterogeneous command tuple");
    result.items = strictSchema(schema.prefixItems[0], root);
  }
  if (schema.type === "object") {
    const dictionary = mapValue(schema);
    if (dictionary) return { type: "array", description: "Dictionary entries. Use unique keys (for cells.set.values: cell addresses such as A1; rowHeights: numeric row keys).", items: {
      type: "object", properties: { key: { type: "string" }, value: strictSchema(dictionary, root) }, required: ["key", "value"], additionalProperties: false,
    } };
    result.properties = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => {
      const property = strictSchema(value, root);
      return [key, schema.required?.includes(key) || acceptsNull(value, root) ? property : { anyOf: [property, { type: "null" }] }];
    }));
    result.required = Object.keys(result.properties);
    result.additionalProperties = false;
  }
  return result;
}
function kind(value: unknown) { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }
function branch(schema: JSONSchema, value: unknown, root: JSONSchema): JSONSchema {
  const choices = schema.anyOf!.map(item => dereference(item, root));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const input = value as Record<string, unknown>;
    const discriminated = choices.filter(item => Object.entries(item.properties ?? {}).some(([key, property]) => "const" in dereference(property, root) && dereference(property, root).const === input[key]));
    if (discriminated.length === 1) return discriminated[0];
    const compatible = choices.filter(item => item.type === "object" && Object.keys(input).every(key => key in (item.properties ?? {}) || mapValue(item)));
    if (compatible.length) return compatible[0];
  }
  return choices.find(item => "const" in item && item.const === value) ?? choices.find(item => item.type === kind(value) || item.type === "number" && typeof value === "number") ?? choices[0];
}
/** Decode only synthetic nulls and dictionary entries; native nullable data is never discarded. */
export function normalizeCommandValue(value: unknown, schema: JSONSchema, root: JSONSchema, location = "commands"): unknown {
  const target = dereference(schema, root);
  if (target.anyOf) return normalizeCommandValue(value, branch(target, value, root), root, location);
  if (target.type === "object" && value && typeof value === "object") {
    const dictionary = mapValue(target);
    if (dictionary && Array.isArray(value)) {
      const output = Object.create(null) as Record<string, unknown>;
      value.forEach((entry: unknown, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) invalidArgument(`${location}[${index}]`, "{key,value}", entry);
        const pair = entry as Record<string, unknown>;
        if (typeof pair.key !== "string" || Object.keys(pair).some(key => key !== "key" && key !== "value")) invalidArgument(`${location}[${index}]`, "{key:string,value}", pair);
        if (Object.hasOwn(output, pair.key)) invalidArgument(`${location}[${index}].key`, "unique dictionary key", pair.key);
        output[pair.key] = normalizeCommandValue(pair.value, dictionary, root, `${location}.${pair.key}`);
      });
      return output;
    }
    if (!Array.isArray(value)) return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const property = target.properties?.[key] ?? dictionary;
      if (property && item === null && !target.required?.includes(key) && !dictionary && !acceptsNull(property, root)) return [];
      return [[key, property ? normalizeCommandValue(item, property, root, `${location}.${key}`) : item]];
    }));
  }
  if (Array.isArray(value) && target.type === "array") return value.map((item, index) => normalizeCommandValue(item, target.prefixItems?.[index] ?? (target.items || {}), root, `${location}[${index}]`));
  return value;
}
/** Validate generated structural constraints before spawning the CLI; model semantics remain authoritative. */
export function validateSchema(value: unknown, schema: JSONSchema, root = schema, location = "commands"): void {
  const target = dereference(schema, root);
  if (target.anyOf) {
    const selected = branch(target, value, root);
    // Unions with the same scalar type (e.g. tuple lengths) must try all alternatives.
    const failures: unknown[] = [];
    let matched = false;
    for (const option of [selected, ...target.anyOf.map(item => dereference(item, root)).filter(item => item !== selected)]) {
      try { validateSchema(value, option, root, location); matched = true; break; } catch (error) { failures.push(error); }
    }
    if (!matched) throw failures[0];
    // JSON Schema siblings still apply after a union matches (e.g. bounds on number|null).
  }
  if ("const" in target && value !== target.const) invalidArgument(location, target.const, value);
  if (target.enum && !target.enum.includes(value)) invalidArgument(location, target.enum, value);
  if (target.type) {
    const types = Array.isArray(target.type) ? target.type : [target.type];
    if (!types.some(type => type === kind(value) || type === "integer" && Number.isSafeInteger(value))) invalidArgument(location, types.join(" | "), value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || target.minimum !== undefined && value < target.minimum || target.maximum !== undefined && value > target.maximum) invalidArgument(location, `number ${target.minimum ?? "-∞"}…${target.maximum ?? "∞"}`, value);
  }
  if (typeof value === "string" && (target.minLength !== undefined && value.length < target.minLength || target.maxLength !== undefined && value.length > target.maxLength || target.pattern && !new RegExp(target.pattern).test(value))) invalidArgument(location, "valid string length/pattern", value);
  if (Array.isArray(value)) {
    if (target.minItems !== undefined && value.length < target.minItems || target.maxItems !== undefined && value.length > target.maxItems) invalidArgument(location, `array length ${target.minItems ?? 0}…${target.maxItems ?? "∞"}`, value.length);
    value.forEach((item, index) => validateSchema(item, target.prefixItems?.[index] ?? (target.items || {}), root, `${location}[${index}]`));
  } else if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    for (const key of target.required ?? []) if (!Object.hasOwn(input, key)) invalidArgument(`${location}.${key}`, "required property", undefined);
    for (const [key, item] of Object.entries(input)) {
      const property = target.properties?.[key] ?? Object.entries(target.patternProperties ?? {}).find(([pattern]) => new RegExp(pattern).test(key))?.[1] ?? (typeof target.additionalProperties === "object" ? target.additionalProperties : undefined);
      if (property) validateSchema(item, property, root, `${location}.${key}`);
      else if (target.additionalProperties === false) invalidArgument(`${location}.${key}`, `known property (${Object.keys(target.properties ?? {}).join(", ")})`, item);
    }
  }
}
export function normalizeCommands(repository: string, module: "slide" | "spreadsheet", value: unknown) {
  const { schema } = commandSchemas(repository, module);
  const result = normalizeCommandValue(value, schema, schema);
  validateSchema(result, schema);
  return result as Record<string, unknown>[];
}
