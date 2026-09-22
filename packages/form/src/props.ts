import type { CSSProperties, Ref } from "react";
import type { MaybePromise, ModelEditorOptions, OperationContext } from "./core";
import type { FormAnswers, FormCommand, FormModel, FormValidationResult } from "./model/types";
export type FormFeature = "fields" | "reorder" | "settings" | "import" | "export" | "history" | "preview" | "submit";
export type FormFeatures = Partial<Record<FormFeature, boolean>>;
export type FormHandle = {
  getForm(): FormModel;
  execute(commands: FormCommand | readonly FormCommand[]): Promise<FormModel | null>;
  replace(form: FormModel): Promise<FormModel | null>;
  save(): Promise<boolean>; undo(): Promise<boolean>; redo(): Promise<boolean>;
  getAnswers(): FormAnswers; setAnswers(answers: FormAnswers): boolean;
  validate(): FormValidationResult; submit(): Promise<boolean>; cancelPending(): void;
};
export type FormProps = ModelEditorOptions<FormModel, FormFeature> & {
  initialForm: FormModel;
  /** design edits the definition; fill collects answers without changing the definition. */
  mode?: "design" | "fill";
  initialAnswers?: FormAnswers;
  onAnswersChange?: (answers: FormAnswers) => void;
  onSubmit?: (answers: FormAnswers, context: OperationContext & { form: FormModel }) => MaybePromise<void>;
  onSubmitComplete?: (answers: FormAnswers) => void;
  title?: string; primaryColor?: string; colorMode?: "light" | "dark" | "system";
  /** @deprecated Use colorMode. */
  theme?: "light" | "dark"; className?: string; style?: CSSProperties;
  ref?: Ref<FormHandle>;
};
