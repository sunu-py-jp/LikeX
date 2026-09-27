import type { AIChatContentPart, AIChatJSONValue, AIChatMessageStatus } from "@likex/aichat";

type RecordValue = { [key: string]: AIChatJSONValue };
const object = (value: AIChatJSONValue): RecordValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
const labels: Record<string, string> = { running: "実行中", complete: "完了", error: "エラー", cancelled: "中断", unchanged: "変更なし" };

function statusLabel(value: AIChatJSONValue | undefined, messageStatus: AIChatMessageStatus) {
  const status = value === "running" && messageStatus !== "streaming" ? messageStatus === "complete" ? "cancelled" : messageStatus : typeof value === "string" ? value : "";
  return Object.hasOwn(labels, status) ? labels[status] : "状態不明";
}

/** The host defines these part types and views; LikeAIChat only stores and dispatches them. */
export function ToolExecutionPart({ part, messageStatus }: { part: AIChatContentPart; messageStatus: AIChatMessageStatus }) {
  const call = object(part.data);
  if (!call || typeof call.name !== "string") return <p>ツール実行の記録を表示できません。</p>;
  const input = call.input === undefined ? null : object(call.input);
  const operation = input && typeof input.operation === "string" ? input.operation : "";
  return <details className="playground-ai-tool" data-tool-status={typeof call.status === "string" ? call.status : undefined}>
    <summary><span>{call.name}{operation ? ` · ${operation}` : ""}</span><small>{statusLabel(call.status, messageStatus)}</small></summary>
    <div className="playground-ai-tool-body">
      {typeof call.startedAt === "string" && <p className="playground-ai-tool-time">{call.startedAt}{typeof call.finishedAt === "string" ? ` → ${call.finishedAt}` : ""}</p>}
      <strong>入力・編集コマンド</strong><pre>{JSON.stringify(call.input ?? null, null, 2)}</pre>
      {call.inputTruncated !== undefined && <p>入力が表示上限を超えたため、一部を省略しています。実行可能な編集コマンドの全文はJSONLで確認できます。</p>}
      {call.output !== undefined && <><strong>実行結果</strong><pre>{JSON.stringify(call.output, null, 2)}</pre></>}
      {call.outputTruncated !== undefined && <p>結果が表示上限を超えたため、一部を省略しています。JSONLには別の上限で記録しています。</p>}
      {typeof call.error === "string" && <p className="playground-ai-tool-error">{call.error}</p>}
    </div>
  </details>;
}

export function AIRunPart({ part, messageStatus }: { part: AIChatContentPart; messageStatus: AIChatMessageStatus }) {
  const run = object(part.data);
  if (!run || typeof run.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(run.id)) return <p>実行ログのIDが不正です。</p>;
  return <div className="playground-ai-run">
    <div><strong>実行ログ</strong><span>{statusLabel(run.status, messageStatus)}</span></div>
    <a href={`/api/ai/runs/${run.id}`} download={`likex-ai-${run.id}.jsonl`}>JSONLをダウンロード</a>
    {typeof run.error === "string" && <p className="playground-ai-tool-error">{run.error}</p>}
  </div>;
}

export function createRunPart(id: string, status = "running", error?: string): AIChatContentPart {
  return { id: `run-${id}`, type: "likex.run", data: { id, status, ...(error ? { error } : {}) } };
}
