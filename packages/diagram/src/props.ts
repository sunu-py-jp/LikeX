import type { CSSProperties, Ref } from "react";
import type { ModelEditorOptions } from "./core";
import type { DiagramCommand, DiagramModel } from "./model/types";
export type DiagramFeature = "nodes" | "edges" | "move" | "resize" | "formatting" | "import" | "export" | "history";
export type DiagramFeatures = Partial<Record<DiagramFeature, boolean>>;
export type DiagramHandle = { getModel(): DiagramModel; execute(commands: DiagramCommand | readonly DiagramCommand[]): Promise<DiagramModel | null>; select(ids: readonly string[]): void; getSelection(): readonly string[]; undo(): Promise<boolean>; redo(): Promise<boolean>; save(): Promise<boolean>; discard(): void; importJson(input: string | Blob): Promise<DiagramModel | null>; exportJson(): string; exportSvg(): string };
export type DiagramProps = ModelEditorOptions<DiagramModel, DiagramFeature> & { ref?: Ref<DiagramHandle>; initialDiagram?: DiagramModel; title?: string; primaryColor?: string; colorMode?: "light" | "dark" | "system"; warnOnUnsavedChanges?: boolean; onSelectionChange?: (ids: readonly string[]) => void; className?: string; style?: CSSProperties; "aria-label"?: string };
