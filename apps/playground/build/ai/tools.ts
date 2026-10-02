import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, rename, stat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AIError } from "./provider.ts";
import { spreadsheetSearchArguments, spreadsheetSearchProperties } from "./spreadsheet-search.ts";
import { spreadsheetReadResult } from "./spreadsheet-read.ts";
import { checkSlideWrite, checkSlideWriteResult } from "./slide-write-policy.ts";
import { referenceNames, scriptArguments, slideTextCommands } from "./tool-definitions.ts";
import { commandSchemas, normalizeCommandValue, validateSchema } from "./command-schema.ts";
import { checkCommandReferences, WriteFailures } from "./write-diagnostics.ts";
import { AIToolError, invalidArgument } from "./tool-errors.ts";
import { AIRepetitionError, NoChangeTracker } from "./no-change.ts";
import { mapSlideFormatCommands, slideFormatCommands } from "./slide-format.ts";
import { slideSvgIntent } from "./slide-svg.ts";
import { AILiveDocumentUnavailable } from "./live-document.ts";
import type { AIJSONValue, AILiveDocumentExchange, AILiveDocumentResult } from "./protocol.ts";
export { toolDefinitions } from "./tool-definitions.ts";

export type AIModule = "spreadsheet" | "slide";
export const DOCUMENT_LIMIT = 8 * 1024 * 1024;
const TOOL_OUTPUT_LIMIT = 48_000;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AIError("ツール引数には JSON オブジェクトを指定してください。");
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new AIError("このツールで利用できない引数があります。");
}

function compactReceipts(receipts: AIJSONValue | undefined): unknown {
  if (receipts === undefined || JSON.stringify(receipts).length <= 16000) return receipts;
  if (Array.isArray(receipts)) {
    const items: AIJSONValue[] = [];
    let size = 0;
    for (const receipt of receipts) {
      const length = JSON.stringify(receipt).length;
      if (size + length > 15000) break;
      items.push(receipt); size += length;
    }
    return { items, total: receipts.length, truncated: true, note: "All commands were applied; receipts are truncated for context size. Inspect the affected sheet/page to obtain any omitted generated IDs before further edits." };
  }
  return { truncated: true, note: "The edit was applied. Inspect the affected sheet/page for generated IDs; the receipt exceeded the context limit." };
}

/** A request can only read its skill and edit its private native file through the shipped CLI. */
export class SkillWorkspace {
  private constructor(readonly repository: string, readonly module: AIModule, readonly directory: string, readonly original: string,
    private readonly live?: { targetId: string; exchange: AILiveDocumentExchange; onCommit?: (before: string, after: string) => void }) {}
  private mutations = 0;
  private readSequence = 0;
  private readonly snapshots = new Map<string, { document: string; token: string }>();
  private selectedSnapshot: { document: string; token: string } | undefined;
  private conflictNeedsInspection = false;
  currentReadRevision: string | undefined;
  get unresolvedLiveConflict() { return this.conflictNeedsInspection; }
  private readonly writeFailures = new WriteFailures();
  private readonly noChanges = new NoChangeTracker();
  get unresolvedMutationError() { return this.writeFailures.unresolved.length > 0; }
  get unresolvedWrites() { return this.writeFailures.unresolved; }
  get file() { return path.join(this.directory, this.module === "slide" ? "document.slon" : "document.spon"); }
  get skillDirectory() { return path.join(this.repository, "packages", this.module, "skills", `likex-${this.module}`); }

  static async create(repository: string, module: AIModule, document: string, live?: { targetId: string; exchange: AILiveDocumentExchange; onCommit?: (before: string, after: string) => void }) {
    if (Buffer.byteLength(document) > DOCUMENT_LIMIT) throw new AIError("ファイルは 8 MiB 以下にしてください。");
    const directory = await mkdtemp(path.join(os.tmpdir(), "likex-ai-"));
    const workspace = new SkillWorkspace(repository, module, directory, document, live);
    try { await writeFile(workspace.file, document, { mode: 0o600 }); return workspace; }
    catch (error) { await workspace.dispose(); throw error; }
  }

  async dispose() { await rm(this.directory, { recursive: true, force: true }); }

  private remember(snapshot: AILiveDocumentResult) {
    if (!this.live || snapshot.targetId !== this.live.targetId || typeof snapshot.document !== "string" ||
      Buffer.byteLength(snapshot.document) > DOCUMENT_LIMIT || typeof snapshot.token !== "string" || !snapshot.token || snapshot.token.length > 1000)
      throw new AILiveDocumentUnavailable("資料の同期結果・対象が正しくありません。");
    const readRevision = `read-${++this.readSequence}`;
    this.snapshots.set(readRevision, { document: snapshot.document, token: snapshot.token });
    let bytes = [...this.snapshots.values()].reduce((total, item) => total + Buffer.byteLength(item.document), 0);
    while (this.snapshots.size > 16 || bytes > 48 * 1024 * 1024) {
      const oldest = this.snapshots.keys().next().value!;
      bytes -= Buffer.byteLength(this.snapshots.get(oldest)!.document);
      this.snapshots.delete(oldest);
    }
    this.currentReadRevision = readRevision;
    return readRevision;
  }

  /** Reads refresh from the visible editor; writes select an explicit earlier observation instead. */
  async refresh(signal: AbortSignal) {
    if (!this.live) return undefined;
    const snapshot = await this.live.exchange({ action: "snapshot", targetId: this.live.targetId }, signal);
    signal.throwIfAborted();
    const readRevision = this.remember(snapshot);
    await writeFile(this.file, snapshot.document, { mode: 0o600 });
    return readRevision;
  }

  async skill() {
    const content = await this.readSource("SKILL.md");
    return { content, references: referenceNames[this.module] };
  }

  private async readSource(relative: string) {
    const base = await realpath(this.skillDirectory);
    const source = await realpath(path.join(base, relative));
    if (!source.startsWith(base + path.sep) || (await stat(source)).size > 2 * 1024 * 1024) throw new AIError("資料を読み込めませんでした。");
    return readFile(source, "utf8");
  }

  async invoke(name: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    let args = record(input);
    if (name === "read_skill") { keys(args, []); return this.skill(); }
    if (name === "read_reference") {
      keys(args, ["name", "offset", "limit"]);
      if (typeof args.name !== "string" || !referenceNames[this.module].includes(args.name)) throw new AIError("一覧にある reference の名前を指定してください。");
      const offset = args.offset ?? 0, limit = args.limit ?? 12_000;
      if (!Number.isSafeInteger(offset) || (offset as number) < 0 || !Number.isSafeInteger(limit) || (limit as number) < 100 || (limit as number) > 16_000) throw new AIError("offset または limit が不正です。");
      const content = await this.readSource(path.join("references", args.name));
      const end = Math.min(content.length, (offset as number) + (limit as number));
      return { name: args.name, content: content.slice(offset as number, end), totalCharacters: content.length, nextOffset: end < content.length ? end : null };
    }
    let script: Record<string, unknown> | undefined, recoveryCommands: unknown, recoveryPrepared = false;
    const textWrite = this.module === "slide" && name === "update_slide_text";
    const formatWrite = this.module === "slide" && name === "format_slide_elements";
    const svgWrite = this.module === "slide" && (name === "add_svg_image" || name === "update_svg_image");
    const svgMode = name === "update_svg_image" ? "update" : "add";
    const resolveIds = (name === "apply_commands" || name === "create_document" || textWrite || formatWrite || svgWrite) ? args.resolvesFailureIds ?? [] : name === "run_script" ? args.resolvesFailureIds ?? [] : [];
    try {
      if (this.live) {
        const isWrite = name === "apply_commands" || name === "create_document" || textWrite || formatWrite || svgWrite || name === "run_script" && ["apply", "create"].includes(String(args.operation));
        if (name === "create_document" || name === "run_script" && args.operation === "create")
          throw new AIToolError("逐次編集では資料全体の作り直しはできません。対象を取得し、apply_commands で必要なシート・ページを編集してください。", { code: "unsupported_live_reset" });
        if (isWrite) {
          const snapshot = !this.conflictNeedsInspection && typeof args.baseRevision === "string" ? this.snapshots.get(args.baseRevision) : undefined;
          if (!snapshot) throw new AIToolError("有効な取得時点がありません。対象を再取得し、その readRevision を baseRevision に指定してください。", { code: "invalid_read_revision", path: "baseRevision", retry: "Inspect the targets, then copy the returned readRevision into baseRevision. Never guess or reuse an expired read revision." });
          this.selectedSnapshot = snapshot;
          await writeFile(this.file, snapshot.document, { mode: 0o600 });
          args = { ...args }; delete args.baseRevision;
        } else await this.refresh(signal);
      }
      if (svgWrite) {
        recoveryCommands = slideSvgIntent(args, svgMode);
        this.writeFailures.prepare("apply", recoveryCommands, resolveIds);
        recoveryPrepared = true;
      }
      script = scriptArguments(this.module, name, args);
      if (name === "run_script") { script = { ...script }; delete script.resolvesFailureIds; }
      const writing = script.operation === "apply" || script.operation === "create";
      if (writing) {
        if (script.operation === "apply" && script.commands === undefined) invalidArgument("commands", "command array", undefined);
        if (formatWrite) {
          recoveryCommands = script.commands;
          this.writeFailures.prepare(String(script.operation), recoveryCommands, resolveIds);
          recoveryPrepared = true;
          const document = await readFile(this.file, "utf8");
          checkCommandReferences(this.module, document, script.commands as Record<string, unknown>[]);
          script.commands = mapSlideFormatCommands(document, script.commands as Record<string, unknown>[]);
        }
        if (script.commands !== undefined) {
          const { schema } = commandSchemas(this.repository, this.module);
          let normalizationError: unknown;
          script.commands = Array.isArray(script.commands) ? script.commands.map((command, index) => {
            try { return normalizeCommandValue(command, schema.items || {}, schema, `commands[${index}]`); }
            catch (error) { normalizationError ??= error; return command; }
          }) : normalizeCommandValue(script.commands, schema, schema);
          if (normalizationError) throw normalizationError;
        }
        if (!formatWrite && !svgWrite) this.writeFailures.prepare(String(script.operation), script.commands, resolveIds);
        recoveryPrepared = true;
        if (script.commands !== undefined) validateSchema(script.commands, commandSchemas(this.repository, this.module).schema);
      }
      const result = await this.script(script, signal);
      const observed = writing ? this.noChanges.observe(String(script.operation), script.commands, script.dryRun, result) : result;
      if (writing && !script.dryRun) this.writeFailures.resolved(resolveIds as string[]);
      if (script.operation === "inspect") { this.writeFailures.inspected(); this.conflictNeedsInspection = false; }
      return this.live && !writing && observed && typeof observed === "object" ? { ...observed, readRevision: this.currentReadRevision } : observed;
    } catch (error) {
      if (error instanceof AIRepetitionError || error instanceof AILiveDocumentUnavailable) throw error;
      // A concurrent human edit may require a completely different plan or no edit at all.
      // Do not impose the malformed-command recovery rule that forces the original batch.
      if (error instanceof AIToolError && error.details.code === "conflict") {
        this.conflictNeedsInspection = true;
        this.snapshots.clear();
        throw error;
      }
      if (error instanceof AIToolError && ["invalid_read_revision", "unsupported_live_reset"].includes(error.details.code)) throw error;
      if (script?.operation === "apply" || script?.operation === "create" || name === "apply_commands" || name === "create_document" || textWrite || formatWrite || svgWrite) {
        if (signal.aborted) throw error;
        const failedCommands = formatWrite ? recoveryCommands ?? slideFormatCommands(args) : svgWrite ? recoveryCommands ?? slideSvgIntent(args, svgMode) : script?.commands ?? (textWrite ? slideTextCommands(args) : args.commands);
        throw this.writeFailures.failed(String(script?.operation ?? (name === "create_document" ? "create" : "apply")), failedCommands, error, recoveryPrepared ? resolveIds as string[] : []);
      }
      throw error;
    }
  }

  private async script(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const selectors = this.module === "slide" ? { slideId: "slide-id", elementId: "element-id", masterId: "master-id", layoutId: "layout-id" } : { sheetId: "sheet-id", range: "range", drawingId: "drawing-id" };
    const searchKeys = this.module === "spreadsheet" ? Object.keys(spreadsheetSearchProperties) : [];
    keys(args, ["operation", "commands", "dryRun", "includeData", "overview", ...(this.module === "spreadsheet" ? ["includeFormat"] : []), ...Object.keys(selectors), ...searchKeys]);
    if (!["inspect", "apply", "validate", "create"].includes(String(args.operation))) throw new AIError("inspect / apply / validate / create を指定してください。");
    const operation = args.operation as string;
    const writing = operation === "apply" || operation === "create";
    if (!writing && (args.commands !== undefined || args.dryRun !== undefined)) throw new AIError("commands / dryRun は apply または create 専用です。");
    if (operation !== "inspect" && (args.includeData !== undefined || args.includeFormat !== undefined || args.overview !== undefined || [...Object.keys(selectors), ...searchKeys].some(key => args[key] !== undefined))) throw new AIError("選択引数は inspect 専用です。");
    if (["dryRun", "includeData", "includeFormat", "overview"].some(key => args[key] !== undefined && typeof args[key] !== "boolean")) throw new AIError("フラグには true / false を指定してください。");
    if (args.includeFormat !== undefined && (!args.sheetId || args.drawingId !== undefined || args.search !== undefined || args.overview !== undefined)) throw new AIError("includeFormat はシート・セル範囲の取得専用です。");
    if (args.overview && (args.includeData !== undefined || [...Object.keys(selectors), ...searchKeys].some(key => args[key] !== undefined))) throw new AIError("overview と他の取得・検索引数は併用できません。");
    const cli = [path.join(this.skillDirectory, "scripts/document.mjs"), operation, "--project", this.repository];
    if (operation !== "create") cli.push("--input", this.file);
    const candidate = path.join(this.directory, "candidate.json");
    const before = writing ? await readFile(this.file, "utf8") : undefined;
    const slideBefore = before && this.module === "slide" ? checkSlideWrite(before, operation, args.commands) : undefined;
    if (before && operation === "apply" && Array.isArray(args.commands)) checkCommandReferences(this.module, before, args.commands);
    if (writing && this.live && !args.dryRun) {
      if (!this.selectedSnapshot || operation !== "apply") throw new AILiveDocumentUnavailable("編集の取得時点がありません。");
      if (!Array.isArray(args.commands) || args.commands.length > 1000 || Buffer.byteLength(JSON.stringify(args.commands)) > 512 * 1024)
        throw new AIError("commands は 1,000 件・512 KiB 以下の配列にしてください。");
      const result = await this.live.exchange({ action: "commit", targetId: this.live.targetId,
        expected: { ...this.selectedSnapshot, scope: "document" }, operation: "apply", commands: args.commands as AIJSONValue[] }, signal);
      // Acknowledged native execution is authoritative, including generated IDs and receipts.
      try {
        const readRevision = this.remember(result);
        await writeFile(this.file, result.document, { mode: 0o600 });
        if (result.changed) { this.mutations++; this.live.onCommit?.(this.selectedSnapshot.document, result.document); }
        signal.throwIfAborted();
        const inspection = await this.execute([path.join(this.skillDirectory, "scripts/document.mjs"), "inspect", "--project", this.repository, "--input", this.file], signal);
        return { ...(inspection as Record<string, unknown>), operation, dryRun: false, written: true, commandCount: args.commands.length,
          changed: result.changed, readRevision, ...(result.receipts === undefined ? {} : { receipts: compactReceipts(result.receipts) }) };
      } catch (error) {
        if (signal.aborted || error instanceof AILiveDocumentUnavailable) throw error;
        throw new AILiveDocumentUnavailable("資料への編集は反映されましたが、実行結果を読み取れなかったため処理を停止しました。画面を確認してください。");
      }
    }
    if (writing) {
      if (operation === "apply" || args.commands !== undefined) {
        if (!Array.isArray(args.commands) || args.commands.length > 1000 || Buffer.byteLength(JSON.stringify(args.commands)) > 512 * 1024) throw new AIError("commands は 1,000 件・512 KiB 以下の配列にしてください。");
        const commandFile = path.join(this.directory, "commands.json");
        await writeFile(commandFile, JSON.stringify(args.commands), { mode: 0o600 });
        cli.push("--commands", commandFile);
      }
      cli.push("--output", candidate);
      if (args.dryRun) cli.push("--dry-run");
    }
    if (operation === "inspect") {
      if (args.search !== undefined || Object.keys(selectors).some(key => args[key] !== undefined)) cli.push("--compact-summary");
      if (args.overview) cli.push("--overview");
      else if (this.module === "slide") {
        if (args.slideId !== undefined) cli.push("--include-animations");
      } else cli.push(...spreadsheetSearchArguments(args));
      for (const [key, flag] of Object.entries(selectors)) if (args[key] !== undefined) {
        if (typeof args[key] !== "string" || !args[key] || (args[key] as string).length > 200 || (args[key] as string).startsWith("--")) throw new AIError("対象 ID または範囲が不正です。");
        cli.push(`--${flag}`, args[key] as string);
      }
      if (args.includeData) cli.push("--include-data");
    }
    try {
      const targeted = args.search !== undefined || Object.keys(selectors).some(key => args[key] !== undefined);
      const result = await this.execute(cli, signal, operation === "inspect" && targeted, operation === "inspect" && !targeted && !args.overview,
        this.module === "spreadsheet" && operation === "inspect" ? args.includeFormat === true : undefined);
      if (writing && !args.dryRun) {
        if ((await stat(candidate)).size > DOCUMENT_LIMIT) throw new AIError("変更後のファイルが 8 MiB を超えます。依頼を小さくしてください。");
        if (slideBefore) checkSlideWriteResult(slideBefore, await readFile(candidate, "utf8"), operation);
        signal.throwIfAborted();
        await rename(candidate, this.file);
        this.mutations++;

      }
      return result;
    } catch (error) {
      throw error;
    }
  }

  private execute(args: string[], signal: AbortSignal, compactSummary = false, includeCatalog = false, includeCellFormat?: boolean): Promise<unknown> {
    return new Promise((resolve, reject) => {
      execFile(process.execPath, args, {
        cwd: this.directory, signal, timeout: 15_000, maxBuffer: 1024 * 1024 + 1024,
        env: { PATH: path.dirname(process.execPath), LANG: "en_US.UTF-8", NODE_NO_WARNINGS: "1" },
      }, (error, stdout) => {
        if (signal.aborted) { reject(signal.reason); return; }
        let result;
        try { result = JSON.parse(stdout); }
        catch { reject(new AIError("操作スクリプトを完了できませんでした。ランタイムのビルドと入力サイズを確認してください。")); return; }
        if (error || result.ok !== true) {
          const detail = typeof result.error?.message === "string" ? result.error.message.replaceAll(this.directory, "[temporary]").replaceAll(this.repository, "[repository]").slice(0, 1600) : "実行に失敗しました。";
          const commandIndex = result.error?.commandIndex;
          const commandPath = Number.isSafeInteger(commandIndex) && commandIndex >= 0 && commandIndex < 1000 ? `commands[${commandIndex}]` : undefined;
          const addressPath = /^(addresses\[\d{1,6}\]):/.exec(detail)?.[1];
          reject(new AIToolError(`スクリプト: ${detail}`, {
            code: addressPath ? "invalid_argument" : "write_failed",
            ...(commandPath ? { path: commandPath + (addressPath ? `.${addressPath}` : "") } : {}),
            ...(addressPath ? { expected: "A valid same-sheet cell or A1 range within sheet bounds; inputs using ranges may expand to at most 10,000 unique cells." } : {}),
          })); return;
        }
        delete result.output;
        // A targeted read already identifies its selection; avoid resending unrelated sheet/slide lists.
        if (compactSummary && result.summary && typeof result.summary === "object") {
          delete result.summary.sheets;
          delete result.summary.slides;
        }
        // Imported catalogs can contain many layouts and slots. Return them on an
        // explicit list read, not on every edit/validation in a multi-page run.
        // Keep counts and page IDs so newly created pages remain addressable.
        if (!includeCatalog && result.summary && typeof result.summary === "object") {
          delete result.summary.masters;
          delete result.summary.layouts;
        }
        // Compact before enforcing the tool budget, so repeated cell styles do not
        // force tiny reads and exhaust the cumulative conversation context.
        if (includeCellFormat !== undefined) result = spreadsheetReadResult(result, includeCellFormat);
        if (JSON.stringify(result).length > TOOL_OUTPUT_LIMIT) { reject(new AIError("取得結果が大きすぎます。inspect の対象範囲を小さくするか、検索の limit / previewLength を減らしてください。")); return; }
        resolve(result);
      });
    });
  }

  async result(signal: AbortSignal, validate?: () => Promise<unknown>) {
    signal.throwIfAborted();
    if (this.unresolvedMutationError) throw new AIToolError(this.live
      ? "失敗した編集が残っています。反映済みの編集は保持されています。対象を確認して失敗したバッチ全体を修正してください。"
      : "失敗した編集が残っているため、変更を適用しませんでした。対象を確認してバッチ全体を修正してください。", { code: "unresolved_writes", unresolvedFailures: this.unresolvedWrites });
    if (validate) await validate(); else await this.invoke("run_script", { operation: "validate" }, signal);
    const document = this.live || this.mutations ? await readFile(this.file, "utf8") : this.original;
    signal.throwIfAborted();
    return { type: "result" as const, document, changed: this.live ? this.mutations > 0 : document !== this.original,
      ...(this.live ? { incremental: true as const } : {}) };
  }
}
