"use client";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createModelEditorController, type ModelEditorAdapter } from "../core";
import { createDiagram, executeDiagramCommands, normalizeDiagram, serializeDiagram } from "../model/index";
import type { DiagramCommand, DiagramModel } from "../model/types";
import type { DiagramFeature, DiagramProps } from "../props";
const adapter: ModelEditorAdapter<DiagramModel, DiagramCommand, DiagramFeature> = {
  normalize: normalizeDiagram, serialize: serializeDiagram, execute: executeDiagramCommands,
  features: ["nodes", "edges", "move", "resize", "formatting", "import", "export", "history"],
  getCommandFeatures(command) {
    switch (command.type) {
      case "diagram.replace": return ["import"];
      case "nodes.move": case "nodes.align": return ["nodes", "move"];
      case "node.add": case "nodes.order": return ["nodes"];
      case "node.remove": return ["nodes", "edges"];
      case "node.update": return ["nodes", ...("x" in command.patch || "y" in command.patch ? ["move" as const] : []), ...("width" in command.patch || "height" in command.patch ? ["resize" as const] : []), ...(["fill", "stroke", "textColor", "shape"].some(key => key in command.patch) ? ["formatting" as const] : [])];
      case "edge.add": case "edge.remove": case "edges.order": return ["edges"];
      case "edge.update": return ["edges", ...("color" in command.patch ? ["formatting" as const] : [])];
      case "diagram.update": return ["nodes"];
    }
  },
};
export function useDiagram(props: DiagramProps) {
  const [controller] = useState(() => createModelEditorController(adapter, props.initialDiagram ?? createDiagram(), props));
  useLayoutEffect(() => controller.configure(props));
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  return { ...useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), controller };
}
