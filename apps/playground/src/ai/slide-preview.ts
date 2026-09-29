import type { AIPreviewEvent, AIPreviewResult } from "../../build/ai/protocol";
import { parseSlideDeck, getSlideLayoutDiagnostics, getSlide } from "@likex/slide/model";
import { exportImage } from "@likex/slide/render";

/** Render the staged page in isolation; no selection, live editor state, history or storage is changed. */
export async function renderSlidePreview(request: AIPreviewEvent, signal: AbortSignal): Promise<AIPreviewResult> {
  signal.throwIfAborted();
  const deck = parseSlideDeck(request.document);
  if (deck.slides.length !== 1 || deck.slides[0].id !== request.slideId) throw new Error("プレビューには指定した1ページだけを渡してください。");
  const scale = Math.min(1, 1600 / deck.width, 1600 / deck.height);
  const image = await exportImage(deck, { slideId: request.slideId, scale, signal });
  signal.throwIfAborted();
  if (image.blob.size > 2 * 1024 * 1024) throw new Error("プレビュー画像が2 MiBを超えています。画像や要素を簡潔にしてください。");
  const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
  if (!context) throw new Error("文字の描画サイズを測定できません。");
  const slide = getSlide(deck, request.slideId);
  if (!slide) throw new Error("プレビュー対象のページが見つかりません。");
  const diagnostics = getSlideLayoutDiagnostics(slide, { width: deck.width, height: deck.height, measureText: (text, style) => {
    context.font = `${style.italic ? "italic" : "normal"} ${style.bold ? 700 : 400} ${style.fontSize}px ${style.fontFamily}`;
    return context.measureText(text).width;
  } });
  canvas.width = 0; canvas.height = 0;
  if (diagnostics.length > 200) throw new Error("レイアウトの警告が200件を超えています。ページを整理して再試行してください。");
  const buffer = new Uint8Array(await image.blob.arrayBuffer());
  signal.throwIfAborted();
  let binary = "";
  for (let offset = 0; offset < buffer.length; offset += 8192) binary += String.fromCharCode(...buffer.subarray(offset, offset + 8192));
  return { slideId: request.slideId, imageUrl: `data:image/png;base64,${btoa(binary)}`, width: image.width, height: image.height,
    diagnostics: diagnostics.map(diagnostic => ({ ...diagnostic })) };
}

export async function respondToSlidePreview(request: AIPreviewEvent, signal: AbortSignal,
  render: typeof renderSlidePreview = renderSlidePreview, fetcher: typeof fetch = fetch): Promise<void> {
  signal.throwIfAborted();
  let body: { token: string; result?: AIPreviewResult; error?: string };
  try { body = { token: request.token, result: await render(request, signal) }; }
  catch (error) {
    signal.throwIfAborted();
    body = { token: request.token, error: (error instanceof Error ? error.message : "ブラウザーでプレビューを生成できませんでした。").slice(0, 1000) };
  }
  signal.throwIfAborted();
  const response = await fetcher(`/api/ai/previews/${request.id}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!response.ok) throw new Error("スライドのプレビューをAIへ返せませんでした。処理を再試行してください。");
}
