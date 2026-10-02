import { applySlideCommands, parseSlideDeck, prepareSlideConditionalEdit, serializeSlideDeck, type SlideHandle, type SlideCommand } from "@likex/slide";
import { assertLiveDocumentSize, awaitDocumentRead, GuardedDocumentBlob, LiveDocumentError, mutationToken, type DocumentAdapter } from "./ai-document";
import type { AIJSONValue } from "../../build/ai/protocol";

export function createSlideAIAdapter(getHandle: () => SlideHandle, getRevision: () => number): DocumentAdapter {
  return {
    module: "slide", label: "Slide",
    suggestions: ["今のページに『新サービス企画』の表紙を作って", "3つの要点をまとめたスライドを最後に追加して", "今のページの配色と文字を読みやすく整えて"],
    async snapshot(signal) {
      signal.throwIfAborted();
      const document = await (await awaitDocumentRead(getHandle().exportNative(), signal)).text();
      signal.throwIfAborted();
      return { document, documentTitle: parseSlideDeck(document).title, revision: getRevision(), selection: getHandle().getSelection() };
    },
    readCurrent: () => ({ document: serializeSlideDeck(getHandle().getDeck({ includeAnimations: true })), revision: getRevision() }),
    normalize: document => serializeSlideDeck(parseSlideDeck(document)),
    async live(request, signal) {
      signal.throwIfAborted();
      const handle = getHandle();
      const response = (changed?: boolean, receipts?: AIJSONValue) => {
        const snapshot = handle.getMutationSnapshot();
        return { targetId: request.targetId, document: serializeSlideDeck(snapshot.deck), token: JSON.stringify(snapshot.token),
          ...(changed === undefined ? {} : { changed, receipts }) };
      };
      if (request.action === "snapshot") {
        await awaitDocumentRead(handle.exportNative(), signal); signal.throwIfAborted();
        if (getHandle() !== handle) throw new LiveDocumentError("target_changed", "編集する資料が変わりました。");
        return response();
      }
      if (request.operation !== "apply") throw new LiveDocumentError("unsupported_operation", "全体の初期化には対応していません。対象を指定して編集してください。");
      let edit;
      try { edit = prepareSlideConditionalEdit(parseSlideDeck(request.expected.document), request.commands as unknown as SlideCommand[],
        { scope: request.expected.scope === "document" ? "deck" : "targets" }); }
      catch (cause) { throw new LiveDocumentError("write_failed", cause instanceof Error ? cause.message : "編集内容が正しくありません。"); }
      // Live AI uses full-document conditions, so the previewed source must still
      // match at commit. Generated UUIDs have the same serialized length.
      assertLiveDocumentSize(serializeSlideDeck(applySlideCommands(edit.before, edit.commands).deck));
      const result = await handle.executeConditional(edit, { expected: mutationToken(request.expected.token), signal });
      if (!result) throw new LiveDocumentError("editor_unavailable", "編集を反映できませんでした。入力中の内容や編集許可を確認してください。");
      if (!result.ok) throw new LiveDocumentError(result.code, "対象が変更されたため、編集を適用していません。最新の内容を確認してください。", result.conflicts);
      const { deck: _deck, ...receipt } = result; void _deck;
      return response(result.changed, JSON.parse(JSON.stringify(receipt)) as AIJSONValue);
    },
    async apply(document, signal, assertCurrent) {
      signal.throwIfAborted(); assertCurrent();
      await getHandle().importNative(new GuardedDocumentBlob(document, () => { signal.throwIfAborted(); assertCurrent(); }));
    },
  };
}
