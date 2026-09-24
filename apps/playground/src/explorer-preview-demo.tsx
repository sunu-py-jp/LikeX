import { useCallback, useEffect, useRef, useState } from "react";
import Explorer, { type ExplorerEntry, type ExplorerPreviewHandler, type ExplorerProps } from "@likex/explorer";
import "../../../packages/explorer/src/styles.css";

type Workspace = { entries: ExplorerEntry[]; originals: Map<string, Blob>; pdf: Blob; textUrl: string };
const presentationId = "preview-presentation";
const textId = "preview-text";

async function createWorkspace(signal: AbortSignal): Promise<Workspace> {
  const [{ PDFDocument, StandardFonts, rgb }, { exportSlidePptx }] = await Promise.all([
    import("pdf-lib"), import("@likex/slide"),
  ]);
  signal.throwIfAborted();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([640, 360]);
  page.drawRectangle({ x: 0, y: 0, width: 640, height: 360, color: rgb(0.94, 0.97, 1) });
  page.drawText("LikeX preview", { x: 42, y: 260, size: 36, font, color: rgb(0.16, 0.28, 0.48) });
  page.drawText("A local PDF stands in for a server conversion.", { x: 42, y: 200, size: 18, font });
  page.drawText("Download keeps the original PowerPoint file.", { x: 42, y: 166, size: 18, font });
  const pdfBlob = new Blob([Uint8Array.from(await pdf.save())], { type: "application/pdf" });
  const pptx = await exportSlidePptx({ version: 1, id: "preview-deck", title: "LikeX preview", width: 640, height: 360,
    slides: [{ id: "preview-slide", name: "Preview", background: "#f0f7ff", notes: "Local preview sample.", elements: [{
      id: "preview-title", type: "text", name: "Title", text: "LikeX preview", x: 42, y: 70, width: 540, height: 90,
      rotation: 0, opacity: 1, locked: false, fontSize: 36, fontFamily: "Arial", color: "#29477a", bold: true,
      italic: false, align: "left", verticalAlign: "middle", fill: "transparent",
    }] }],
  });
  signal.throwIfAborted();

  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("サンプル画像を作成できませんでした");
  context.fillStyle = "#e5efff"; context.fillRect(0, 0, 640, 360);
  context.fillStyle = "#426ac1"; context.fillRect(40, 40, 100, 100);
  context.fillStyle = "#273e62"; context.font = "32px sans-serif";
  context.fillText("LikeX image preview", 40, 220);
  const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob); else reject(new Error("サンプル画像を作成できませんでした"));
  }, "image/png"));
  signal.throwIfAborted();
  const originals = new Map<string, Blob>([
    [presentationId, pptx],
    [textId, new Blob(["LikeX プレビューの例\n\nこのテキストは元ファイルです。\nチェックを入れると別タブで開きます。\n"], { type: "text/plain;charset=utf-8" })],
    ["preview-csv", new Blob(["項目,値\n元ファイル,PPTX\n表示用データ,PDF\n保存先,このタブのメモリ\n"], { type: "text/csv;charset=utf-8" })],
    ["preview-image", image],
  ]);
  const names: Record<string, string> = {
    [presentationId]: "プレゼンテーション.pptx", [textId]: "ガイド.txt", "preview-csv": "一覧.csv", "preview-image": "サンプル.png",
  };
  const date = "2026-09-01T00:00:00.000Z";
  const entries = [...originals].map(([id, blob]): ExplorerEntry => ({
    id, parent: "root", name: names[id], kind: "file", size: blob.size, mime: blob.type,
    createdAt: date, updatedAt: date, favorite: 0, source: { kind: "existing", id },
  }));
  return { entries, originals, pdf: pdfBlob, textUrl: URL.createObjectURL(originals.get(textId)!) };
}

function PreviewWorkspace({ workspace }: { workspace: Workspace }) {
  const [conversion, setConversion] = useState({ phase: "converting" as "converting" | "ready" | "cancelled", version: 1 });
  const [newTab, setNewTab] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const [notice, setNotice] = useState("");
  const conversionController = useRef<AbortController | null>(null);
  const textUrl = workspace.textUrl;

  useEffect(() => {
    if (conversion.phase !== "converting") return;
    const controller = new AbortController();
    conversionController.current = controller;
    const timer = window.setTimeout(() => {
      if (!controller.signal.aborted) setConversion(current => ({ ...current, phase: "ready" }));
    }, 6000);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [conversion.phase, conversion.version]);

  const readFile = useCallback(async (sourceId: string) => {
    const blob = workspace.originals.get(sourceId);
    if (!blob) throw new Error("元ファイルが見つかりません");
    return blob;
  }, [workspace]);

  const resolvePreviewSource = useCallback<NonNullable<ExplorerProps["resolvePreviewSource"]>>((entry) => {
    if (entry.id !== presentationId) return undefined;
    if (conversion.phase !== "ready") return {
      kind: "pending", message: conversion.phase === "cancelled" ? "模擬変換を中止しました。再実行できます。" : "表示用PDFを作成しています…",
    };
    return { kind: "blob", cacheKey: `${entry.id}:original-v1:pdf-${conversion.version}`, mime: "application/pdf", mode: "pdf",
      read: async ({ signal }) => { signal.throwIfAborted(); return workspace.pdf; } };
  }, [conversion, workspace]);

  const onPreviewRequest = useCallback<ExplorerPreviewHandler>(entry => {
    if (!newTab || entry.id !== textId || !textUrl) return "default";
    // Deliberately synchronous: awaiting a read here can lose user activation.
    window.open(textUrl, "_blank", "noopener,noreferrer");
    setNotice("別タブの表示を要求しました。開かない場合は「ガイドを別タブで開く」リンクを使えます。");
    return "handled";
  }, [newTab, textUrl]);
  const processing = conversion.phase === "converting";

  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100dvh", fontFamily: "system-ui, sans-serif", color: "#24364b", background: "#f7f9fc" }}>
      <header style={{ padding: "16px 24px", borderBottom: "1px solid #d9e1ec" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>Explorer プレビュー連携</h1>
        <p style={{ margin: "4px 0 12px", fontSize: 14 }}>
          ファイル名をクリックして表示します。PPTXのPDF変換は6秒の模擬処理です。ダウンロードは元ファイルを取得します。
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 18px", fontSize: 14 }}>
          <button type="button" onClick={() => {
            conversionController.current?.abort();
            setConversion(current => ({ phase: "converting", version: current.version + 1 }));
          }}>変換を再実行</button>
          <button type="button" disabled={!processing} onClick={() => {
            conversionController.current?.abort();
            setConversion(current => ({ ...current, phase: "cancelled" }));
          }}>変換を中止</button>
          <label><input type="checkbox" checked={showInfo} onChange={event => setShowInfo(event.target.checked)} /> プレビューに原本情報を追加</label>
          <label><input type="checkbox" checked={newTab} onChange={event => setNewTab(event.target.checked)} /> テキストを別タブで開く</label>
          {textUrl && <a href={textUrl} target="_blank" rel="noopener noreferrer">ガイドを別タブで開く</a>}
        </div>
        <p role="status" style={{ margin: "10px 0 0", fontSize: 13 }}>
          {processing ? "変換中 — PPTXを開くと待機表示を確認できます。" : conversion.phase === "ready" ? "PDFの準備ができました。" : "変換を中止しました。"}
          {notice && ` ${notice}`}
        </p>
      </header>
      <div style={{ minHeight: 0, flex: 1, padding: 16 }}>
        <Explorer
          initialEntries={workspace.entries}
          readFile={readFile}
          previewTrigger="click"
          onPreviewRequest={onPreviewRequest}
          resolvePreviewSource={resolvePreviewSource}
          processingEntryIds={processing ? [presentationId] : []}
          getProcessingLabel={() => "PDFへの模擬変換中"}
          renderPreview={({ entry, defaultPreview }) => showInfo ? (
            <section aria-label="原本情報付きプレビュー">
              <p style={{ margin: "0 0 12px", fontSize: 12, overflowWrap: "anywhere" }}>
                原本: {entry.name} / {entry.size.toLocaleString()} bytes / {entry.mime}
              </p>
              {defaultPreview}
            </section>
          ) : null}
          // These PDF bytes are authored locally by this sample. Generic integrations keep the default sandbox.
          preview={{ pdfSandbox: false }}
          features={{ favorites: false, recent: false, tabs: false }}
          selection={{ checkboxes: false }}
          ui={{ sidebar: false }}
          style={{ height: "100%" }}
        />
      </div>
    </main>
  );
}

export default function ExplorerPreviewDemo() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let created: Workspace | undefined;
    void createWorkspace(controller.signal).then(result => {
      if (controller.signal.aborted) URL.revokeObjectURL(result.textUrl);
      else { created = result; setWorkspace(result); }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "サンプルを作成できませんでした");
    });
    return () => {
      controller.abort();
      // Keep the URL alive for this workspace, including after window.open.
      if (created) URL.revokeObjectURL(created.textUrl);
    };
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!workspace) return <p role="status">ローカルのサンプルファイルを作成しています…</p>;
  return <PreviewWorkspace workspace={workspace} />;
}
