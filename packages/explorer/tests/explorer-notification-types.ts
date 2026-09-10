import { createRef } from "react";
import type { ExplorerHandle, ExplorerNotification, ExplorerNotificationDetail, ExplorerPopupProps, ExplorerProps } from "../src";

const ref = createRef<ExplorerHandle>();
export const embedded = { initialEntries: [], ref } satisfies ExplorerProps;
export const popup = { ...embedded, renderTrigger: () => null } satisfies ExplorerPopupProps;
export const details = [{ kind: "success", message: "資料.pdf" }] as const satisfies readonly ExplorerNotificationDetail[];
export const success = { kind: "success", message: "アップロード完了", details, hint: "説明" } satisfies ExplorerNotification;
export const progress = { kind: "progress", message: "アップロード中", progress: 42 } satisfies ExplorerNotification;
export const indeterminate = { kind: "progress", message: "準備中" } satisfies ExplorerNotification;
export const id: string | undefined = ref.current?.notify(progress);
if (id) ref.current?.dismissNotification(id);
ref.current?.clearNotifications();

// @ts-expect-error Only progress notifications accept a percentage.
export const invalidSuccess = { kind: "success", message: "完了", progress: 100 } satisfies ExplorerNotification;
// @ts-expect-error Percentage is numeric, not CSS text.
export const invalidProgress = { kind: "progress", message: "送信中", progress: "50%" } satisfies ExplorerNotification;
// @ts-expect-error Notifications render plain text, never host React nodes.
export const invalidMessage = { kind: "info", message: { type: "div" } } satisfies ExplorerNotification;
// @ts-expect-error Details use the same closed status set.
export const invalidDetail = { message: "資料.pdf", kind: "warning" } satisfies ExplorerNotificationDetail;
