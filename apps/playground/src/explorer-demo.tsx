import { useCallback, useRef, useState } from "react";
import Explorer, {
  type ExplorerEntry,
  type ExplorerSavePayload,
  type ExplorerContextMenuProvider,
  type ExplorerSelectedFileMode,
  type ExplorerHandle,
} from "@likex/explorer";
import { seedEntries } from "./demo/seed";
import { createExplorerIconSamples } from "./demo/icon-samples";
import { useExplorerAiDialog } from "./demo/explorer-ai-dialog";
import { getDemoContextMenuMode } from "./demo/context-menu-mode";
import "../../../packages/explorer/src/styles.css";

const iconSamplesFolderId = "demo-icon-samples";
const iconSamplesFolderName = "icons";

type DemoWorkspace = {
  entries: ExplorerEntry[];
  files: Map<string, Blob>;
};

function createDemoWorkspace(): DemoWorkspace {
  const files = new Map<string, Blob>();
  const entries = seedEntries.map((seed): ExplorerEntry => {
    const { id, parent, name, kind, mime, createdAt, updatedAt, favorite } =
      seed;
    if (kind === "folder") {
      return {
        id,
        parent,
        name,
        kind,
        size: 0,
        mime,
        createdAt,
        updatedAt,
        favorite,
        source: null,
      };
    }

    const content = (seed.content ?? "").replace(
      "アップロードしたファイルはこのワークスペースに保存されます。",
      "ファイルの追加や整理は、保存するまで画面内の下書きです。\nこのデモの保存先はこのタブのメモリで、再読み込みすると初期状態に戻ります。",
    );
    const blob = new Blob([content], { type: mime });
    files.set(id, blob);
    return {
      id,
      parent,
      name,
      kind,
      size: blob.size,
      mime,
      createdAt,
      updatedAt,
      favorite,
      source: { kind: "existing", id },
    };
  });
  const samples = createExplorerIconSamples();
  const sampleFolder = samples.find((entry) => entry.kind === "folder")!;
  entries.push({
    ...sampleFolder,
    id: iconSamplesFolderId,
    name: iconSamplesFolderName,
  });
  for (const sample of samples) {
    if (sample.source?.kind === "local") {
      files.set(sample.id, sample.source.file);
      entries.push({
        ...sample,
        parent: iconSamplesFolderId,
        source: { kind: "existing", id: sample.id },
      });
    } else {
      entries.push({ ...sample, parent: iconSamplesFolderId });
    }
  }
  return { entries, files };
}

export default function ExplorerDemo() {
  const explorerRef = useRef<ExplorerHandle>(null);
  // An opt-in, memory-only example of notifications sent by the host while saving.
  const [notificationDemo] = useState(() => new URLSearchParams(window.location.search).has("notificationDemo"));
  const [initialWorkspace] = useState(createDemoWorkspace);
  const savedWorkspace = useRef(initialWorkspace);
  const refresh = useCallback(() => savedWorkspace.current.entries, []);
  const [contextMenuMode] = useState(getDemoContextMenuMode);
  const [initialView] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return {
      initialPath: query.get("initialPath") ?? undefined,
      selectedFile: query.get("selectedFile") ?? undefined,
      selectedFileMode: (query.get("selectedFileMode") === "preview" ? "preview" : "select") as ExplorerSelectedFileMode,
    };
  });
  const { generate, dialog } = useExplorerAiDialog();
  const contextMenuItems = useCallback<ExplorerContextMenuProvider>(context => {
    if (context.target.kind !== "entry" || context.target.entry.kind !== "file" || context.readOnly || !context.features.uploadFiles) return [];
    return [{
      id: "demo-ai-instruction",
      label: "AIに指示",
      onSelect: async (captured, { signal }) => {
        if (captured.target.kind !== "entry") return;
        const file = await generate(captured, signal);
        if (!file || signal.aborted) throw new DOMException("指示をキャンセルしました", "AbortError");
        return {
          change: { type: "upload", files: [file], parentId: captured.target.entry.parent },
          description: `「${file.name}」を元のファイルと同じフォルダへ追加します。`,
        };
      },
    }];
  }, [generate]);

  const readFile = useCallback(async (sourceId: string): Promise<Blob> => {
    const blob = savedWorkspace.current.files.get(sourceId);
    if (!blob) throw new Error("保存済みのファイルが見つかりません");
    return blob;
  }, []);

  const save = useCallback(async (payload: ExplorerSavePayload): Promise<ExplorerEntry[]> => {
    const files = new Map<string, Blob>();
    const localIds = new Map<File, string>();
    const entries = payload.entries.map((entry): ExplorerEntry => {
      if (entry.kind === "folder") return { ...entry, source: null };
      if (!entry.source) throw new Error("ファイル本体が見つかりません");

      let sourceId: string;
      let blob: Blob;
      if (entry.source.kind === "local") {
        // Copies of one selected File share a single committed file body.
        sourceId = localIds.get(entry.source.file) ?? crypto.randomUUID();
        localIds.set(entry.source.file, sourceId);
        blob = entry.source.file;
      } else {
        sourceId = entry.source.id;
        const existing = savedWorkspace.current.files.get(sourceId);
        if (!existing)
          throw new Error(
            `「${entry.name}」の保存済みファイルが見つかりません`,
          );
        blob = existing;
      }

      files.set(sourceId, blob);
      return { ...entry, source: { kind: "existing", id: sourceId } };
    });

    const localFiles = payload.entries.filter(entry => entry.source?.kind === "local");
    let noticeId: string | undefined;
    if (notificationDemo && localFiles.length) {
      noticeId = explorerRef.current?.notify({ kind: "progress", message: `${localFiles.length}ファイルを保存しています`,
        description: "デモの保存処理です。サーバーには送信しません。" });
      for (const progress of [20, 40, 60, 80, 100]) {
        await new Promise(resolve => setTimeout(resolve, 1600));
        if (!explorerRef.current) throw new DOMException("表示を終了しました", "AbortError");
        explorerRef.current.notify({ id: noticeId, kind: "progress", progress,
          message: `${localFiles.length}ファイルを保存しています`,
          description: "デモの保存処理です。サーバーには送信しません。" });
      }
    }
    // Publish the whole result only after every reference has been resolved.
    savedWorkspace.current = { entries, files };
    if (noticeId) explorerRef.current?.notify({ id: noticeId, kind: "success",
      message: `${localFiles.length}ファイルを保存しました`, persistent: true,
      details: localFiles.map(entry => ({ kind: "success", message: entry.name })) });
    return entries;
  }, [notificationDemo]);

  return (
    <div style={{ height: "100dvh", minHeight: 0, minWidth: 0 }}>
      <Explorer
        ref={explorerRef}
        initialEntries={initialWorkspace.entries}
        {...initialView}
        onSave={save}
        onRefresh={refresh}
        readFile={readFile}
        colorMode="system"
        defaultPath={`/${iconSamplesFolderName}`}
        view={{ defaultMode: "medium" }}
        features={{ favorites: false, copy: false, createFile: false }}
        upload={{
          allowedExtensions: [".csv", ".md", ".txt", ".json", ".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt"],
        }}
        selection={{ checkboxes: false }}
        getContextMenuItems={contextMenuItems}
        contextMenuExecutionMode={contextMenuMode}
        style={{ borderRadius: 0, borderWidth: 0 }}
      />
      {dialog}
    </div>
  );
}
