const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The AI usually needs stored input, not the same font/borders on every cell.
 * Project only the host response: native reads and the write baseline stay intact.
 */
export function spreadsheetReadResult(result: unknown, includeFormat: boolean): unknown {
  if (!object(result) || !object(result.selection)) return result;
  const selection = result.selection;
  if (!Array.isArray(selection.rows) && !Array.isArray(selection.cells)) return result;
  const cell = (value: unknown): unknown => {
    if (includeFormat || !object(value)) return value;
    const { format: omitted, ...rest } = value;
    void omitted;
    return rest;
  };
  return { ...result, selection: { ...selection,
    ...(Array.isArray(selection.rows) ? { rows: selection.rows.map(row => Array.isArray(row) ? row.map(cell) : row) } : {}),
    ...(Array.isArray(selection.cells) ? { cells: selection.cells.map(cell) } : {}),
    formatsOmitted: !includeFormat,
  } };
}
