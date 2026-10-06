import type { SlideDeck } from "../model/types";

/** View-only target for opening a slide file or displaying its thumbnail. */
export type SlidePageTarget = { pageNumber?: number; slideId?: string };

/** Resolve against the current deck order. Explicit invalid targets never silently fall back. */
export function resolveSlidePageTarget(deck: SlideDeck, target: SlidePageTarget = {}) {
  const { pageNumber, slideId } = target;
  if (pageNumber !== undefined && (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > deck.slides.length))
    throw new Error(`ページ番号は1〜${deck.slides.length}の整数で指定してください。`);
  const byId = slideId === undefined ? undefined : deck.slides.findIndex(slide => slide.id === slideId);
  if (byId === -1) throw new Error(`指定したスライドが見つかりません: ${slideId}`);
  if (byId !== undefined && pageNumber !== undefined && byId !== pageNumber - 1)
    throw new Error("ページ番号とスライドIDが別のページを指しています。");
  const index = byId ?? (pageNumber === undefined ? 0 : pageNumber - 1);
  const slide = deck.slides[index];
  if (!slide) throw new Error("表示するスライドがありません。");
  return { slideId: slide.id, pageNumber: index + 1 };
}
