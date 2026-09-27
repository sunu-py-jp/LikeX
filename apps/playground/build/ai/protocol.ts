export type AIJSONValue = null | boolean | number | string | AIJSONValue[] | { [key: string]: AIJSONValue };
export type AITruncation = { originalBytes: number; storedBytes: number };
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
