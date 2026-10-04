import { createTextSearchMatcher } from "@likex/core/text-search";
import type { ExplorerEntry, ExplorerSearchHit } from "@likex/explorer";

export type MeetingSearchFilters = { customerName: string; dateFrom: string; dateTo: string };
type MeetingRecord = { id: string; name: string; customerName: string; meetingDate: string; updatedAt: string; topic: string; body: string };

/** Fictional host-owned index. Business dates are independent from file metadata. */
export const meetingSearchRecords: readonly MeetingRecord[] = [
  { id: "meeting-shinonome-0912", name: "東雲製作所_契約更新_20260912.md", customerName: "東雲製作所", meetingDate: "2026-09-12", updatedAt: "2026-10-03T09:30:00.000Z", topic: "契約更新の条件確認", body: "年間契約の利用状況と更新条件を確認した。\n料金改定は11月の更新分から適用し、既存契約には経過措置を設ける。\n営業担当は対象プラン別の比較表を9月末までに提出する。" },
  { id: "meeting-shinonome-0926", name: "東雲製作所_新単価レビュー_20260926.md", customerName: "東雲製作所", meetingDate: "2026-09-26", updatedAt: "2026-09-27T03:00:00.000Z", topic: "新単価のレビュー", body: "前回の比較表をもとに追加拠点の契約を検討した。\n料金改定の対象は標準プランと追加アカウントで、サポート費用は据え置く。\n最終承認後、購買部に見積書を共有する。" },
  { id: "meeting-shinonome-0828", name: "東雲製作所_次年度予算_20260828.md", customerName: "東雲製作所", meetingDate: "2026-08-28", updatedAt: "2026-09-17T07:00:00.000Z", topic: "次年度予算の相談", body: "次年度予算の前提を整理した。\n料金改定については9月の会議で詳細を検討し、今回は現行価格で予算案を作成する。" },
  { id: "meeting-aoba-0916", name: "青葉商事_運用コスト_20260916.md", customerName: "青葉商事", meetingDate: "2026-09-16", updatedAt: "2026-09-20T05:00:00.000Z", topic: "運用コストの見直し", body: "クラウド利用量と運用工数を確認した。\n料金改定に合わせて低利用アカウントを整理し、年間費用を抑える方針とした。" },
  { id: "meeting-tsubasa-0918", name: "つばさ物流_在庫連携_20260918.md", customerName: "つばさ物流", meetingDate: "2026-09-18", updatedAt: "2026-10-01T02:00:00.000Z", topic: "在庫データ連携", body: "倉庫システムとERPの在庫連携を確認した。\n夜間バッチの再実行手順を整理し、受注残と実在庫の差異を日次で確認する。" },
  { id: "meeting-shinonome-0910", name: "東雲製作所_障害対策_20260910.md", customerName: "東雲製作所", meetingDate: "2026-09-10", updatedAt: "2026-09-11T08:00:00.000Z", topic: "障害時の運用", body: "受注データの復旧目標と連絡体制を確認した。\n監視通知の宛先を一本化し、月に一度の復旧訓練を実施する。" },
];
export const meetingSearchCustomers = [...new Set(meetingSearchRecords.map(item => item.customerName))];
export const meetingSearchExample: Readonly<MeetingSearchFilters & { keyword: string }> = {
  customerName: "東雲製作所", dateFrom: "2026-09-01", dateTo: "2026-09-30", keyword: "料金改定",
};
export function meetingSearchFile(id: string): string {
  const record = meetingSearchRecords.find(item => item.id === id);
  if (!record) return "";
  return `# ${record.topic}\n\n顧客: ${record.customerName}\n会議日: ${record.meetingDate}\n\n${record.body}\n`;
}
export function createMeetingSearchEntries(): ExplorerEntry[] {
  return meetingSearchRecords.map(record => ({ id: record.id, name: record.name, parent: "root", kind: "file", mime: "text/markdown",
    size: new TextEncoder().encode(meetingSearchFile(record.id)).length, createdAt: `${record.meetingDate}T09:00:00.000Z`, updatedAt: record.updatedAt, favorite: 0, source: { kind: "existing", id: record.id } }));
}
function readFilters(params: Readonly<Record<string, unknown>> | undefined): MeetingSearchFilters {
  const value = (key: keyof MeetingSearchFilters) => {
    const input = params?.[key] ?? "";
    if (typeof input !== "string" || input.length > 100) throw new Error("議事録の検索条件を確認してください。");
    return input;
  };
  const filters = { customerName: value("customerName"), dateFrom: value("dateFrom"), dateTo: value("dateTo") };
  for (const date of [filters.dateFrom, filters.dateTo]) if (date) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("会議日は有効な日付で指定してください。");
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw new Error("会議日の終了日は開始日以降にしてください。");
  return filters;
}

/** The host interprets business filters; Explorer receives only IDs and presentation details. */
export function searchMeetingMinutes(entries: readonly ExplorerEntry[], keyword: string, params: Readonly<Record<string, unknown>> | undefined): readonly ExplorerSearchHit[] {
  const filters = readFilters(params), text = keyword.trim();
  if (!text) return [];
  const matcher = createTextSearchMatcher({ text }), known = new Set(entries.filter(entry => entry.kind === "file").map(entry => entry.id));
  return meetingSearchRecords.filter(record => known.has(record.id)
    && (!filters.customerName || filters.customerName === record.customerName)
    && (!filters.dateFrom || record.meetingDate >= filters.dateFrom)
    && (!filters.dateTo || record.meetingDate <= filters.dateTo)
    && matcher.test(record.body))
    .sort((a, b) => b.meetingDate.localeCompare(a.meetingDate))
    .map(record => ({ entryId: record.id,
      snippet: record.body.split("\n").find(paragraph => matcher.test(paragraph)) ?? record.body,
      reason: `本文に「${text}」が含まれます${filters.customerName ? "・顧客一致" : ""}${filters.dateFrom || filters.dateTo ? "・会議日の条件に一致" : ""}`,
      metadata: { customerName: record.customerName, meetingDate: record.meetingDate, topic: record.topic } }));
}

/** Local demo latency, cancelled immediately when Explorer abandons the request. */
export function waitForMeetingSearchResult(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 650);
    function abort() { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Each yield is an additional batch, never a replacement of the previous results. */
export async function* streamMeetingSearchResults(hits: readonly ExplorerSearchHit[], signal: AbortSignal,
  wait: (signal: AbortSignal) => Promise<void> = waitForMeetingSearchResult): AsyncGenerator<readonly ExplorerSearchHit[]> {
  signal.throwIfAborted();
  for (const hit of hits) {
    await wait(signal);
    signal.throwIfAborted();
    yield [hit];
  }
}
