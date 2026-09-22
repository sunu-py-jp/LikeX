"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, CheckSquare, CircleDot, ClipboardList, Download, Eye, GripVertical, Hash, ListFilter, Redo2, Save, TextCursorInput, Trash2, Undo2, Upload, CalendarDays, AlignLeft, Pencil } from "lucide-react";
import { openContextMenu, type ContextMenuAction } from "../browser";
import { createPrimaryColorPalette } from "../core";
import { getVisibleFormFields, parseForm, serializeForm } from "../model/index";
import type { FormFieldType } from "../model/types";
import type { FormProps } from "../props";
import { useFormEditor } from "../state/use-form-editor";
import { FieldInspector } from "./field-inspector";
import { FormFields } from "./form-fields";
import { useFieldDrag } from "./use-field-drag";
const fieldTypes = [
  ["text", "記述式", TextCursorInput], ["textarea", "長文", AlignLeft], ["number", "数値", Hash], ["date", "日付", CalendarDays], ["select", "プルダウン", ListFilter], ["radio", "単一選択", CircleDot], ["checkbox", "チェック", CheckSquare],
] as const;
export function FormView(props: FormProps) {
  const editor = useFormEditor(props), { controller, snapshot, answers } = editor, { model, features } = snapshot;
  const closeMenu = useRef<(() => void) | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [preview, setPreview] = useState(false);
  const canvas = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => { const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined; if (!media) return; const changed = () => setSystemDark(media.matches); changed(); media.addEventListener("change", changed); return () => media.removeEventListener("change", changed); }, []);
  const colorMode = props.colorMode ?? props.theme ?? "light", mode = colorMode === "dark" || colorMode === "system" && systemDark ? "dark" : "light";
  const palette = createPrimaryColorPalette(props.primaryColor, mode) ?? createPrimaryColorPalette("#7046aa", mode)!;
  const filling = props.mode === "fill", showingAnswers = filling || preview && features.preview;
  const field = model.fields.find(item => item.id === selected), canEdit = snapshot.editable && !filling;
  const canReorder = canEdit && features.fields && features.reorder && !showingAnswers;
  useEffect(() => () => { closeMenu.current?.(); closeMenu.current = null; }, [model, features, snapshot.readOnly, snapshot.busy, showingAnswers]);
  const drag = useFieldDrag({ canvas, model, enabled: canReorder, move: (fieldId, index) => { void controller.execute({ type: "field.move", fieldId, index }); } });
  const draggedField = model.fields.find(item => item.id === drag.view?.fieldId);
  function add(type: FormFieldType, label: string, index?: number) {
    const id = crypto.randomUUID(); return controller.execute({ type: "field.add", index, field: { id, type, label: `${label}の質問`, ...(["select", "radio"].includes(type) ? { options: [{ value: "option1", label: "選択肢1" }, { value: "option2", label: "選択肢2" }] } : {}) } }).then(result => { if (result) setSelected(id); });
  }
  function showMenu(event: MouseEvent<HTMLElement>, items: ContextMenuAction[]) {
    const target = event.target as HTMLElement;
    if (showingAnswers || event.defaultPrevented || target.closest?.("input,textarea,select,[contenteditable]:not([contenteditable='false'])") || target.ownerDocument?.getSelection?.()?.isCollapsed === false || !items.length) return;
    event.preventDefault(); event.stopPropagation(); closeMenu.current?.();
    const source = controller.getModel();
    closeMenu.current = openContextMenu({ anchor: event.currentTarget, x: event.clientX, y: event.clientY,
      items: items.map(item => ({ ...item, onSelect: () => { if (controller.getModel() === source) return item.onSelect(); } })),
      onError: cause => controller.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "操作できませんでした。" }),
    });
  }
  function fieldMenu(event: MouseEvent<HTMLElement>, fieldId: string) {
    const source = controller.getModel(), index = source.fields.findIndex(item => item.id === fieldId), item = source.fields[index]; if (!item) return;
    const current = controller.getSnapshot(), items: ContextMenuAction[] = [];
    if (features.fields) {
      items.push({ id: "field.open", label: "項目の設定", onSelect: () => { if (controller.getSnapshot().features.fields) setSelected(fieldId); } },
        { id: "field.duplicate", label: "項目を複製", disabled: !current.editable, onSelect: async () => { const id = crypto.randomUUID(); const result = await controller.execute({ type: "field.add", index: index + 1, field: { ...item, id, label: `${item.label.slice(0, 490)}のコピー` } }); if (result) setSelected(id); } },
        { id: "field.add.after", label: "下に記述式の項目を追加", disabled: !current.editable, onSelect: () => add("text", "記述式", index + 1) });
      if (features.reorder) items.push({ id: "field.up", label: "上に移動", disabled: !current.editable || index === 0, onSelect: () => controller.execute({ type: "field.move", fieldId, index: index - 1 }) },
        { id: "field.down", label: "下に移動", disabled: !current.editable || index === source.fields.length - 1, onSelect: () => controller.execute({ type: "field.move", fieldId, index: index + 1 }) });
      items.push({ id: "field.delete", label: "項目を削除", danger: true, separatorBefore: true, disabled: !current.editable, onSelect: () => controller.execute({ type: "field.delete", fieldIds: [fieldId] }) });
    }
    showMenu(event, items);
  }
  function canvasMenu(event: MouseEvent<HTMLElement>) {
    const current = controller.getSnapshot(), items: ContextMenuAction[] = [];
    if (features.fields) for (const [type, label] of fieldTypes) items.push({ id: `field.add.${type}`, label: `${label}の項目を追加`, disabled: !current.editable, onSelect: () => add(type, label) });
    if (features.history) items.push({ id: "history.undo", label: "元に戻す", separatorBefore: items.length > 0, disabled: !current.editable || !current.canUndo, onSelect: controller.undo }, { id: "history.redo", label: "やり直す", disabled: !current.editable || !current.canRedo, onSelect: controller.redo });
    showMenu(event, items);
  }
  function download() { const blob = new Blob([serializeForm(model)], { type: "application/json" }), url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = "form.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return <section data-likex-form="" data-theme={mode} data-color-mode={mode} className={`lxf-root ${props.className ?? ""}`} style={{ "--lxf-primary": palette.primary, "--lxf-on-primary": palette.onPrimary, "--lxf-accent": palette.accent, ...props.style } as CSSProperties} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && !filling) {
      if (event.key.toLowerCase() === "s") { event.preventDefault(); void controller.save(); }
      else if (["z", "y"].includes(event.key.toLowerCase()) && !((event.target as HTMLElement).tagName === "INPUT" || (event.target as HTMLElement).tagName === "TEXTAREA")) { event.preventDefault(); void ((event.shiftKey || event.key.toLowerCase() === "y") ? controller.redo() : controller.undo()); }
    }
  }}>
    <header className="lxf-header"><ClipboardList size={20} /><strong>{props.title ?? "LikeForm"}</strong><span>{model.title}</span>{!filling && <div>{features.history && <><button type="button" title="元に戻す" aria-label="元に戻す" disabled={!canEdit || !snapshot.canUndo} onClick={() => void controller.undo()}><Undo2 size={18} /></button><button type="button" title="やり直す" aria-label="やり直す" disabled={!canEdit || !snapshot.canRedo} onClick={() => void controller.redo()}><Redo2 size={18} /></button></>}{!snapshot.readOnly && <button type="button" className="lxf-save" disabled={!canEdit || !snapshot.dirty} onClick={() => void controller.save()}><Save size={17} />{snapshot.busy === "save" ? "保存中…" : "保存"}</button>}</div>}</header>
    {!filling && <nav className="lxf-toolbar" aria-label="フォーム操作"><button type="button" aria-pressed={!showingAnswers} onClick={() => setPreview(false)}><Pencil size={16} />編集</button>{features.preview && <button type="button" aria-pressed={showingAnswers} onClick={() => setPreview(true)}><Eye size={16} />プレビュー</button>}<span />{features.import && !snapshot.readOnly && <button type="button" disabled={!canEdit} onClick={() => fileInput.current?.click()}><Upload size={16} />読み込み</button>}{features.export && <button type="button" onClick={download}><Download size={16} />JSON出力</button>}<input hidden ref={fileInput} type="file" accept=".json,application/json" aria-label="フォームJSON" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void controller.prepare(async () => { if (file.size > 8 * 1024 * 1024) throw new Error("JSONは8 MiB以下で指定してください。"); return { type: "form.replace", form: parseForm(await file.text()) }; }, { feature: "import" }); }} /></nav>}
    <div className="lxf-workspace">
      {!showingAnswers && features.fields && <aside className="lxf-palette"><h3>項目を追加</h3>{fieldTypes.map(([type, label, Icon]) => <button type="button" key={type} disabled={!canEdit} onClick={() => add(type, label)}><Icon size={18} />{label}</button>)}</aside>}
      <main ref={canvas} className="lxf-canvas" onContextMenu={canvasMenu}><div className="lxf-sheet">
        <div className="lxf-form-heading">{!showingAnswers && canEdit && features.settings ? <><input aria-label="フォームのタイトル" value={model.title} onChange={event => void controller.execute({ type: "form.update", patch: { title: event.target.value } }, { historyGroup: "form-title" })} /><textarea aria-label="フォームの説明" placeholder="フォームの説明" value={model.description} onChange={event => void controller.execute({ type: "form.update", patch: { description: event.target.value } }, { historyGroup: "form-description" })} /><label className="lxf-submit-label">送信ボタンの名前<input value={model.submitLabel} onChange={event => void controller.execute({ type: "form.update", patch: { submitLabel: event.target.value } }, { historyGroup: "form-submit-label" })} /></label></> : <><h1>{model.title}</h1>{model.description && <p>{model.description}</p>}</>}</div>
        {showingAnswers ? <form noValidate onSubmit={event => { event.preventDefault(); if (filling) void editor.submit(); else { const result = editor.validate(); editor.setErrors(result.errors); controller.setNotice({ kind: result.valid ? "success" : "error", text: result.valid ? "入力内容は有効です。プレビューのため送信されません。" : "入力内容を確認してください。" }); } }}>
          <FormFields fields={getVisibleFormFields(model, answers)} answers={answers} errors={editor.errors} disabled={!!props.readOnly || editor.submitting} onChange={(id, value) => editor.setAnswers({ ...answers, [id]: value })} />
          {(!filling || features.submit) && <button type="submit" className="lxf-primary" disabled={!!props.readOnly || editor.submitting || filling && !props.onSubmit}>{editor.submitting ? "送信中…" : model.submitLabel}</button>}
        </form> : <div className="lxf-field-list">{model.fields.length === 0 && <p className="lxf-empty">左のメニューから項目を追加してください。</p>}{model.fields.map((item, index) => <article key={item.id} data-form-field-id={item.id} onContextMenu={event => fieldMenu(event, item.id)} className={`lxf-field-card ${selected === item.id ? "lxf-selected" : ""} ${drag.view?.fieldId === item.id ? "lxf-drag-source" : ""}`} onClick={() => setSelected(item.id)}>
          <div className="lxf-field-card-heading">{features.fields && features.reorder && <button type="button" className="lxf-drag-handle" aria-label={`${item.label}をドラッグで移動`} disabled={!canReorder} onPointerDown={event => drag.start(event, item.id)} onClick={event => { if (drag.suppressClick()) { event.preventDefault(); event.stopPropagation(); } }}><GripVertical size={16} /></button>}<button type="button" className="lxf-field-select" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><strong>{item.label || "無題の項目"}</strong>{item.required && <span className="lxf-required"> *</span>}</button><span className="lxf-field-kind">{fieldTypes.find(([type]) => type === item.type)?.[1]}</span></div>
          {item.description && <p>{item.description}</p>}<div className="lxf-field-placeholder">{["select", "radio"].includes(item.type) ? item.options.map(option => option.label).join(" / ") : item.placeholder || "回答がここに入ります"}</div>
          {features.fields && <div className="lxf-field-actions">{features.reorder && <><button type="button" aria-label={`${item.label}を上へ`} disabled={!canReorder || index === 0} onClick={() => void controller.execute({ type: "field.move", fieldId: item.id, index: index - 1 })}><ArrowUp size={15} /></button><button type="button" aria-label={`${item.label}を下へ`} disabled={!canReorder || index === model.fields.length - 1} onClick={() => void controller.execute({ type: "field.move", fieldId: item.id, index: index + 1 })}><ArrowDown size={15} /></button></>}{features.fields && <button type="button" aria-label={`${item.label}を削除`} disabled={!canEdit} onClick={() => void controller.execute({ type: "field.delete", fieldIds: [item.id] })}><Trash2 size={15} /></button>}</div>}
        </article>)}</div>}
      </div></main>
      {!showingAnswers && field && features.fields && <FieldInspector field={field} form={model} disabled={!canEdit} update={patch => void controller.execute({ type: "field.update", fieldId: field.id, patch }, { historyGroup: `field:${field.id}` })} />}
    </div>
    {drag.view && draggedField && createPortal(<div className="lxf-drag-layer" aria-hidden="true" style={{ "--lxf-primary": palette.primary, "--lxf-background": mode === "dark" ? "#23252c" : "#fff", "--lxf-foreground": mode === "dark" ? "#edf0f5" : "#263342" } as CSSProperties}>
      <div className="lxf-drag-preview" style={{ left: drag.view.x, top: drag.view.y }}><strong><GripVertical size={14} />{draggedField.label || "無題の項目"}</strong><span>{fieldTypes.find(([type]) => type === draggedField.type)?.[1]}</span><p>{draggedField.description || draggedField.placeholder || "回答がここに入ります"}</p></div>
      {drag.view.line && <div className="lxf-drop-line" style={{ left: drag.view.line.x, top: drag.view.line.y, width: drag.view.line.width }} />}
    </div>, drag.view.portalHost)}
    <footer className="lxf-status" role="status"><span>{snapshot.notice?.text ?? `${model.fields.length} 項目`}</span>{snapshot.busy && <span>処理中…</span>}</footer>
  </section>;
}
