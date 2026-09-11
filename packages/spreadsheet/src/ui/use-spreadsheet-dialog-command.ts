"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetCommand, SpreadsheetCommandSuccess } from "../api/types";
import type { SpreadsheetController } from "../state/use-spreadsheet";

/** Keeps a form's captured target valid while an editing-permission request is pending. */
export function useSpreadsheetDialogCommand(controller: SpreadsheetController, revision: number) {
  const mounted = useRef(false), running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const run = async (command: SpreadsheetCommand, onSuccess: (result: SpreadsheetCommandSuccess) => void) => {
    if (running.current || controller.disabled || controller.requesting) return;
    if (controller.getRevision() !== revision) {
      setError("ブックの状態が変わりました。ダイアログを閉じて指定し直してください。");
      return;
    }
    running.current = true; setPending(true); setError(null);
    try {
      const result = await controller.executeCommands([command], {
        isCurrent: () => mounted.current && controller.getRevision() === revision,
      });
      if (mounted.current) {
        if (result.ok) onSuccess(result);
        else setError(result.message);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "操作を完了できませんでした");
    } finally {
      running.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return { run, error, setError, pending, disabled: controller.disabled || controller.requesting || pending };
}
