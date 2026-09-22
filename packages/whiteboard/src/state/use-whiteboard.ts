"use client";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createModelEditorController, type ModelEditorAdapter } from "../core";
import { createWhiteboard, executeWhiteboardCommands, normalizeWhiteboard, serializeWhiteboard } from "../model/index";
import type { WhiteboardCommand, WhiteboardModel } from "../model/types";
import type { WhiteboardFeature, WhiteboardProps } from "../props";
const adapter: ModelEditorAdapter<WhiteboardModel, WhiteboardCommand, WhiteboardFeature> = {
  normalize: normalizeWhiteboard, serialize: serializeWhiteboard, execute: executeWhiteboardCommands,
  features: ["elements", "images", "move", "resize", "formatting", "import", "export", "history"],
  getCommandFeatures(command) {
    switch (command.type) {
      case "whiteboard.replace": return ["import"];
      case "elements.move": case "elements.align": return ["elements", "move"];
      case "element.add": return ["elements", ...(command.element.kind === "image" ? ["images" as const] : [])];
      case "element.remove": case "elements.order": case "whiteboard.update": return ["elements"];
      case "element.update": return ["elements", ...("x" in command.patch || "y" in command.patch ? ["move" as const] : []), ...("width" in command.patch || "height" in command.patch ? ["resize" as const] : []), ...("src" in command.patch ? ["images" as const] : []), ...(["fill", "stroke", "textColor", "fontSize"].some(key => key in command.patch) ? ["formatting" as const] : [])];
    }
  },
};
export function useWhiteboard(props: WhiteboardProps) {
  const [controller] = useState(() => createModelEditorController(adapter, props.initialWhiteboard ?? createWhiteboard(), props));
  useLayoutEffect(() => controller.configure(props));
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  return { ...useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), controller };
}
