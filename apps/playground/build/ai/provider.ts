export type AIProvider = "openai" | "azure";
export type AIReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
const reasoningEfforts: readonly string[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

export interface AIConfiguration {
  configured: boolean;
  provider: AIProvider;
  model: string;
  missing: string[];
  url: string;
  key: string;
  reasoningEffort?: AIReasoningEffort;
}

export class AIError extends Error {}

/** Only the server receives this object; publicConfiguration removes credentials and URLs. */
export function readConfiguration(env: Record<string, string | undefined>): AIConfiguration {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() === "azure" ? "azure" : "openai";
  const model = (provider === "azure" ? env.AZURE_OPENAI_DEPLOYMENT : env.OPENAI_MODEL)?.trim() || (provider === "openai" ? "gpt-4.1" : "");
  const key = (provider === "azure" ? env.AZURE_OPENAI_API_KEY : env.OPENAI_API_KEY)?.trim() || "";
  const missing: string[] = [];
  // Omit effort by default so each model uses its own Responses API default.
  const effort = env.AI_REASONING_EFFORT?.trim();
  if (effort && !reasoningEfforts.includes(effort)) missing.push("AI_REASONING_EFFORT (none / minimal / low / medium / high / xhigh / max / 空欄)");
  const reasoningEffort = effort && reasoningEfforts.includes(effort) ? effort as AIReasoningEffort : undefined;
  if (env.AI_PROVIDER && !["azure", "openai"].includes(env.AI_PROVIDER.trim().toLowerCase())) missing.push("AI_PROVIDER (openai / azure)");
  if (!key) missing.push(provider === "azure" ? "AZURE_OPENAI_API_KEY" : "OPENAI_API_KEY");
  let url = "https://api.openai.com/v1/responses";
  if (provider === "azure") {
    if (!model) missing.push("AZURE_OPENAI_DEPLOYMENT");
    try {
      const endpoint = new URL(env.AZURE_OPENAI_ENDPOINT?.trim() || "");
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash ||
          ![".openai.azure.com", ".services.ai.azure.com", ".cognitiveservices.azure.com"].some(suffix => endpoint.hostname.endsWith(suffix))) throw new Error();
      const version = env.AZURE_OPENAI_API_VERSION?.trim();
      url = version
        ? `${endpoint.origin}/openai/responses?api-version=${encodeURIComponent(version)}`
        : `${endpoint.origin}/openai/v1/responses`;
    } catch { missing.push("AZURE_OPENAI_ENDPOINT (Azure の HTTPS URL)"); }
  }
  return { configured: missing.length === 0, provider, model, missing, url, key, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

export function publicConfiguration(config: AIConfiguration) {
  return { configured: config.configured, provider: config.provider, model: config.model, ...(config.missing.length ? { missing: config.missing } : {}) };
}

/** Keep complete API items, including IDs, assistant phase and encrypted reasoning, for stateless replay. */
export type ResponseOutputItem =
  { type: "reasoning"; id: string; summary: { type: "summary_text"; text: string; [key: string]: unknown }[];
    encrypted_content?: string | null; status?: "completed" | null; [key: string]: unknown } |
  { type: "function_call"; id?: string; call_id: string; name: string; arguments: string;
    status?: "completed" | null; [key: string]: unknown } |
  { type: "message"; id?: string; role: "assistant"; status?: "completed" | null;
    phase?: "commentary" | "final_answer" | null;
    content: ({ type: "output_text"; text: string; [key: string]: unknown } | { type: "refusal"; refusal: string; [key: string]: unknown })[];
    [key: string]: unknown };
export type ResponseInputItem = ResponseOutputItem |
  { role: "user" | "assistant"; content: string; type?: "message"; phase?: "commentary" | "final_answer" | null } |
  { type: "function_call_output"; call_id: string; output: string };
export type ResponseToolCall = { id: string; name: string; arguments: string };
export type AIResponse = { output: ResponseOutputItem[]; calls: ResponseToolCall[]; text: string; refused?: true };

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && !/\s|\0/.test(value);

function parseResponse(body: unknown): AIResponse {
  if (!object(body) || body.status !== "completed" || body.error != null || body.incomplete_details != null ||
      !Array.isArray(body.output) || !body.output.length || body.output.length > 128)
    throw new AIError("AI の応答が完了しませんでした。依頼を分割して再試行してください。");
  const calls: ResponseToolCall[] = [], text: string[] = [];
  let refused = false;
  const itemIds = new Set<string>(), callIds = new Set<string>();
  for (const item of body.output) {
    if (!object(item) || typeof item.type !== "string" || (item.id !== undefined && !identifier(item.id)) ||
        (item.status != null && item.status !== "completed")) throw new AIError("AI サービスが不正な応答項目を返しました。");
    if (typeof item.id === "string") {
      if (itemIds.has(item.id)) throw new AIError("AI サービスが重複した応答項目を返しました。");
      itemIds.add(item.id);
    }
    if (item.type === "function_call") {
      if (!identifier(item.call_id) || callIds.has(item.call_id) || typeof item.name !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(item.name) || typeof item.arguments !== "string" || item.arguments.length > 512 * 1024 || calls.length >= 8)
        throw new AIError("AI が不正なツール呼び出しを返しました。");
      callIds.add(item.call_id);
      calls.push({ id: item.call_id, name: item.name, arguments: item.arguments });
    } else if (item.type === "message") {
      if (item.role !== "assistant" || !Array.isArray(item.content) ||
          (item.phase != null && item.phase !== "commentary" && item.phase !== "final_answer")) throw new AIError("AI サービスが不正なメッセージを返しました。");
      const parts = item.content.map((part: unknown) => {
        if (!object(part)) throw new AIError("AI サービスが不正なメッセージ本文を返しました。");
        if (part.type === "output_text" && typeof part.text === "string") return part.text;
        if (part.type === "refusal" && typeof part.refusal === "string") { refused = true; return part.refusal; }
        throw new AIError("AI サービスが不正なメッセージ本文を返しました。");
      });
      if (parts.length) text.push(parts.join(""));
    } else if (item.type === "reasoning") {
      if (!identifier(item.id) || !Array.isArray(item.summary) ||
          (item.encrypted_content != null && typeof item.encrypted_content !== "string")) throw new AIError("AI サービスが不正な推論項目を返しました。");
    } else throw new AIError("AI サービスが未対応の応答項目を返しました。");
  }
  if (!calls.length && !text.some(value => value.trim())) throw new AIError("AI サービスの応答が空でした。");
  // Do not rebuild items: dropping reasoning or message phase breaks subsequent tool rounds.
  return { output: body.output as ResponseOutputItem[], calls, text: text.join("\n\n"), ...(refused ? { refused: true } : {}) };
}

export async function complete(config: AIConfiguration, input: ResponseInputItem[], tools: unknown[], signal: AbortSignal, fetcher: typeof fetch = fetch, instructions?: string): Promise<AIResponse> {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetcher(config.url, {
      method: "POST", signal, redirect: "error",
      headers: { "Content-Type": "application/json", ...(config.provider === "azure" ? { "api-key": config.key } : { Authorization: `Bearer ${config.key}` }) },
      body: JSON.stringify({ model: config.model, input, ...(instructions !== undefined ? { instructions } : {}), tools,
        tool_choice: "auto", parallel_tool_calls: false, store: false, include: ["reasoning.encrypted_content"],
        ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}) }),
    });
  } catch {
    signal.throwIfAborted();
    throw new AIError("AI サービスに接続できませんでした。サーバーの接続先とネットワークを確認してください。");
  }
  if (!response.ok) {
    await response.body?.cancel();
    const hint = response.status === 401 || response.status === 403 ? "API キーと利用権限を確認してください。"
      : response.status === 429 ? "利用上限に達しました。しばらく待って再試行してください。"
        : response.status === 404 ? "モデル名または Azure のデプロイ名を確認してください。" : "設定を確認して再試行してください。";
    throw new AIError(`AI サービスがエラーを返しました（HTTP ${response.status}）。${hint}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AIError("AI サービスの応答が空でした。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new AIError("AI の応答が大きすぎます。依頼を分割してください。");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  signal.throwIfAborted();
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AIError("AI サービスの応答を読み取れませんでした。"); }
  return parseResponse(body);
}
