export type AIJSONValue = null | boolean | number | string | AIJSONValue[] | { [key: string]: AIJSONValue };
export type AITruncation = { originalBytes: number; storedBytes: number };
/** A host-rendered staged page; it never replaces the editor's live document. */
export type AIPreviewRequest = { document: string; slideId: string };
export type AIPreviewResult = { imageUrl: string; width: number; height: number; slideId: string; diagnostics: AIJSONValue[] };
export type AIPreviewEvent = AIPreviewRequest & { type: "preview"; id: string; token: string };
/** Host-owned document identity is fixed for the lifetime of one run. */
export type AILiveDocumentRequest = { targetId: string } & ({ action: "snapshot" } | {
  action: "commit"; expected: { document: string; token: string; scope: "document" | "targets" }; operation: "apply" | "create"; commands: AIJSONValue[];
});
export type AILiveDocumentResult = { targetId: string; document: string; token: string; changed?: boolean; receipts?: AIJSONValue };
export type AILiveDocumentError = { code: string; message: string; conflicts?: AIJSONValue[] };
export type AILiveDocumentEvent = AILiveDocumentRequest & { type: "document"; id: string; token: string; expiresAt: number };
export type AILiveDocumentExchange = (request: AILiveDocumentRequest, signal: AbortSignal) => Promise<AILiveDocumentResult>;
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
