"use client";

import { useLayoutEffect, useRef } from "react";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import type { SpreadsheetCommand } from "../api/types";

/** A delayed editing lease must not apply a print setting after its sheet or workbook was replaced. */
export function usePrintCommand(c: SpreadsheetController) {
  const current = useRef(c), mounted = useRef(true);
  useLayoutEffect(() => { current.current = c; });
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return (command: SpreadsheetCommand, onSuccess?: () => void) => {
    const sheetId = c.activeSheet.id;
    c.afterCommit(() => {
      if (!mounted.current || current.current.activeSheet.id !== sheetId) return;
      const workbook = current.current.getWorkbook();
      const isCurrent = () => mounted.current && current.current.activeSheet.id === sheetId && current.current.getWorkbook() === workbook;
      const result = current.current.executeCommands([command], { isCurrent });
      const finish = (value: Awaited<typeof result>) => { if (value.ok && mounted.current && current.current.activeSheet.id === sheetId) onSuccess?.(); };
      if (result instanceof Promise) void result.then(finish, current.current.reportError);
      else finish(result);
    });
  };
}
