"use client";

import { memo, useId, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { AlertDialog, Dialog } from "./explorer-overlays";
import {
  ArrowDownToLine,
  Check,
  Folder,
  FolderInput,
  FolderOpen,
  HardDrive,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useExplorerFields } from "../state/explorer-context";
import { FileIcon } from "./explorer-file-icon";
import { useExplorerTheme } from "./explorer-theme";
import { useExplorerDom } from "./explorer-dom-context";
import { buttonClass, iconButtonClass, inputClass } from "./explorer-controls";
import {
  subtreeEntries,
  formatSize,
  getEntryPath,
  selectionRoots,
  formatEntryDate,
} from "../model/entries";
import FilePreview from "./file-preview";
import { getEntryIndex } from "../model/entry-index";
import { isComposingKeyEvent, shortcutLabel } from "../model/keyboard";
import type { ExplorerUploadPrompt } from "../state/use-explorer-upload";

const overlayClass = "lxe:absolute lxe:inset-0 lxe:z-50 lxe:bg-black/30";
const surfaceClass =
  "lxe:z-50 lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-background)] lxe:text-sm lxe:leading-normal lxe:text-[var(--explorer-foreground)] lxe:shadow-[0_25px_90px_#0f274540] lxe:outline-none";
const modalClass = `lxe:absolute lxe:top-1/2 lxe:left-1/2 lxe:grid lxe:max-h-[calc(100%-2rem)] lxe:w-[calc(100%-2rem)] lxe:max-w-[512px] lxe:-translate-x-1/2 lxe:-translate-y-1/2 lxe:gap-5 lxe:overflow-y-auto lxe:rounded-[14px] lxe:p-7 ${surfaceClass}`;
const titleClass = "lxe:pr-6 lxe:text-lg lxe:leading-relaxed lxe:font-semibold";
const descriptionClass =
  "lxe:mt-1 lxe:text-sm lxe:leading-[1.8] lxe:text-[var(--explorer-muted)]";
const footerClass = "lxe:flex lxe:flex-wrap lxe:justify-end lxe:gap-2";
const errorClass =
  "lxe:mt-2.5 lxe:mb-3.5 lxe:min-h-5 lxe:text-xs lxe:leading-[1.7] lxe:text-[var(--explorer-danger)]";
const actionClass =
  "lxe:inline-flex lxe:min-h-9 lxe:items-center lxe:justify-center lxe:gap-2 lxe:rounded-md lxe:border lxe:border-transparent lxe:px-4 lxe:py-2 lxe:text-sm lxe:font-medium lxe:transition-colors lxe:outline-none lxe:focus-visible:ring-2 lxe:focus-visible:ring-[var(--explorer-accent)] lxe:focus-visible:ring-offset-2 lxe:focus-visible:ring-offset-[var(--explorer-background)] lxe:disabled:pointer-events-none lxe:disabled:opacity-45";
const primaryClass = `${actionClass} lxe:bg-[var(--explorer-accent)] lxe:text-[var(--explorer-accent-foreground)] lxe:hover:opacity-90`;
const dangerClass = `${actionClass} lxe:bg-[var(--explorer-danger)] lxe:text-[var(--explorer-danger-foreground)] lxe:hover:opacity-90`;

function DialogSurface({
  children,
  className = modalClass,
  closeDisabled = false,
  ...props
}: ComponentProps<typeof Dialog.Content> & { closeDisabled?: boolean }) {
  const theme = useExplorerTheme();
  const { dialogContainer, portalContainer } = useExplorerDom();
  return (
    <Dialog.Portal container={dialogContainer ?? portalContainer}>
      <Dialog.Overlay data-explorer-overlay="" style={theme} className={overlayClass} />
      <Dialog.Content {...props} style={theme} className={className}>
        {children}
        <Dialog.Close asChild>
          <button
            type="button"
            className={`${iconButtonClass} lxe:absolute lxe:top-3 lxe:right-3`}
            aria-label="閉じる"
            disabled={closeDisabled}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

function AlertSurface({ children, onCancel }: { children: ReactNode; onCancel?: () => void }) {
  const theme = useExplorerTheme();
  const { dialogContainer, portalContainer } = useExplorerDom();
  return (
    <AlertDialog.Portal container={dialogContainer ?? portalContainer}>
      <AlertDialog.Overlay data-explorer-overlay="" style={theme} className={overlayClass}
        onPointerDown={event => {
          if (!onCancel || event.button !== 0 || event.target !== event.currentTarget) return;
          event.preventDefault();
          onCancel();
        }} />
      <AlertDialog.Content style={theme} className={modalClass}>
        {children}
      </AlertDialog.Content>
    </AlertDialog.Portal>
  );
}

function UploadConflictDialog() {
  const { uploadPrompt, uploadApplying, answerUploadConflict, cancelUpload } = useExplorerFields(
    "uploadPrompt", "uploadApplying", "answerUploadConflict", "cancelUpload",
  );
  return (
    <Dialog.Root open={!!uploadPrompt} onOpenChange={open => { if (!open) cancelUpload(); }}>
      {uploadPrompt && (
        <DialogSurface>
          <UploadConflictContent key={uploadPrompt.revision} prompt={uploadPrompt}
            applying={uploadApplying} answer={answerUploadConflict} />
        </DialogSurface>
      )}
    </Dialog.Root>
  );
}

function UploadConflictContent({ prompt, applying, answer }: {
  prompt: ExplorerUploadPrompt;
  applying: boolean;
  answer: (action: "overwrite" | "skip", applyToAll: boolean) => unknown;
}) {
  const [applyToAll, setApplyToAll] = useState(false);
  return (
    <>
      <div>
        <Dialog.Title className={titleClass}>ファイルを上書きしますか？
          <span className="lxe:ml-2 lxe:whitespace-nowrap lxe:text-sm lxe:font-normal lxe:text-[var(--explorer-muted)]">{prompt.conflictIndex} / {prompt.conflictCount}</span>
        </Dialog.Title>
        <Dialog.Description className={descriptionClass}>
          保存先に同じ名前のファイルがあります。スキップすると、保存先のファイルを残します。
        </Dialog.Description>
      </div>
      <div className="lxe:rounded-md lxe:border lxe:border-[var(--explorer-border)] lxe:p-3">
        <p className="lxe:break-all lxe:font-medium">{prompt.conflict.relativePath}</p>
        <p className={descriptionClass}>
          保存先: {formatSize(prompt.conflict.existing.size)} / 追加するファイル: {formatSize(prompt.conflict.file.size)}
        </p>
      </div>
      {prompt.conflictIndex < prompt.conflictCount && <label className="lxe:flex lxe:cursor-pointer lxe:items-start lxe:gap-2 lxe:text-sm lxe:leading-relaxed">
        <input type="checkbox" checked={applyToAll} disabled={applying}
          onChange={event => setApplyToAll(event.target.checked)}
          className="lxe:mt-1 lxe:accent-[var(--explorer-accent)]" />
        残りのすべての競合に、この回答を適用する
      </label>}
      <div className={footerClass}>
        <button type="button" className={buttonClass} disabled={applying}
          onClick={() => answer("skip", applyToAll)}>スキップ</button>
        <button type="button" className={primaryClass} disabled={applying}
          onClick={() => answer("overwrite", applyToAll)}>
          {applying && <Loader2 size={16} className="lxe:animate-spin" aria-hidden="true" />}
          上書きする
        </button>
      </div>
    </>
  );
}

export const ExplorerDialogs = memo(function ExplorerDialogs() {
  const {
    rootLabel,
    modal,
    setModal,
    busy,
    saving,
    name,
    setName,
    nameInput,
    modalError,
    title,
    submitModal,
    destination,
    setDestination,
    entries,
    selected,
    details,
    setDetailId,
    openEntry,
    download,
    externalDownload,
    preview,
    setPreviewId,
    readFile,
    features,
    selectionOptions,
    readOnly,
    canRefresh,
  } = useExplorerFields("rootLabel", "modal", "setModal", "busy", "saving", "name", "setName", "nameInput", "modalError", "title", "submitModal", "destination", "setDestination", "entries", "selected", "details", "setDetailId", "openEntry", "download", "externalDownload", "preview", "setPreviewId", "readFile", "features", "selectionOptions", "readOnly", "canRefresh");
  const entryIndex = getEntryIndex(entries);
  const destinations = useMemo(() => {
    if (modal?.type !== "move" && modal?.type !== "copy") return [];
    const blocked = new Set(selectionRoots(entries, modal.ids ?? []).flatMap(root => subtreeEntries(entries, root.id).map(entry => entry.id)));
    return entries.filter(entry => entry.kind === "folder" && !blocked.has(entry.id));
  }, [entries, modal]);
  const detailsSize = useMemo(() => details?.kind === "folder"
    ? subtreeEntries(entries, details.id).reduce((sum, entry) => sum + entry.size, 0)
    : details?.size ?? 0, [entries, details]);
  const nameId = useId();
  const isCreation = modal?.type === "create" || modal?.type === "createFile";
  const nameLabel = modal?.type === "createFile" ? "ファイル名" : "フォルダ名";
  const canSelect = selectionOptions.mode !== "none";
  const modalAllowed =
    modal &&
    {
      create: features.createFolder,
      createFile: features.createFile,
      move: features.move,
      copy: features.copy,
      delete: features.delete,
      discard: !readOnly,
      refresh: canRefresh,
      help: true,
    }[modal.type];
  const shortcuts = [
    { label: "変更を保存", key: shortcutLabel("save"), enabled: !readOnly },
    { label: "最新の内容に更新", key: shortcutLabel("refresh"), enabled: canRefresh },
    { label: "ファイルを検索", key: shortcutLabel("search"), enabled: features.search },
    {
      label: "すべて選択",
      key: shortcutLabel("selectAll"),
      enabled: selectionOptions.mode === "multiple",
    },
    { label: "コピー", key: shortcutLabel("copy"), enabled: canSelect && features.copy },
    { label: "切り取り", key: shortcutLabel("cut"), enabled: canSelect && features.move },
    {
      label: "貼り付け",
      key: shortcutLabel("paste"),
      enabled: features.copy || features.move || features.uploadFiles || features.uploadFolders,
    },
    { label: "名前を変更", key: shortcutLabel("rename"), enabled: canSelect && features.rename },
    {
      label: features.preview ? "ファイル・フォルダを開く" : "フォルダを開く",
      key: shortcutLabel("open"),
      enabled: true,
    },
    { label: "削除", key: shortcutLabel("delete"), enabled: canSelect && features.delete },
    {
      label: canSelect
        ? features.move
          ? "選択・切り取りを解除"
          : "選択を解除"
        : "切り取りを解除",
      key: shortcutLabel("clear"),
      enabled: canSelect || features.move,
    },
    { label: "上のフォルダへ", key: shortcutLabel("up"), enabled: true },
    { label: "前のフォルダへ戻る", key: shortcutLabel("back"), enabled: true },
    { label: "次のフォルダへ進む", key: shortcutLabel("forward"), enabled: true },
  ].filter((shortcut) => shortcut.enabled);

  return (
    <>
      <UploadConflictDialog />
      <Dialog.Root
        open={
          !!modalAllowed &&
          !!modal &&
          modal.type !== "delete" &&
          modal.type !== "discard" &&
          modal.type !== "refresh"
        }
        onOpenChange={(open) => {
          if (!open && !saving) setModal(null);
        }}
      >
        <DialogSurface
          closeDisabled={saving}
          onOpenAutoFocus={(event) => {
            if (isCreation) {
              event.preventDefault();
              setTimeout(() => {
                nameInput.current?.focus();
                nameInput.current?.select();
              }, 30);
            }
          }}
        >
          <header>
            <Dialog.Title className={titleClass}>
              {modal?.type === "create"
                ? "新しいフォルダ"
                : modal?.type === "createFile"
                  ? "新しいファイル"
                  : modal?.type === "move"
                    ? "移動先を選択"
                    : modal?.type === "copy"
                      ? "コピー先を選択"
                      : "キーボードショートカット"}
            </Dialog.Title>
            <Dialog.Description className={descriptionClass}>
              {modal?.type === "help"
                ? "ファイル一覧で使えるショートカットです。"
                : modal?.type === "create"
                  ? `「${title}」にフォルダを作成します。`
                  : modal?.type === "createFile"
                    ? `「${title}」に空のファイルを作成します。`
                    : `${modal?.ids?.length ?? 0}項目の保存先を選んでください。`}
            </Dialog.Description>
          </header>
          {isCreation ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void submitModal();
              }}
            >
              <label
                className="lxe:mb-2 lxe:block lxe:text-xs lxe:font-medium lxe:text-[var(--explorer-muted)]"
                htmlFor={nameId}
              >
                {nameLabel}
              </label>
              <input
                id={nameId}
                ref={nameInput}
                value={name}
                maxLength={180}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    isComposingKeyEvent(event)
                  )
                    event.preventDefault();
                }}
                className={`${inputClass} lxe:min-h-[43px] lxe:w-full`}
                placeholder={`${nameLabel}を入力`}
              />
              <p className={errorClass} role="alert">
                {modalError}
              </p>
              <div className={footerClass}>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  キャンセル
                </button>
                <button
                  className={primaryClass}
                  type="submit"
                  disabled={busy || !name.trim()}
                >
                  {busy && (
                    <Loader2
                      className="lxe:animate-spin"
                      size={16}
                      aria-hidden="true"
                    />
                  )}
                  作成する
                </button>
              </div>
            </form>
          ) : modal?.type === "move" || modal?.type === "copy" ? (
            <div>
              <div
                className="lxe:max-h-[310px] lxe:overflow-auto lxe:rounded-[9px] lxe:border lxe:border-[var(--explorer-border)] lxe:p-[5px]"
                aria-label="保存先"
              >
                <button
                  type="button"
                  disabled={busy}
                  className={`lxe:flex lxe:w-full lxe:items-center lxe:gap-2.5 lxe:rounded-[5px] lxe:px-3 lxe:py-[11px] lxe:text-left lxe:outline-none lxe:focus-visible:ring-2 lxe:focus-visible:ring-inset lxe:focus-visible:ring-[var(--explorer-accent)] lxe:disabled:pointer-events-none lxe:disabled:opacity-45 ${destination === "root" ? "lxe:bg-[var(--explorer-selection)] lxe:text-[var(--explorer-accent)]" : "lxe:text-[var(--explorer-muted)] lxe:hover:bg-[var(--explorer-hover)]"}`}
                  onClick={() => setDestination("root")}
                  aria-pressed={destination === "root"}
                >
                  <HardDrive
                    size={19}
                    className="lxe:shrink-0 lxe:text-[var(--explorer-accent)]"
                    aria-hidden="true"
                  />
                  <span className="lxe:min-w-0 lxe:flex-1 lxe:wrap-anywhere">
                    {rootLabel}
                  </span>
                  {destination === "root" && (
                    <Check size={17} aria-hidden="true" />
                  )}
                </button>
                {destinations
                  .map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={busy}
                      className={`lxe:flex lxe:w-full lxe:items-center lxe:gap-2.5 lxe:rounded-[5px] lxe:px-3 lxe:py-[11px] lxe:text-left lxe:outline-none lxe:focus-visible:ring-2 lxe:focus-visible:ring-inset lxe:focus-visible:ring-[var(--explorer-accent)] lxe:disabled:pointer-events-none lxe:disabled:opacity-45 ${destination === entry.id ? "lxe:bg-[var(--explorer-selection)] lxe:text-[var(--explorer-accent)]" : "lxe:text-[var(--explorer-muted)] lxe:hover:bg-[var(--explorer-hover)]"}`}
                      onClick={() => setDestination(entry.id)}
                      aria-pressed={destination === entry.id}
                    >
                      <FileIcon
                        entry={entry}
                        location="destination"
                        selected={destination === entry.id}
                        className="lxe:size-[19px]"
                        defaultIcon={
                          <Folder
                            size={19}
                            className="lxe:shrink-0 lxe:text-[var(--explorer-folder)]"
                            style={{ fill: "none" }}
                            aria-hidden="true"
                          />
                        }
                      />
                      <span className="lxe:min-w-0 lxe:flex-1 lxe:wrap-anywhere">
                        {getEntryPath(entries, entry.id)
                          .map((parent) => parent.name)
                          .join(" / ")}
                      </span>
                      {destination === entry.id && (
                        <Check size={17} aria-hidden="true" />
                      )}
                    </button>
                  ))}
              </div>
              <p className={errorClass} role="alert">
                {modalError}
              </p>
              <div className={footerClass}>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className={primaryClass}
                  disabled={busy}
                  onClick={() => void submitModal()}
                >
                  {busy ? (
                    <Loader2
                      className="lxe:animate-spin"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    <FolderInput size={16} aria-hidden="true" />
                  )}
                  ここに{modal.type === "move" ? "移動" : "コピー"}
                </button>
              </div>
            </div>
          ) : modal?.type === "help" ? (
            <>
              <div>
                {shortcuts.map(({ label, key }) => (
                  <div
                    key={label}
                    className="lxe:flex lxe:flex-wrap lxe:items-center lxe:justify-between lxe:gap-x-4 lxe:gap-y-1 lxe:border-b lxe:border-[var(--explorer-border)] lxe:py-3 lxe:text-xs lxe:text-[var(--explorer-muted)]"
                  >
                    <span>{label}</span>
                    <kbd className="lxe:rounded lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-panel)] lxe:px-1.5 lxe:py-[3px] lxe:font-mono lxe:whitespace-nowrap">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
              {!readOnly && <p className="lxe:text-xs lxe:leading-[1.9] lxe:text-[var(--explorer-muted)]">
                操作はこの画面の未保存の変更として保持されます。「保存」で変更を確定し、「変更を破棄」で最後に保存した状態へ戻せます。
              </p>}
            </>
          ) : null}
        </DialogSurface>
      </Dialog.Root>

      <AlertDialog.Root
        open={features.delete && modal?.type === "delete"}
        onOpenChange={(open) => {
          if (!open && !saving) setModal(null);
        }}
      >
        <AlertSurface>
          <header>
            <div className="lxe:mb-3 lxe:grid lxe:size-[45px] lxe:place-items-center lxe:rounded-xl lxe:bg-[var(--explorer-danger)]/10 lxe:text-[var(--explorer-danger)]">
              <Trash2 size={24} aria-hidden="true" />
            </div>
            <AlertDialog.Title className={titleClass}>
              {modal?.ids?.length === 1
                ? `「${entryIndex.byId.get(modal.ids?.[0] ?? "")?.name ?? "項目"}」を削除しますか？`
                : `${modal?.ids?.length ?? 0}項目を削除しますか？`}
            </AlertDialog.Title>
            <AlertDialog.Description className={descriptionClass}>
              フォルダ内のファイルも削除対象になります。保存するまでは「変更を破棄」で元に戻せます。
            </AlertDialog.Description>
          </header>
          <p className={errorClass} role="alert">
            {modalError}
          </p>
          <div className={footerClass}>
            <AlertDialog.Cancel asChild>
              <button type="button" className={buttonClass} disabled={saving}>
                キャンセル
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              className={dangerClass}
              onClick={() => void submitModal()}
              disabled={busy}
            >
              {busy ? (
                <Loader2
                  size={16}
                  className="lxe:animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Trash2 size={16} aria-hidden="true" />
              )}
              削除する
            </button>
          </div>
        </AlertSurface>
      </AlertDialog.Root>

      <Dialog.Root
        open={features.details && !!details}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <DialogSurface
          className={`lxe:absolute lxe:inset-y-0 lxe:right-0 lxe:flex lxe:w-[380px] lxe:max-w-[95%] lxe:flex-col lxe:gap-3.5 lxe:overflow-y-auto lxe:border-l lxe:p-[25px] ${surfaceClass}`}
        >
          <header>
            <Dialog.Title className={`${titleClass} lxe:text-[17px]`}>
              ファイルの詳細
            </Dialog.Title>
            <Dialog.Description className={`${descriptionClass} lxe:text-xs`}>
              選択した項目の情報
            </Dialog.Description>
          </header>
          {details && (
            <div className="lxe:min-h-0 lxe:overflow-auto lxe:py-[5px]">
              <div className="lxe:mt-1 lxe:mb-[22px] lxe:grid lxe:h-[170px] lxe:place-items-center lxe:rounded-xl lxe:border lxe:border-[var(--explorer-border)] lxe:bg-[var(--explorer-panel)]">
                <FileIcon
                  entry={details}
                  location="details"
                  selected={selected.includes(details.id)}
                  large
                  className="lxe:size-[58px]"
                />
              </div>
              <h2 className="lxe:mb-[5px] lxe:text-lg lxe:leading-relaxed lxe:font-medium lxe:wrap-anywhere">
                {details.name}
              </h2>
              <dl className="lxe:my-[27px]">
                {[
                  [
                    "保存場所",
                    rootLabel + " / " +
                      getEntryPath(entries, details.parent)
                        .map((entry) => entry.name)
                        .join(" / "),
                  ],
                  [
                    "サイズ",
                    formatSize(detailsSize),
                  ],
                  ["作成日時", formatEntryDate(details.createdAt)],
                  ["更新日時", formatEntryDate(details.updatedAt)],
                  ...(features.favorites
                    ? [["お気に入り", details.favorite ? "登録済み" : "未登録"]]
                    : []),
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="lxe:grid lxe:grid-cols-[80px_1fr] lxe:gap-3 lxe:border-b lxe:border-[var(--explorer-border)] lxe:py-3 lxe:text-xs lxe:leading-[1.8]"
                  >
                    <dt className="lxe:text-[var(--explorer-muted)]">{label}</dt>
                    <dd className="lxe:wrap-anywhere">{value}</dd>
                  </div>
                ))}
              </dl>
              {(details.kind === "folder" || features.preview) && (
                <button
                  type="button"
                  className={`${primaryClass} lxe:mb-2.5 lxe:w-full`}
                  onClick={() => {
                    setDetailId(null);
                    openEntry(details);
                  }}
                >
                  <FolderOpen size={16} aria-hidden="true" />
                  {details.kind === "folder" ? "フォルダを開く" : "プレビュー"}
                </button>
              )}
              {features.download && (
                <button
                  type="button"
                  className={`${buttonClass} lxe:mb-2.5 lxe:w-full`}
                  onClick={() => void download(details)}
                >
                  <ArrowDownToLine size={16} aria-hidden="true" />
                  {details.kind === "folder" && !externalDownload ? "ZIPでダウンロード" : "ダウンロード"}
                </button>
              )}
            </div>
          )}
        </DialogSurface>
      </Dialog.Root>

      <Dialog.Root
        open={features.preview && !!preview}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
      >
        <DialogSurface
          className={`lxe:absolute lxe:top-1/2 lxe:left-1/2 lxe:flex lxe:max-h-[calc(100%-2rem)] lxe:w-[900px] lxe:max-w-[calc(100%-2.5rem)] lxe:-translate-x-1/2 lxe:-translate-y-1/2 lxe:flex-col lxe:gap-4 lxe:overflow-y-auto lxe:rounded-[14px] lxe:p-[23px] ${surfaceClass}`}
        >
          <header>
            <Dialog.Title className="lxe:flex lxe:min-w-0 lxe:items-center lxe:gap-[11px] lxe:pr-[25px] lxe:text-base lxe:font-semibold">
              {preview && (
                <FileIcon
                  entry={preview}
                  location="preview"
                  selected={selected.includes(preview.id)}
                />
              )}
              <span className="lxe:truncate">{preview?.name}</span>
            </Dialog.Title>
            <Dialog.Description className="lxe:mt-1 lxe:pl-[45px] lxe:text-xs lxe:leading-[1.8] lxe:text-[var(--explorer-muted)]">
              {preview
                ? formatSize(preview.size)
                : ""}
            </Dialog.Description>
          </header>
          {preview && (
            <>
              <FilePreview
                entry={preview}
                readFile={readFile}
                allowDownload={features.download}
              />
              {features.download && (
                <div className="lxe:flex lxe:shrink-0 lxe:items-center lxe:justify-between lxe:pt-0.5 lxe:text-xs lxe:text-[var(--explorer-muted)]">
                  <span>プレビュー</span>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => void download(preview)}
                  >
                    <ArrowDownToLine size={16} aria-hidden="true" />
                    ダウンロード
                  </button>
                </div>
              )}
            </>
          )}
        </DialogSurface>
      </Dialog.Root>

      <AlertDialog.Root
        open={(!readOnly && modal?.type === "discard") || (canRefresh && modal?.type === "refresh")}
        onOpenChange={(open) => {
          if (!open && !busy) setModal(null);
        }}
      >
        <AlertSurface onCancel={() => { if (!busy) setModal(null); }}>
          <header>
            <AlertDialog.Title className={titleClass}>
              {modal?.type === "refresh" ? "未保存の変更を破棄して再読み込みしますか？" : "未保存の変更を破棄しますか？"}
            </AlertDialog.Title>
            <AlertDialog.Description className={descriptionClass}>
              {modal?.type === "refresh"
                ? "再読み込みに成功すると、未保存の変更は失われ、最新の一覧に置き換わります。キャンセルすると現在の変更を保持します。"
                : "追加したファイルやフォルダ、移動、名前の変更、削除を取り消し、最後に保存した状態へ戻します。"}
            </AlertDialog.Description>
          </header>
          {modalError && <p className={errorClass} role="alert">
            {modalError}
          </p>}
          <div className={footerClass}>
            <AlertDialog.Cancel asChild>
              <button type="button" className={buttonClass} disabled={busy}>
                キャンセル
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              className={dangerClass}
              disabled={busy}
              onClick={() => void submitModal()}
            >
              {modal?.type === "refresh" ? "破棄して再読み込み" : "変更を破棄"}
            </button>
          </div>
        </AlertSurface>
      </AlertDialog.Root>
    </>
  );
});
