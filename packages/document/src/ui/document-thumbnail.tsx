"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { FileText } from "lucide-react";
import { normalizeDocument } from "../model/document";
import type { DocumentThumbnailProps } from "../props";
import { useDocumentTheme } from "../state/use-document-theme";
import { documentThumbnailContent, renderDocumentThumbnail } from "./document-thumbnail-content";

const asError = (cause: unknown) => cause instanceof Error ? cause : new Error("文書のプレビューを表示できませんでした。");
export function LikeDocumentThumbnail(props: DocumentThumbnailProps) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null), body = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [renderError, setRenderError] = useState<{ result: object; error: Error } | null>(null);
  const callback = useRef(props.onError);
  useEffect(() => { callback.current = props.onError; }, [props.onError]);
  const result = useMemo(() => {
    try { const document = normalizeDocument(props.document); return { document, content: documentThumbnailContent(document) }; }
    catch (cause) { return { error: asError(cause) }; }
  }, [props.document]);
  const error = result.error ?? (renderError?.result === result ? renderError.error : undefined);
  useEffect(() => { if (error) { try { void Promise.resolve(callback.current?.(error)).catch(() => {}); } catch { /* An observer cannot break a preview. */ } } }, [error]);
  const theme = useDocumentTheme(props.colorMode ?? "light", root?.ownerDocument ?? null, props.primaryColor);
  const instanceId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const attach = useCallback((node: HTMLDivElement | null) => setRoot(node), []);
  useEffect(() => {
    const node = viewport.current, win = root?.ownerDocument.defaultView;
    if (!node || !win) return;
    const update = () => { const bounds = node.getBoundingClientRect(); setSize(previous => previous.width === bounds.width && previous.height === bounds.height ? previous : { width: bounds.width, height: bounds.height }); };
    update();
    const Observer = win.ResizeObserver;
    if (Observer) { const observer = new Observer(update); observer.observe(node); return () => observer.disconnect(); }
    win.addEventListener("resize", update); return () => win.removeEventListener("resize", update);
  }, [root]);
  const page = result.document?.page;
  const width = (page?.width ?? 210) * 96 / 25.4, height = (page?.height ?? 297) * 96 / 25.4;
  const scale = Math.max(0, Math.min(1, (size.width - 24) / width, (size.height - 24) / height));
  useEffect(() => {
    const node = body.current;
    if (!node || !result.content || !page || scale === 0) return;
    let active = true;
    try { renderDocumentThumbnail(node, result.content, page.margins.bottom * 96 / 25.4, instanceId); }
    catch (cause) { node.replaceChildren(); queueMicrotask(() => { if (active) setRenderError({ result, error: asError(cause) }); }); }
    return () => { active = false; node.replaceChildren(); };
  }, [result, page, props.document, scale, instanceId]);
  const title = props.title ?? result.document?.title ?? "文書";
  return <div ref={attach} data-likex-document="" data-likex-document-thumbnail="" className={`lxd-root lxd-thumbnail ${props.className ?? ""}`} style={{ ...theme, ...props.style }} role="region" aria-label={props["aria-label"] ?? `${title}のサムネイル`}>
    <header className="lxd-titlebar"><FileText className="lxd-document-mark" size={23} /><span className="lxd-document-title">{title}</span><div className="lxd-titlebar-end"><span>LikeX</span></div></header>
    <div ref={viewport} className="lxd-thumbnail-viewport">
      {error ? <div className="lxd-thumbnail-placeholder" role="status">文書のプレビューを表示できません。</div> : <div className="lxd-thumbnail-fit" style={{ width: width * scale, height: height * scale }} inert aria-hidden="true">
        <div className="lxd-surface lxd-thumbnail-page" style={{ width, height, transform: `scale(${scale})`, "--lxd-page-height": `${height}px`, "--lxd-margin-top": `${page?.margins.top ?? 20}mm`, "--lxd-margin-right": `${page?.margins.right ?? 20}mm`, "--lxd-margin-bottom": `${page?.margins.bottom ?? 20}mm`, "--lxd-margin-left": `${page?.margins.left ?? 20}mm` } as CSSProperties}>
          <div ref={body} className="lxd-editor lxd-thumbnail-body" />
        </div>
      </div>}
    </div>
  </div>;
}
