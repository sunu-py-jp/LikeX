export type DataViewFieldType = "text" | "number" | "date" | "boolean" | "select";
export type DataViewValue = string | number | boolean | null;
export type DataViewField = { id: string; name: string; type: DataViewFieldType; options: string[] };
export type DataViewRow = { id: string; values: Record<string, DataViewValue> };
export type DataViewModel = { format: "likex.dataview"; version: 1; id: string; title: string; fields: DataViewField[]; rows: DataViewRow[] };
export type DataViewFieldInput = Partial<DataViewField> & Pick<DataViewField, "name" | "type">;
export type DataViewRowInput = { id?: string; values?: Record<string, DataViewValue> };
export type DataViewInput = Partial<Pick<DataViewModel, "id" | "title">> & { fields?: DataViewFieldInput[]; rows?: DataViewRowInput[] };
export type DataViewCommand =
  | { type: "data.rename"; title: string }
  | { type: "data.replace"; data: DataViewModel }
  | { type: "field.add"; field: DataViewFieldInput; index?: number }
  | { type: "field.update"; fieldId: string; patch: Partial<Omit<DataViewField, "id">> }
  | { type: "field.delete"; fieldId: string }
  | { type: "field.move"; fieldId: string; index: number }
  | { type: "row.add"; row?: DataViewRowInput; index?: number }
  | { type: "rows.append"; rows: DataViewRowInput[] }
  | { type: "row.update"; rowId: string; values: Record<string, DataViewValue> }
  | { type: "row.delete"; rowId: string }
  | { type: "row.move"; rowId: string; index: number }
  | { type: "cell.set"; rowId: string; fieldId: string; value: DataViewValue };
export type DataViewCommandResult = { data: DataViewModel; changed: boolean; createdIds: string[] };
export type DataViewFilter = { fieldId: string; operator: "contains" | "equals" | "notEquals" | "isEmpty" | "greaterThan" | "lessThan"; value?: DataViewValue };
export type DataViewQuery = { search?: string; filters?: DataViewFilter[]; sort?: { fieldId: string; direction: "asc" | "desc" }[]; groupBy?: string | null; hiddenFieldIds?: string[] };
export type DataViewGroup = { key: string; label: string; rows: DataViewRow[] };

export type DataViewFeature = "rename" | "fields" | "rows" | "editCells" | "sort" | "filter" | "group" | "columnVisibility" | "import" | "export" | "history";
