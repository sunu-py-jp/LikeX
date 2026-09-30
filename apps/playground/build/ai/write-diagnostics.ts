import { expandCellAddresses, normalizeWorkbook, SPREADSHEET_LIMITS, type SpreadsheetDrawingAnchor } from "@likex/spreadsheet/model";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AIError } from "./provider.ts";
import { AIToolError, invalidArgument } from "./tool-errors.ts";

type Command = Record<string, unknown>;
const bindingKeys = ["start.binding.targetId", "end.binding.targetId"];
const targetValue = (command: Command, path: string): unknown => path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Command)[key] : undefined, command);
type Item = { id: string; rowCount?: number; columnCount?: number; elements?: Item[]; drawings?: Item[]; animations?: Item[] };
/** Reference checks are intentionally narrow: canonical model APIs still validate all semantics. */
export function checkCommandReferences(module: "slide" | "spreadsheet", document: string, commands: Command[]) {
  const native = JSON.parse(document) as { slides?: Item[]; sheets?: Item[]; layouts?: Item[] };
  const layouts = new Set((native.layouts ?? []).map(layout => layout.id));
  const pages = new Map((module === "slide" ? native.slides ?? [] : native.sheets ?? []).map(item => [item.id, {
    rowCount: item.rowCount, columnCount: item.columnCount, elements: new Set((item.elements ?? []).map(element => element.id)), drawings: new Set((item.drawings ?? []).map(drawing => drawing.id)), animations: new Set((item.animations ?? []).map(animation => animation.id)),
  }]));
  const requireId = (set: Set<string> | Map<string, unknown>, id: unknown, location: string) => {
    if (typeof id === "string" && !set.has(id)) invalidArgument(location, { existingIds: [...set.keys()].slice(0, 100), hint: "Copy an ID from inspect_document; never retype or invent an existing ID." }, id, "unknown_id");
  };
  commands.forEach((command, index) => {
    const location = `commands[${index}]`;
    const key = module === "slide" ? "slideId" : "sheetId";
    if (command[key] !== undefined) requireId(pages, command[key], `${location}.${key}`);
    if (module === "slide" && command.afterId !== undefined) requireId(pages, command.afterId, `${location}.afterId`);
    if (module === "slide" && command.layoutId !== undefined) requireId(layouts, command.layoutId, `${location}.layoutId`);
    const page = pages.get(String(command[key]));
    if (page) {
      if (module === "spreadsheet" && /^(rows|columns)\.(insert|delete)$/.test(String(command.type))) {
        const dimension = String(command.type).startsWith("rows") ? "rowCount" : "columnCount";
        const total = page[dimension];
        const insertion = String(command.type).endsWith("insert");
        if (typeof total === "number") {
          const indexValue = command.index as number;
          if (!Number.isSafeInteger(indexValue) || indexValue < 0 || indexValue > total - (insertion ? 0 : 1)) invalidArgument(`${location}.index`, `integer 0…${total - (insertion ? 0 : 1)}`, indexValue, "invalid_argument");
          const count = command.count ?? (Array.isArray(command.values) ? command.values.length : 1);
          if (!Number.isSafeInteger(count) || (count as number) < 1 || !insertion && (count as number) > total - indexValue) invalidArgument(`${location}.count`, insertion ? "positive integer" : `integer 1…${total - indexValue}`, count, "invalid_argument");
          page[dimension] = total + (insertion ? 1 : -1) * (count as number);
        }
      }
      for (const [field, set] of [["elementId", page.elements], ["sourceId", page.elements], ["targetId", page.elements], ["drawingId", page.drawings], ["animationId", page.animations]] as const) if (command[field] !== undefined) requireId(set, command[field], `${location}.${field}`);
      if (Array.isArray(command.elementIds)) command.elementIds.forEach((id, child) => requireId(page.elements, id, `${location}.elementIds[${child}]`));
      if (["line.add", "line.update", "lines.insert", "lines.update"].includes(String(command.type))) {
        for (const key of bindingKeys) requireId(module === "slide" ? page.elements : page.drawings, targetValue(command, key), `${location}.${key}`);
      }
      if (command.type === "element.add" && command.element && typeof command.element === "object") {
        const id = (command.element as Command).id; if (typeof id === "string") page.elements.add(id);
      }
      if (command.type === "line.add" && typeof command.id === "string") page.elements.add(command.id);
      if (command.type === "element.delete" && Array.isArray(command.elementIds)) command.elementIds.forEach(id => page.elements.delete(String(id)));
      if (command.type === "slide.replaceContent" && Array.isArray(command.elements)) {
        page.elements = new Set(command.elements.map(element => (element as Command).id).filter((id): id is string => typeof id === "string"));
        page.animations = new Set(Array.isArray(command.animations) ? command.animations.map(animation => String((animation as Command).id)) : []);
      }
      if (command.type === "animation.set" && Array.isArray(command.animations)) page.animations = new Set(command.animations.map(animation => String((animation as Command).id)));
      if (command.type === "animation.remove") page.animations.delete(String(command.animationId));
      if (command.type === "drawings.delete") page.drawings.delete(String(command.drawingId));
    }
    if (command.type === "slide.add" && command.slide && typeof command.slide === "object") {
      const slide = command.slide as Item;
      if (slide.id) pages.set(slide.id, { rowCount: undefined, columnCount: undefined, elements: new Set((slide.elements ?? []).map(element => element.id)), drawings: new Set(), animations: new Set((slide.animations ?? []).map(animation => animation.id)) });
    }
    if (command.type === "slide.delete" || command.type === "sheets.delete") pages.delete(String(command[key]));
  });
}
interface Failure {
  id: string; message: string; operation: string; commands: Command[]; fingerprint: string; readGeneration: number; unknownIdPath?: string; unknownReference?: { field: string; value: string; existingIds: string[]; scope: Command }; boundaryError?: boolean; commandIndexes?: number[]; target?: string; drawingAnchorCommandIndex?: number; compositionDensityCommandIndex?: number;
}
/** Text-density failures are distinct from count-cap, template-area and schema errors. */
function compositionDensityFailure(commands: unknown, error: unknown): number | undefined {
  if (!(error instanceof AIToolError) || error.details.code !== "write_failed" || !Array.isArray(commands) || !/(?:\d+行は領域に収まりません|\d+文字（書記素）以内)/.test(error.message)) return;
  const location = /^commands\[(\d+)\]$/.exec(error.details.path ?? "");
  if (location && commands[Number(location[1])]?.type === "slide.compose") return Number(location[1]);
  // The Slide CLI throws model errors without a command index. The dedicated
  // tool supplies exactly one command, making that target unambiguous.
  if (!location && commands.length === 1 && commands[0]?.type === "slide.compose") return 0;
}
/** Shorter copy can repair density; removing steps/nodes/relations cannot silently repair it. */
function preservesCompositionStructure(before: unknown, after: unknown): boolean {
  if (Array.isArray(before)) return Array.isArray(after) && after.length >= before.length && before.every((value, index) => preservesCompositionStructure(value, after[index]));
  if (!before || typeof before !== "object") return true;
  if (!after || typeof after !== "object" || Array.isArray(after)) return false;
  const next = after as Command;
  return Object.entries(before).every(([key, value]) => ["kind", "id", "from", "to"].includes(key) ? value === next[key]
    : value && typeof value === "object" ? preservesCompositionStructure(value, next[key]) : true);
}
/** Use the public model's anchor validation; the real sheet's bounds are rechecked by the CLI. */
function validDrawingAnchor(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["row", "column", "offsetX", "offsetY"].includes(key))) return false;
  const input = value as Command;
  const anchor = { ...input, offsetX: input.offsetX === undefined ? 0 : input.offsetX, offsetY: input.offsetY === undefined ? 0 : input.offsetY } as SpreadsheetDrawingAnchor;
  try {
    normalizeWorkbook({ sheets: [{ id: "anchor-check", name: "Anchor", rowCount: SPREADSHEET_LIMITS.rows, columnCount: SPREADSHEET_LIMITS.columns, cells: {},
      drawings: [{ id: "anchor-check", type: "text", anchor, width: 1, height: 1, text: "", fontSize: 16, color: "black", background: "transparent" }] }] });
    return true;
  } catch { return false; }
}
function drawingAnchorFailure(commands: unknown, error: unknown): number | undefined {
  if (!(error instanceof AIToolError) || error.details.code !== "write_failed" || !Array.isArray(commands) ||
    !/(?:^|: )描画オブジェクトの(?:サイズまたは位置が正しくありません|位置がシートの範囲外です)$/.test(error.message)) return;
  const location = /^commands\[(\d+)\]$/.exec(error.details.path ?? "");
  if (!location) return;
  const index = Number(location[1]), command = commands[index];
  if (!command || !["images.insert", "shapes.insert", "textBoxes.insert"].includes(command.type)) return;
  // The specific bounds error already proves an invalid anchor on the actual sheet.
  // The generic number error can also mean width/fontSize, so independently isolate the anchor.
  if (!error.message.endsWith("描画オブジェクトの位置がシートの範囲外です") && validDrawingAnchor(command.anchor)) return;
  return index;
}
function sameDrawingExceptAnchor(left: Command, right: Command): boolean {
  const omit = (command: Command) => Object.fromEntries(Object.entries(command).filter(([key]) => key !== "anchor"));
  return isDeepStrictEqual(omit(left), omit(right));
}
function unknownReference(commands: unknown, error: unknown): Failure["unknownReference"] {
  if (!(error instanceof AIToolError) || error.details.code !== "unknown_id" || !Array.isArray(commands)) return;
  const match = /^commands\[(\d+)\]\.(sheetId|slideId|layoutId|sourceId|targetId|elementId|drawingId|animationId|afterId|(?:start|end)\.binding\.targetId)$/.exec(error.details.path ?? "");
  const existingIds = (error.details.expected as { existingIds?: unknown } | undefined)?.existingIds;
  if (!match || typeof error.details.actual !== "string" || !Array.isArray(existingIds) || existingIds.some(id => typeof id !== "string")) return;
  const command = commands[Number(match[1])] as Command | undefined;
  const field = match[2];
  if (!command || targetValue(command, field) !== error.details.actual) return;
  const scope = ["sheetId", "slideId", "afterId"].includes(field) ? {} : Object.fromEntries(["sheetId", "slideId"].filter(key => command[key] !== undefined).map(key => [key, command[key]]));
  return { field, value: error.details.actual, existingIds, scope };
}
const fingerprint = (operation: string, commands: unknown) => createHash("sha256").update(JSON.stringify({ operation, commands })).digest("hex");
function recoveryInspection(failure: Failure) {
  const location = /^commands\[(\d+)\]\.(.+)$/.exec(failure.unknownIdPath ?? "");
  const command = location ? failure.commands[Number(location[1])] : undefined;
  // If the page identity itself is wrong, do not direct the model to inspect that invalid ID.
  if (location && ["sheetId", "slideId", "afterId"].includes(location[2])) return { query: { kind: "list" } };
  if (typeof command?.slideId === "string") return { query: { kind: "slide", slideId: command.slideId, includeData: true, elementId: null } };
  if (typeof command?.sheetId === "string") return { query: { kind: "sheet", sheetId: command.sheetId, includeData: true, offset: null, limit: null } };
  return { query: { kind: "overview" } };
}
/** Formatting/validation/replace selectors denote a cell set; spelling and enumeration order do not change the target. */
function sameAddressSelection(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || [...left, ...right].some(value => typeof value !== "string")) return false;
  try {
    // Only coordinate equivalence is checked here. Actual sheet bounds are evaluated by the
    // public command API at each staged operation, including earlier row/column insertions.
    const bounds = { rowCount: SPREADSHEET_LIMITS.rows, columnCount: SPREADSHEET_LIMITS.columns };
    const before = new Set(expandCellAddresses(bounds, left));
    const after = new Set(expandCellAddresses(bounds, right));
    return before.size === after.size && [...before].every(address => after.has(address));
  } catch { return false; }
}
/** Never let an unrelated successful write silently forgive an earlier rejected batch. */
export class WriteFailures {
  private failures = new Map<string, Failure>();
  private sequence = 0;
  private readGeneration = 0;
  private readonly splitRequests = new Map<string, { ids: string[]; readGeneration: number }>();
  get unresolved() { return [...this.failures.values()].map(({ id, message, commandIndexes, target }) => ({ failureId: id, message, ...(commandIndexes ? { commandIndexes } : {}), ...(target ? { target } : {}) })); }
  inspected() { this.readGeneration++; }
  prepare(operation: string, commands: unknown, resolveIds: unknown) {
    const hash = fingerprint(operation, commands);
    const split = this.splitRequests.get(hash);
    const splitFailure = split?.readGeneration === this.readGeneration ? split.ids.map(id => this.failures.get(id)).find(Boolean) : undefined;
    const repeat = splitFailure ?? [...this.failures.values()].find(failure => failure.fingerprint === hash && failure.readGeneration === this.readGeneration);
    if (repeat && !((repeat.boundaryError || !!repeat.commandIndexes && !splitFailure) && Array.isArray(resolveIds) && resolveIds.includes(repeat.id))) throw new AIToolError("同じ失敗した編集の再実行を抑止しました。エラー箇所を修正するか、対象を再取得してください。", { code: "repeated_failed_write", failureId: repeat.id, retry: "Use inspect_document to refresh the target or change the invalid command, then retry the ENTIRE failed batch with resolvesFailureIds:[failureId]." });
    if (!Array.isArray(resolveIds) || resolveIds.length > 32 || resolveIds.some(id => typeof id !== "string") || new Set(resolveIds).size !== resolveIds.length) invalidArgument("resolvesFailureIds", "up to 32 unique failure ID strings", resolveIds);
    for (const id of resolveIds) {
      const failure = this.failures.get(id);
      if (!failure) invalidArgument("resolvesFailureIds", { existingFailureIds: [...this.failures.keys()] }, id);
      const validCommands = commands === undefined && operation === "create" || Array.isArray(commands);
      const next = (commands ?? []) as Command[];
      if (validCommands && this.covers(failure, next, operation)) continue;
      // Probe the unchanged coverage rules with a future read generation only to explain
      // the rejection. This does not advance the real generation or authorize any write.
      if (validCommands && failure.readGeneration === this.readGeneration && this.covers(failure, next, operation, this.readGeneration + 1)) {
        const args = recoveryInspection(failure);
        throw new AIToolError("失敗後の対象の再取得が必要です。修正済みバッチの対象・操作は揃っています。まず指定の inspect_document を実行し、その後バッチ全体を再送してください。", {
          code: "write_recovery_requires_inspection", failureId: id, path: failure.unknownIdPath,
          expected: { tool: "inspect_document", arguments: args },
          retry: `First call inspect_document with ${JSON.stringify(args)} AFTER this failure. Then retry this entire corrected batch unchanged with resolvesFailureIds:[${JSON.stringify(id)}]. Do not send another write before the inspection. validate_document and read_reference do not satisfy this requirement.`,
        });
      }
      throw new AIToolError("再試行には、失敗したバッチ全体の対象・操作・項目を含めてください。対象の再取得だけでは、このバッチの不足や別対象への変更は解消しません。", {
        code: "incomplete_write_recovery", failureId: id,
        expected: { commandCount: failure.commands.length, operationTypes: [...new Set(failure.commands.map(command => command?.type).filter(type => typeof type === "string"))] },
        retry: "Restore every original target, operation and requested field in the failed batch. A slide.replaceContent supersedes element/animation content edits on that same page only; also retain slide.update metadata and all structural operations. Inspect before correcting an unknown ID, then retry the entire corrected batch with resolvesFailureIds:[failureId].",
      });
    }
    return hash;
  }
  failed(operation: string, commands: unknown, error: unknown, preparedRecoveryIds: string[] = []): AIToolError {
    if (error instanceof AIToolError && ["repeated_failed_write", "incomplete_write_recovery", "write_recovery_requires_inspection"].includes(error.details.code)) return error;
    const hash = fingerprint(operation, commands);
    if (error instanceof AIToolError && error.details.code === "slide_page_limit" && Array.isArray(commands)) {
      const groups = new Map<string, { commands: Command[]; indexes: number[] }>();
      const additions = commands.filter(command => command.type === "slide.add");
      commands.forEach((command: Command, index: number) => {
        const addedId = command.slide && typeof command.slide === "object" ? (command.slide as Command).id : undefined;
        const uniqueAddedId = typeof addedId === "string" && additions.filter(item => (item.slide as Command | undefined)?.id === addedId).length === 1;
        const target = command.type === "slide.add" ? uniqueAddedId ? `page:${addedId}` : `new-page:${index}`
          : ["slide.delete", "slide.move", "slide.duplicate", "deck.rename", "deck.resize", "masters.import"].includes(String(command.type)) ? `standalone:${index}` : `page:${String(command.slideId)}`;
        const group = groups.get(target) ?? { commands: [], indexes: [] };
        group.commands.push(command); group.indexes.push(index); groups.set(target, group);
      });
      if (groups.size > 1) {
        const ids: string[] = [];
        for (const [target, group] of groups) {
          const groupError = new AIToolError(`${error.message} 回復対象: ${target}; commands indexes: ${group.indexes.join(", ")}`, { code: "slide_page_limit_group" });
          const recovery = this.failed(operation, group.commands, groupError);
          const id = recovery.details.failureId!;
          const failure = this.failures.get(id)!;
          failure.commandIndexes = group.indexes; failure.target = target;
          ids.push(id);
        }
        // Full coverage was already checked before a retry can supersede these previous intents.
        preparedRecoveryIds.filter(id => !ids.includes(id)).forEach(id => this.failures.delete(id));
        this.splitRequests.set(hash, { ids, readGeneration: this.readGeneration });
        return new AIToolError(error.message, { code: "slide_page_limit", failureId: ids[0], retry: "The rejected batch was split into independent page/standalone recovery groups. For each unresolved failureId, submit exactly that group's commands (see original commandIndexes) as one apply_commands call with resolvesFailureIds:[failureId]. Complete all groups before finishing. Do not split a group further.", unresolvedFailures: this.unresolved });
      }
    }
    // A complete repair that reaches validation but discovers another error supersedes the
    // previous failed intent. Keep a stable ID and corrected targets for the next repair.
    const prior = preparedRecoveryIds.map(id => this.failures.get(id)).filter((item): item is Failure => !!item);
    let failure = prior[0] ?? [...this.failures.values()].find(entry => entry.fingerprint === hash);
    const message = error instanceof AIError ? error.message : "編集を完了できませんでした。";
    if (!failure || prior.length) {
      const id = failure?.id ?? `write-${++this.sequence}`;
      failure = { id, message, operation, commands: Array.isArray(commands) ? structuredClone(commands) : [], fingerprint: hash, readGeneration: this.readGeneration,
        ...(error instanceof AIToolError && (error.details.code === "unknown_id" || error.details.code === "invalid_argument") ? { unknownIdPath: error.details.path } : {}),
        unknownReference: unknownReference(commands, error),
        drawingAnchorCommandIndex: drawingAnchorFailure(commands, error),
        compositionDensityCommandIndex: compositionDensityFailure(commands, error),
        ...(error instanceof AIToolError && error.details.path && !error.details.path.startsWith("commands") ? { boundaryError: true } : {}) };
      prior.forEach(item => this.failures.delete(item.id));
      this.failures.set(id, failure);
    } else failure.readGeneration = this.readGeneration;
    return new AIToolError(message, { ...(error instanceof AIToolError ? error.details : { code: "write_failed" }), failureId: failure.id,
      retry: "Correct the command identified by path. Retry the ENTIRE failed batch with resolvesFailureIds:[failureId]; inspect first when correcting an unknown ID. Unrelated successful writes and validate_document do not resolve failed edits.", unresolvedFailures: this.unresolved });
  }
  resolved(ids: string[]) { for (const id of ids) this.failures.delete(id); }
  private covers(failure: Failure, next: Command[], operation: string, readGeneration = this.readGeneration) {
    if (operation !== failure.operation) return false;
    if (!failure.commands.length) return readGeneration > failure.readGeneration && (operation === "create" || failure.unknownIdPath === "commands") && (operation === "create" || next.length > 0);
    const used = new Set<number>();
    let correctedReference: string | undefined;
    return failure.commands.every((command, index) => {
      if (!command || typeof command !== "object" || (typeof command.type !== "string" && failure.unknownIdPath !== `commands[${index}].type`)) return false;
      const replacement = next.find(candidate => candidate.type === "slide.replaceContent" && candidate.slideId === command.slideId);
      if (replacement && ["element.add", "line.add", "line.update", "element.delete", "element.update", "element.duplicate", "element.order", "animation.set", "animation.remove", "slide.replaceContent"].includes(String(command.type))) return true;
      // Composition may reject inherited artwork for which a bespoke full-page layout
      // is necessary. It still replaces the same page, including requested notes.
      if (replacement && command.type === "slide.compose" && Array.isArray(replacement.elements) && replacement.elements.length > 0
        && (command.notes === undefined || command.notes === replacement.notes)) return true;
      const match = next.findIndex((candidate, nextIndex) => {
        if (used.has(nextIndex) || (candidate.type !== command.type && failure.unknownIdPath !== `commands[${index}].type`)) return false;
        if (failure.compositionDensityCommandIndex === index && !preservesCompositionStructure(command.composition, candidate.composition)) return false;
        let candidateReference: string | undefined;
        const targetKeys = ["sheetId", "slideId", "sourceId", "targetId", "elementId", "elementIds", "drawingId", "animationId", "afterId", "address", "addresses", "range", "ranges", "tableId", "namedRangeId", "index", "count", "row", "column", "anchor", "source", "target", "query", "mode", "shift", "clear", "direction", "discardContent", "onConflict", "partialMerges", ...bindingKeys];
        for (const key of targetKeys) {
          const beforeValue = targetValue(command, key), afterValue = targetValue(candidate, key);
          if (isDeepStrictEqual(afterValue ?? undefined, beforeValue ?? undefined)) continue;
          if (key === "addresses" && ["cells.format", "cells.validation", "cells.replace"].includes(String(command.type)) && sameAddressSelection(candidate[key], command[key])) continue;
          // A rejected new drawing has no existing object to retarget. Only its proven
          // invalid anchor may change; preserve every other field and every sibling target.
          if (key === "anchor" && failure.drawingAnchorCommandIndex === index && sameDrawingExceptAnchor(command, candidate) && validDrawingAnchor(candidate.anchor)) continue;
          const reference = failure.unknownReference;
          if ((reference?.field === key || reference && bindingKeys.includes(reference.field) && bindingKeys.includes(key)) && beforeValue === reference.value && Object.entries(reference.scope).every(([scopeKey, value]) => command[scopeKey] === value)) {
            // One mistyped ID often occurs throughout a batch. After a fresh read, allow
            // all of its occurrences to move together to one known ID, never split targets.
            if (failure.readGeneration >= readGeneration || typeof afterValue !== "string" || !reference.existingIds.includes(afterValue) || (correctedReference !== undefined && correctedReference !== afterValue || candidateReference !== undefined && candidateReference !== afterValue)) return false;
            candidateReference = afterValue;
            continue;
          }
          if (failure.readGeneration < readGeneration && failure.unknownIdPath?.startsWith(`commands[${index}].${key}`)) continue;
          return false;
        }
        // A failed two-ended edit must not be "repaired" by omitting one endpoint or marker.
        if (["line.add", "line.update", "lines.insert", "lines.update"].includes(String(command.type)) &&
          ["start", "end", "startArrow", "endArrow"].some(key => command[key] !== undefined && candidate[key] === undefined)) return false;
        // Avoid resolving a multi-target value write using a write to a different cell.
        if (command.type === "cells.set" && command.values && typeof command.values === "object") {
          const keys = Array.isArray(command.values) ? command.values.map(entry => entry && typeof entry === "object" ? (entry as Command).key : undefined) : Object.keys(command.values);
          if (!candidate.values || typeof candidate.values !== "object" || keys.some(key => typeof key !== "string" || !Object.hasOwn(candidate.values!, key))) return false;
        }
        for (const key of ["headers", "values"]) {
          if (Array.isArray(command[key]) && Array.isArray(candidate[key]) && (candidate[key] as unknown[]).length < (command[key] as unknown[]).length) return false;
        }
        for (const key of ["data", "payload"]) {
          const before = command[key] as Command | undefined, after = candidate[key] as Command | undefined;
          const beforeRows = before?.values, afterRows = after?.values;
          if (Array.isArray(beforeRows) && (!Array.isArray(afterRows) || afterRows.length < beforeRows.length || beforeRows.some((row, rowIndex) => Array.isArray(row) && (!Array.isArray(afterRows[rowIndex]) || afterRows[rowIndex].length < row.length)))) return false;
        }
        // Retain all originally requested patch fields; fixing a value must not silently drop another edit.
        if (command.patch && typeof command.patch === "object" && (!candidate.patch || typeof candidate.patch !== "object" || Object.keys(command.patch).some(key => !Object.hasOwn(candidate.patch!, key)))) return false;
        if (candidateReference !== undefined) correctedReference = candidateReference;
        return true;
      });
      if (match < 0) return false;
      used.add(match); return true;
    });
  }
}
