import { parseSlideDeck, serializeSlideDeck, type SlideHandle } from "@likex/slide";
import { GuardedDocumentBlob, type DocumentAdapter } from "./ai-document";

export function createSlideAIAdapter(getHandle: () => SlideHandle, getRevision: () => number): DocumentAdapter {
  return {
    module: "slide", label: "Slide",
    suggestions: ["今のページに『新サービス企画』の表紙を作って", "3つの要点をまとめたスライドを最後に追加して", "今のページの配色と文字を読みやすく整えて"],
    async snapshot(signal) {
      signal.throwIfAborted();
      const document = await (await getHandle().exportNative()).text();
      signal.throwIfAborted();
      return { document, documentTitle: parseSlideDeck(document).title, revision: getRevision(), selection: getHandle().getSelection() };
    },
    readCurrent: () => ({ document: serializeSlideDeck(getHandle().getDeck({ includeAnimations: true })), revision: getRevision() }),
    normalize: document => serializeSlideDeck(parseSlideDeck(document)),
    async apply(document, signal, assertCurrent) {
      signal.throwIfAborted(); assertCurrent();
      await getHandle().importNative(new GuardedDocumentBlob(document, () => { signal.throwIfAborted(); assertCurrent(); }));
    },
  };
}
