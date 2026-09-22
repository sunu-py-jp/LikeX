import type { CSSProperties, Ref } from "react";
import type { ModelEditorOptions } from "./core";
import type { DataViewCommand, DataViewModel, DataViewQuery, DataViewRow } from "./model";
export type { DataViewFeature } from "./model/types";
import type { DataViewFeature } from "./model/types";
export type DataViewHandle = { getData(): DataViewModel; execute(command: DataViewCommand | readonly DataViewCommand[]): Promise<DataViewModel | null>; undo(): Promise<boolean>; redo(): Promise<boolean>; save(): Promise<boolean>; discard(): void; importNative(input: string | Blob): Promise<DataViewModel | null>; importCsv(input: string | Blob): Promise<DataViewModel | null>; exportNative(): Blob; exportCsv(): Blob; getQuery(): DataViewQuery; setQuery(query: DataViewQuery): void };
export type DataViewProps = ModelEditorOptions<DataViewModel, DataViewFeature> & { ref?: Ref<DataViewHandle>; initialData?: DataViewModel; initialQuery?: DataViewQuery; title?: string; primaryColor?: string; colorMode?: "light" | "dark" | "system"; onRowOpen?: (context: { row: DataViewRow; data: DataViewModel }) => void; onQueryChange?: (query: DataViewQuery) => void; className?: string; style?: CSSProperties; "aria-label"?: string };
