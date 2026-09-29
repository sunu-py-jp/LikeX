export type AIJSONValue = null | boolean | number | string | AIJSONValue[] | { [key: string]: AIJSONValue };
export type AITruncation = { originalBytes: number; storedBytes: number };
/** A host-rendered staged page; it never replaces the editor's live document. */
export type AIPreviewRequest = { document: string; slideId: string };
export type AIPreviewResult = { imageUrl: string; width: number; height: number; slideId: string; diagnostics: AIJSONValue[] };
export type AIPreviewEvent = AIPreviewRequest & { type: "preview"; id: string; token: string };
export type AIToolCall = {
  id: string;
  name: string;
  status: "running" | "complete" | "error";
  input: AIJSONValue;
  output?: AIJSONValue;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  inputTruncated?: AITruncation;
  outputTruncated?: AITruncation;
};
export const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
