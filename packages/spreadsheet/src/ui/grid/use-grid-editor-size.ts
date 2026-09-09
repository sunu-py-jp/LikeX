"use client";
import { useLayoutEffect, type RefObject } from "react";
/** Native textarea measurement matches browser font shaping and line wrapping. */
export function useGridEditorSize(ref: RefObject<HTMLTextAreaElement | null>, revision: unknown, cellHeight: number, editing: boolean) {
  useLayoutEffect(() => {
    const input = ref.current; if (!input) return;
    if (editing) { input.style.height = "100%"; return; }
    input.style.height = "0px";
    input.style.height = `${Math.max(1, Math.min(cellHeight - 2, input.scrollHeight || 18))}px`;
  }, [ref, revision, cellHeight, editing]);
}
