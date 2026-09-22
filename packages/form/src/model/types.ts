export type FormValue = string | number | boolean | null;
export type FormAnswers = Record<string, FormValue>;
export type FormFieldType = "text" | "textarea" | "number" | "date" | "select" | "radio" | "checkbox";
export type FormCondition = { fieldId: string; operator: "equals" | "notEquals" | "contains" | "notEmpty"; value?: FormValue };
export type FormOption = { value: string; label: string };
export type FormField = {
  id: string; type: FormFieldType; label: string; description: string; placeholder: string;
  required: boolean; options: FormOption[]; defaultValue: FormValue;
  min?: number; max?: number; minLength?: number; maxLength?: number; visibleWhen?: FormCondition;
};
export type FormFieldInput = Pick<FormField, "type" | "label"> & Partial<Omit<FormField, "type" | "label">>;
export type FormModel = { format: "likex.form"; version: 1; id: string; title: string; description: string; submitLabel: string; fields: FormField[] };
export type FormCommand =
  | { type: "form.update"; patch: Partial<Pick<FormModel, "title" | "description" | "submitLabel">> }
  | { type: "form.replace"; form: FormModel }
  | { type: "field.add"; field: FormFieldInput; index?: number }
  | { type: "field.update"; fieldId: string; patch: Partial<Omit<FormField, "id">> }
  | { type: "field.delete"; fieldIds: string[] }
  | { type: "field.move"; fieldId: string; index: number };
export type FormValidationIssue = { fieldId: string; message: string };
export type FormValidationResult = { valid: boolean; errors: FormValidationIssue[]; values: FormAnswers };
