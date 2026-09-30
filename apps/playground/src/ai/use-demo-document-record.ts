import { useCallback, useEffect, useRef, useState } from "react";
import { demoDocumentStore, type DemoDocumentRecord } from "./demo-document-store";

/** Demo persistence belongs to the host, not to the editor or AI chat components. */
export function useDemoDocumentRecord(initial: DemoDocumentRecord) {
  const saved = useRef(initial), saving = useRef(false), mounted = useRef(false);
  const [record, setRecord] = useState(initial), [isSaving, setSaving] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const persist = useCallback(async (document: string, title: string, itemCount: number) => {
    if (saving.current) throw new Error("保存中です。完了してから再試行してください。");
    saving.current = true;
    if (mounted.current) setSaving(true);
    try {
      const next = await demoDocumentStore.save({ id: saved.current.id, expectedRevision: saved.current.revision, title, document, itemCount });
      saved.current = next;
      if (mounted.current) setRecord(next);
    } finally {
      saving.current = false;
      if (mounted.current) setSaving(false);
    }
  }, []);
  return { record, persist, isSaving };
}
