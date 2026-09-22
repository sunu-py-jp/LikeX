import { createModelEditorController, type ModelEditorAdapter, type ModelEditorOptions } from "../core";
import { createDataView, normalizeDataView, serializeDataView, executeDataViewCommands, type DataViewModel, type DataViewCommand } from "../model";
import type { DataViewFeature } from "../model/types";
export const dataViewEditorAdapter: ModelEditorAdapter<DataViewModel, DataViewCommand, DataViewFeature> = {
  normalize: normalizeDataView, serialize: serializeDataView, execute: (data, commands) => executeDataViewCommands(data, commands).data,
  features: ["rename", "fields", "rows", "editCells", "sort", "filter", "group", "columnVisibility", "import", "export", "history"],
  getCommandFeatures(command) {
    if (command.type === "data.replace") return ["import"];
    if (command.type === "data.rename") return ["rename"];
    if (command.type.startsWith("field.")) return command.type === "field.delete" || command.type === "field.update" && (command.patch.type !== undefined || command.patch.options !== undefined) ? ["fields", "editCells"] : ["fields"];
    if (command.type === "cell.set") return ["editCells"];
    if (command.type === "row.update") return ["editCells"];
    return ["rows"];
  },
};
export function createDataViewController(data: DataViewModel = createDataView(), options: ModelEditorOptions<DataViewModel, DataViewFeature> = {}) { return createModelEditorController(dataViewEditorAdapter, data, options); }
