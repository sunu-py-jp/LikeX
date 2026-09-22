import { normalizeField, normalizeForm } from "./form";
import type { FormCommand, FormModel } from "./types";
import { FORM_LIMITS, id, index, record } from "./validation";

/** Applies an atomic batch; the input and its nested arrays are never changed. */
export function executeFormCommands(input: FormModel, commands: readonly FormCommand[]): FormModel {
  let model = structuredClone(normalizeForm(input));
  if (!Array.isArray(commands) || commands.length > FORM_LIMITS.commands) throw new Error("コマンド数が上限を超えています。");
  for (const command of commands) {
    if (!command || typeof command !== "object") throw new Error("コマンドが不正です。");
    switch (command.type) {
      case "form.replace": record(command, ["type", "form"], "コマンド"); model = structuredClone(normalizeForm(command.form)); break;
      case "form.update": record(command, ["type", "patch"], "コマンド"); Object.assign(model, record(command.patch, ["title", "description", "submitLabel"], "変更内容")); break;
      case "field.add": {
        record(command, ["type", "field", "index"], "コマンド");
        const field = normalizeField({ ...command.field, id: command.field.id ?? crypto.randomUUID() });
        model.fields.splice(command.index === undefined ? model.fields.length : index(command.index, model.fields.length), 0, field); break;
      }
      case "field.update": {
        record(command, ["type", "fieldId", "patch"], "コマンド"); const field = model.fields.find(item => item.id === id(command.fieldId));
        if (!field) throw new Error("項目が見つかりません。");
        record(command.patch, ["type", "label", "description", "placeholder", "required", "options", "defaultValue", "min", "max", "minLength", "maxLength", "visibleWhen"], "変更内容");
        Object.assign(field, command.patch); break;
      }
      case "field.delete": {
        record(command, ["type", "fieldIds"], "コマンド");
        if (!Array.isArray(command.fieldIds)) throw new Error("項目IDを配列で指定してください。");
        const ids = new Set(command.fieldIds.map((item: unknown) => id(item)));
        if ([...ids].some(item => !model.fields.some(field => field.id === item))) throw new Error("項目が見つかりません。");
        model.fields = model.fields.filter(field => !ids.has(field.id));
        for (const field of model.fields) if (field.visibleWhen && ids.has(field.visibleWhen.fieldId)) delete field.visibleWhen;
        break;
      }
      case "field.move": {
        record(command, ["type", "fieldId", "index"], "コマンド"); const from = model.fields.findIndex(field => field.id === id(command.fieldId));
        if (from < 0) throw new Error("項目が見つかりません。");
        const to = index(command.index, model.fields.length - 1), [field] = model.fields.splice(from, 1); model.fields.splice(to, 0, field); break;
      }
      default: throw new Error("未対応のコマンドです。");
    }
    model = structuredClone(normalizeForm(model));
  }
  return normalizeForm(model);
}
