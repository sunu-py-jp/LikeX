import type { ExplorerEntry } from "@likex/explorer";

type DemoSeedEntry = Omit<ExplorerEntry, "source"> & { content: string | null };

const date = "2026-09-05T08:30:00.000Z";
const folder = (id: string, name: string, parent = "root", favorite = 0): DemoSeedEntry => ({
  id, name, parent, kind: "folder", size: 0, mime: "", content: null,
  createdAt: date, updatedAt: date, favorite,
});
const file = (id: string, name: string, parent: string, content: string, day = 5, favorite = 0): DemoSeedEntry => ({
  id, name, parent, kind: "file", size: new TextEncoder().encode(content).length,
  mime: name.endsWith(".json") ? "application/json" : name.endsWith(".csv") ? "text/csv" : "text/plain",
  content, createdAt: date, updatedAt: `2026-09-0${day}T08:30:00.000Z`, favorite,
});
export const seedEntries: DemoSeedEntry[] = [
  folder("projects","プロジェクト","root",1), folder("documents","ドキュメント","root",1), folder("assets","素材・デザイン"), folder("archive","アーカイブ"),
  folder("erp","ERPリニューアル","projects",1), folder("portal","社内ポータル","projects"), folder("meetings","議事録","documents"), folder("guides","ガイドライン","documents"),
  file("welcome","はじめに.md","root", "# ファイルワークスペースへようこそ\n\n操作を試すためのサンプルファイルが入っています。\n\n## できること\n\n・ファイルのアップロードとダウンロード\n・フォルダ作成、名前の変更、コピー、移動\n・ファイル名の検索、並べ替え\n・お気に入りへの追加\n\nフォルダはダブルクリックで開きます。\nファイルを選択して Space キーを押すとプレビューできます。\n\nアップロードしたファイルはこのワークスペースに保存されます。\nサンプルには実在する会社のデータは含まれていません。\n",5,1),
  file("project-plan","プロジェクト概要.md","root","# ERP リニューアル\n\n## プロジェクトの目的\n受注から出荷までの情報を一元化し、日々の業務をスムーズにします。\n\n## 対象業務\n1. 受注・売上管理\n2. 在庫・出荷管理\n3. 仕入・支払管理\n\n## 今月のマイルストーン\n・9/08　業務ヒアリング\n・9/15　画面プロトタイプレビュー\n・9/25　基本設計の確認\n\n## 次のアクション\n各チームからのフィードバックを整理し、画面へ反映します。\n",5),
  file("schedule","タスク一覧.csv","root","タスク,担当チーム,期限,ステータス\n要件の確認,業務チーム,2026/09/08,進行中\n画面設計,開発チーム,2026/09/12,進行中\nデータ移行計画,基盤チーム,2026/09/18,未着手\nユーザーテスト,品質チーム,2026/09/25,未着手\n",4),
  file("settings","workspace.config.json","root",JSON.stringify({workspace:"Explorer",language:"ja",defaultView:"list",fileNaming:"original",version:1},null,2),3),
  file("notes","リリースノート.md","root","# リリースノート\n\n## 2026.09\n\n### 新しい機能\n・複数のファイルをまとめて整理\n・フォルダ間のドラッグ＆ドロップ\n・画像とテキストのプレビュー\n\n### 操作のヒント\nCtrl / Cmd を押しながらクリックすると複数選択できます。\nShift キーを押しながらクリックすると範囲選択できます。\n",2),
  file("erp-spec","要件定義メモ.md","erp","# 要件定義メモ\n\n## 受注入力\n・得意先、商品、数量、納期を入力\n・過去の取引条件を参照\n・入力内容を確認して確定\n\n## 検討事項\n・権限に応じた操作範囲\n・監査ログの保存\n・既存データとの整合性\n",5),
  file("erp-data","品目サンプル.csv","erp","品目コード,品目名,単位,単価\nP001,サンプル商品A,個,1200\nP002,サンプル商品B,箱,3600\nP003,サンプル商品C,個,850\n",3),
  file("portal-spec","ページ構成.md","portal","# 社内ポータル\n\n- お知らせ\n- ドキュメント\n- プロジェクト\n- 問い合わせ\n",4),
  file("meeting","定例ミーティング_0904.md","meetings","# 定例ミーティング\n\n日時：2026年9月4日\n\n## 共有事項\n画面プロトタイプを確認しました。\nファイル管理を一つの画面で完結できる方針で進めます。\n\n## 決定事項\n同期ではなく、アップロードでファイルを管理します。\n",4),
  file("guide","ファイル命名ガイド.md","guides","# ファイルの命名ガイド\n\n内容が分かる短い名前を付けましょう。\n\n例：議事録_20260905.md\n\n関連するファイルは同じフォルダへまとめてください。\n",2),
  file("colors","デザイントークン.json","assets",JSON.stringify({primary:"#2763ed",ink:"#182330",surface:"#ffffff",border:"#e5e9ef"},null,2),1),
];
