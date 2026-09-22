"use client";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createPrimaryColorPalette } from "../core";
import type { BoardProps } from "../props";
import { createBoardController } from "./controller";
export function useEditor(props: BoardProps) {
  const [controller] = useState(() => createBoardController(props.initialBoard, props));
  useLayoutEffect(() => { controller.configure(props); });
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => { const media = window.matchMedia("(prefers-color-scheme: dark)"); const update = () => setSystemDark(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  const dark = props.colorMode === "dark" || props.colorMode === "system" && systemDark;
  const palette = createPrimaryColorPalette(props.primaryColor ?? "#2563eb", dark ? "dark" : "light") ?? createPrimaryColorPalette("#2563eb", dark ? "dark" : "light")!;
  useEffect(() => { if (!snapshot.dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [snapshot.dirty]);
  return { ...snapshot, controller, dark, palette };
}
