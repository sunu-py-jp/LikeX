import ts from 'typescript';

const JSON_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const OMITTED = ts.TypeFlags.Undefined | ts.TypeFlags.Never;
const utilityNames = new Set(['Readonly', 'Partial', 'Pick', 'Omit', 'Record', 'DeepReadonly', 'Array', 'ReadonlyArray']);
const own = (value, key) => Object.hasOwn(value, key);

/** Generate only the JSON-representable structural portion of a resolved TypeScript type. */
export function schemaFromType(checker, rootType, { title, comment, maxItems } = {}) {
  const definitions = Object.create(null);
  const names = new Map();
  const fail = (type, hint, reason) => {
    throw new Error(`Cannot generate JSON Schema for ${hint}: ${reason} (${checker.typeToString(type)})`);
  };
  const refName = (type, hint) => {
    const alias = type.aliasSymbol?.name ?? type.symbol?.name;
    const preferred = alias && !utilityNames.has(alias) && !alias.startsWith('__') ? alias : hint;
    const base = preferred.replace(/[^a-zA-Z0-9_]/g, '_');
    let candidate = base;
    for (let index = 2; own(definitions, candidate); index++) candidate = `${base}_${index}`;
    return candidate;
  };
  const literal = type => {
    if (type.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) return type.value;
    if (type.flags & ts.TypeFlags.BooleanLiteral) return type.intrinsicName === 'true';
    if (type.flags & ts.TypeFlags.Null) return null;
    return undefined;
  };
  const union = (types, hint) => {
    // undefined cannot occur in JSON. Optional fields may be absent; array callers
    // must use an allowed JSON value such as null instead of an undefined slot.
    const members = types.filter(type => !(type.flags & OMITTED));
    if (!members.length) return false;
    if (members.length === 1) return visit(members[0], hint);
    const values = members.map(literal);
    if (values.every(value => value !== undefined)) {
      if (values.length === 2 && values.includes(true) && values.includes(false)) return { type: 'boolean' };
      return { enum: values };
    }
    return { anyOf: members.map((type, index) => visit(type, `${hint}_${index + 1}`)) };
  };
  const object = (type, hint) => {
    if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length ||
      checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length)
      return fail(type, hint, 'callable and constructable values are not JSON');
    const properties = Object.create(null);
    const required = [];
    for (const property of checker.getPropertiesOfType(type)) {
      if (property.getName().startsWith('__@')) return fail(type, hint, 'symbol properties are not JSON');
      // Mapped keys (for example Record<'top' | 'left', T>) are synthesized
      // symbols without declarations; the checker still resolves their types.
      const propertyType = checker.getTypeOfSymbol(property);
      properties[property.name] = visit(propertyType, `${hint}_${property.name}`);
      const description = ts.displayPartsToString(property.getDocumentationComment(checker));
      if (description && properties[property.name] !== false) properties[property.name] = { ...properties[property.name], description };
      if (!(property.flags & ts.SymbolFlags.Optional)) required.push(property.name);
    }
    const indices = checker.getIndexInfosOfType(type);
    if (indices.length > 1) return fail(type, hint, 'multiple index signatures need an explicit mapping');
    if (!Object.keys(properties).length && !indices.length)
      return fail(type, hint, 'empty TypeScript object types do not constrain values to JSON objects');
    const schema = { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
    if (indices.length) {
      const index = indices[0];
      const values = visit(index.type, `${hint}_value`);
      if (index.keyType.flags & ts.TypeFlags.String) schema.additionalProperties = values;
      else if (index.keyType.flags & ts.TypeFlags.Number) {
        // JSON object keys are strings. Record<number, T> permits numeric keys,
        // not arbitrary labels. Runtime parsers further constrain dimensions.
        schema.patternProperties = { '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$': values };
      } else return fail(type, hint, 'unsupported index signature key type');
    }
    return schema;
  };
  const structural = (type, hint) => {
    if (type.isUnion()) return union(type.types, hint);
    if (checker.isTupleType(type)) {
      const target = type.target;
      if (target.elementFlags.some(flag => flag & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic)))
        return fail(type, hint, 'rest and variadic tuples need an explicit mapping');
      const elements = checker.getTypeArguments(type);
      return { type: 'array', prefixItems: elements.map((element, index) => visit(element, `${hint}_${index + 1}`)),
        minItems: target.minLength, maxItems: elements.length, items: false };
    }
    if (checker.isArrayType(type)) {
      const elements = checker.getTypeArguments(type);
      if (elements.length !== 1) return fail(type, hint, 'array must resolve exactly one element type');
      return { type: 'array', items: visit(elements[0], `${hint}_item`) };
    }
    if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) return object(type, hint);
    return fail(type, hint, 'unsupported resolved TypeScript construct');
  };
  function visit(type, hint) {
    if (type.flags & OMITTED) return false;
    if (type.isUnion() && type.types.some(member => member.flags & OMITTED)) {
      const members = type.types.filter(member => !(member.flags & OMITTED));
      if (!members.length) return false;
      if (members.length === 1) return visit(members[0], hint);
    }
    const value = literal(type);
    if (value !== undefined) return { const: value };
    if (type.flags & ts.TypeFlags.String) return { type: 'string' };
    if (type.flags & ts.TypeFlags.Number) return { type: 'number' };
    if (type.flags & ts.TypeFlags.Boolean) return { type: 'boolean' };
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.NonPrimitive |
      ts.TypeFlags.TypeParameter | ts.TypeFlags.Conditional | ts.TypeFlags.IndexedAccess |
      ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.Void))
      return fail(type, hint, 'unresolved or non-JSON type');
    if (names.has(type)) return { $ref: `#/$defs/${names.get(type)}` };
    const name = refName(type, hint);
    names.set(type, name);
    definitions[name] = null; // Reserve a name before visiting recursive children.
    definitions[name] = structural(type, name);
    return { $ref: `#/$defs/${name}` };
  }
  const root = visit(rootType, title);
  return { $schema: JSON_SCHEMA, title, $comment: comment,
    ...(maxItems === undefined ? root : { type: 'array', maxItems, items: root }), $defs: definitions };
}

/** Get exports via the checker so aliases, intersections, and mapped types resolve. */
export function exportedType(program, file, name) {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`Missing schema source: ${file}`);
  const sourceModule = checker.getSymbolAtLocation(source);
  const symbol = sourceModule && checker.getExportsOfModule(sourceModule).find(symbol => symbol.name === name);
  if (!symbol) throw new Error(`Missing schema type export: ${file}#${name}`);
  return checker.getDeclaredTypeOfSymbol(symbol);
}

/** Read literal constants without executing the application's runtime modules. */
export function numericConstant(program, file, name, propertyName) {
  const source = program.getSourceFile(file);
  const declaration = source?.statements.flatMap(statement => ts.isVariableStatement(statement)
    ? [...statement.declarationList.declarations] : []).find(node => ts.isIdentifier(node.name) && node.name.text === name);
  if (!declaration?.initializer) throw new Error(`Missing schema limit: ${file}#${name}`);
  let value = declaration.initializer;
  if (propertyName) {
    if (!ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression) ||
      value.expression.expression.getText(source) !== 'Object' || value.expression.name.text !== 'freeze' || value.arguments.length !== 1)
      throw new Error(`Schema limit ${name} must be an Object.freeze literal`);
    value = value.arguments[0];
    if (!ts.isObjectLiteralExpression(value)) throw new Error(`Schema limit ${name} must be an object literal`);
    value = value.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === propertyName)?.initializer;
  }
  if (!value || !ts.isNumericLiteral(value)) throw new Error(`Schema limit ${name}.${propertyName ?? ''} must be numeric`);
  const number = Number(value.text);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Schema limit ${name} is not a nonnegative integer`);
  return number;
}
