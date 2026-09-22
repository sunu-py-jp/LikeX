"use client";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createModelEditorController } from "../core";
import type { ModelEditorAdapter } from "../core";
import { executeFormCommands, getDefaultFormAnswers, normalizeForm, normalizeFormAnswers, serializeForm, validateFormAnswers } from "../model/index";
import type { FormAnswers, FormCommand, FormModel } from "../model/types";
import type { FormFeature, FormProps } from "../props";
export const formAdapter: ModelEditorAdapter<FormModel, FormCommand, FormFeature> = {
  normalize: normalizeForm, serialize: serializeForm, execute: executeFormCommands,
  features: ["fields", "reorder", "settings", "import", "export", "history", "preview", "submit"],
  getCommandFeatures: command => command.type === "form.replace" ? ["import"] : command.type === "form.update" ? ["settings"] : command.type === "field.move" ? ["fields", "reorder"] : ["fields"],
};
export function useFormEditor(props: FormProps) {
  const latest = useRef(props);
  const [controller] = useState(() => createModelEditorController(formAdapter, props.initialForm, { ...props, readOnly: props.readOnly || props.mode === "fill" }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [answers, updateAnswers] = useState<FormAnswers>(() => normalizeFormAnswers(props.initialForm, props.initialAnswers ?? {}));
  const answersRef = useRef(answers), [errors, setErrors] = useState<ReturnType<typeof validateFormAnswers>["errors"]>([]);
  const [submitting, setSubmitting] = useState(false), submission = useRef<AbortController | null>(null), mounted = useRef(true);
  useLayoutEffect(() => { latest.current = props; controller.configure({ ...props, readOnly: props.readOnly || props.mode === "fill" }); });
  useEffect(() => { mounted.current = true; controller.activate(); return () => { mounted.current = false; controller.dispose(); submission.current?.abort(); }; }, [controller]);
  const policy = `${props.mode}:${props.readOnly}:${snapshot.features.submit}`;
  useEffect(() => { submission.current?.abort(); submission.current = null; }, [snapshot.model, policy, props.onSubmit]);
  function currentAnswers() { const model = controller.getModel(); return { ...getDefaultFormAnswers(model), ...Object.fromEntries(Object.entries(answersRef.current).filter(([key]) => model.fields.some(field => field.id === key))) }; }
  function setAnswers(input: FormAnswers) {
    if (!mounted.current || latest.current.readOnly || submission.current) return false;
    try { const next = normalizeFormAnswers(controller.getModel(), input); answersRef.current = next; updateAnswers(next); setErrors([]); try { latest.current.onAnswersChange?.(structuredClone(next)); } catch { /* Observer cannot roll back accepted answers. */ } return true; }
    catch (cause) { controller.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "回答を変更できません。" }); return false; }
  }
  function validate() { return validateFormAnswers(controller.getModel(), currentAnswers()); }
  async function submit() {
    const options = latest.current;
    if (!mounted.current || options.readOnly || submission.current || !controller.getSnapshot().features.submit || !options.onSubmit || options.mode !== "fill") return false;
    const checked = validate(); setErrors(checked.errors); if (!checked.valid) return false;
    const abort = new AbortController(), form = controller.getModel(); submission.current = abort; setSubmitting(true); controller.setNotice(null);
    abort.signal.addEventListener("abort", () => { if (mounted.current && submission.current === abort) setSubmitting(false); }, { once: true });
    try {
      await options.onSubmit(structuredClone(checked.values), { form, signal: abort.signal, requestId: crypto.randomUUID() });
      if (!mounted.current || abort.signal.aborted || controller.getModel() !== form || latest.current.readOnly || latest.current.mode !== "fill" || latest.current.onSubmit !== options.onSubmit || !controller.getSnapshot().features.submit) return false;
      controller.setNotice({ kind: "success", text: "回答を送信しました。" });
      try { latest.current.onSubmitComplete?.(checked.values); } catch { /* Observer only. */ }
      return true;
    } catch (cause) { if (mounted.current && !abort.signal.aborted) controller.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "回答の送信に失敗しました。" }); return false; }
    finally { if (submission.current === abort) { submission.current = null; if (mounted.current) setSubmitting(false); } }
  }
  function cancelPending() { controller.cancelPending(); submission.current?.abort(); submission.current = null; if (mounted.current) setSubmitting(false); }
  useImperativeHandle(props.ref, () => ({ getForm: controller.getModel, execute: controller.execute, replace: controller.replace, save: controller.save, undo: controller.undo, redo: controller.redo, getAnswers: currentAnswers, setAnswers, validate, submit, cancelPending }));
  return { controller, snapshot, answers: { ...getDefaultFormAnswers(snapshot.model), ...Object.fromEntries(Object.entries(answers).filter(([key]) => snapshot.model.fields.some(field => field.id === key))) }, setAnswers, errors, setErrors, submitting, submit, validate };
}
