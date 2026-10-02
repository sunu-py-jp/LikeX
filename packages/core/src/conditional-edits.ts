/** Differences between the state used to plan an edit and the state at commit time. */
export type ConditionalEditConflict = Readonly<{
  path: string;
  expected: unknown;
  actual: unknown;
  /** Presence flags distinguish a missing property from an explicit null value on JSON transports. */
  expectedExists?: boolean;
  actualExists?: boolean;
}>;

/** Compare normalized model data without depending on object key insertion order.
 * A bounded list is diagnostic only: one returned difference rejects the entire transaction.
 */
export function collectConditionalConflicts(expected: unknown, actual: unknown, path = "", limit = 100): ConditionalEditConflict[] {
  const conflicts: ConditionalEditConflict[] = [];
  const maximum = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
  function visit(before: unknown, current: unknown, location: string, beforeExists = true, currentExists = true) {
    if (conflicts.length >= maximum || beforeExists === currentExists && Object.is(before, current)) return;
    if (beforeExists && currentExists && before !== null && current !== null && typeof before === "object" && typeof current === "object" &&
      Array.isArray(before) === Array.isArray(current)) {
      if (Array.isArray(before) && Array.isArray(current)) {
        if (before.length !== current.length) conflicts.push({ path: `${location}.length`, expected: before.length, actual: current.length });
        for (let index = 0; index < Math.max(before.length, current.length) && conflicts.length < maximum; index++)
          visit(before[index], current[index], `${location}[${index}]`, index in before, index in current);
      } else {
        for (const key of new Set([...Object.keys(before), ...Object.keys(current)])) {
          visit(Reflect.get(before, key), Reflect.get(current, key), location ? `${location}.${key}` : key, Object.hasOwn(before, key), Object.hasOwn(current, key));
          if (conflicts.length >= maximum) break;
        }
      }
      return;
    }
    conflicts.push({ path: location || "$", expected: before, actual: current,
      ...(beforeExists && currentExists ? {} : { expectedExists: beforeExists, actualExists: currentExists }) });
  }
  visit(expected, actual, path);
  return conflicts;
}
