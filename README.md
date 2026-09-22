# LikeX

身近なアプリケーションのように操作できるReact UIを集めるリポジトリです。

各モジュールはパッケージとして導入でき、ソースフォルダをコピーして使うこともできます。各UIは小さな共通基盤 `@likex/core` を使います。共通Providerは不要です。

| モジュール | 用途 | ガイド |
| --- | --- | --- |
| `@likex/core` | 保存・編集許可・通知・機能設定の共通型とヘルパー | [共通基盤](packages/core/README.md) |
| `@likex/explorer` | ファイル・フォルダの表示と編集 | [Explorer](packages/explorer/README.md) |
| `@likex/spreadsheet` | Excel風のセル編集・基本数式・複数シート | [Spreadsheet](packages/spreadsheet/README.md) |
| `@likex/slide` | PowerPoint風のスライド編集・発表・PPTX入出力 | [LikeSlide](packages/slide/README.md) |
| `@likex/document` | Word風の文書編集・段落・表・画像・DOCX入出力 | [LikeDocument](packages/document/README.md) |
| `@likex/board` | カードとタスクのかんばん | [LikeBoard](packages/board/README.md) |
| `@likex/diagram` | ノード・接続線の図 | [LikeDiagram](packages/diagram/README.md) |
| `@likex/calendar` | 月・週・日の予定管理 | [LikeCalendar](packages/calendar/README.md) |
| `@likex/whiteboard` | 付箋・図形・画像のキャンバス | [LikeWhiteboard](packages/whiteboard/README.md) |
| `@likex/aichat` | AIとの会話・ストリーミング応答 | [LikeAIChat](packages/aichat/README.md) |
| `@likex/chat` | 人同士のDM・グループ・スペース・スレッド | [LikeChat](packages/chat/README.md) |
| `@likex/dataview` | 型付きレコード・検索・集計表示 | [LikeDataView](packages/dataview/README.md) |
| `@likex/form` | フォーム設計・回答・検証 | [LikeForm](packages/form/README.md) |

標準保存ファイルはSpreadsheetが `.spon`、LikeSlideが `.slon`、LikeDocumentが `.dcon` で、内容は純粋なJSONです。現在の保存構造をバージョン1とし、読み込みにも同じ形式を使います。保存APIとExplorerでの扱いは [ネイティブ保存形式](docs/architecture.md#ネイティブ保存形式) を参照してください。

旧AI向けLikeChatは `@likex/aichat` / `LikeAIChat` に移りました。AI会話は `likex.aichat` / version 1、人同士のLikeChatは `likex.chat` / version 2を保存します。旧AIファイルは[検証付きの移行API](packages/aichat/src/docs/native-files.md#旧likechatからの移行)で読み込めます。

[機能別APIリファレンス](docs/APIDocs/index.html) · [ドキュメントの開き方](docs/APIDocs/README.md)

LLMやAIエージェントから各モジュールのJSONを操作するための [スキルとCLI](docs/skills.md) も同梱します。`SKILL.md` を入口に、スキーマ参照と公開APIを呼ぶスクリプトを利用できます。

## Explorerを使う

```tsx
import Explorer from "@likex/explorer";
import "@likex/explorer/styles.css";

<Explorer initialEntries={[]} style={{ height: 640 }} />
```

[パッケージの導入手順](packages/explorer/README.md) · [コピー導入・API・運用ガイド](packages/explorer/src/docs/README.md)

React / React DOMと表示枠の高さは利用側で用意します。生成済みCSSを同梱しているため、利用先へのTailwind CSSの導入は不要です。コピー導入ではUIの `src/` と `packages/core/src/` を隣接フォルダへ置き、UI側の `core.ts`・`json.ts`・`ooxml.ts`（存在するもの）を相対importに変更します。詳細は各導入ガイドを参照してください。

Explorerはファイル操作をクライアントの下書きに保持し、保存ボタンから `onSave` へ最終一覧と差分を渡します。`onSave` 未指定なら読み取り専用です。保存・認証・DB・Blob / S3への接続は親アプリが担当します。

## 開発する

Node.js 22.13以上とnpmを使います。

```bash
npm ci
npm run dev
```

デモは `http://127.0.0.1:5173/`（Explorer）、`/spreadsheet`、`/slide`、`/document`、`/board`、`/diagram`、`/calendar`、`/whiteboard`、`/aichat`（AIとの会話）、`/chat`（人同士の会話）、`/dataview`、`/form` で起動します。保存先はタブ内メモリです。Office形式の読み書きはExcel・PowerPoint・Wordの全機能との互換を保証するものではありません。

```text
packages/explorer/  # 独立して配布・コピーできるExplorer
packages/core/      # 共通契約・ヘルパーの唯一の編集元
packages/spreadsheet/ # 独立して配布・コピーできるSpreadsheet
packages/slide/      # 独立して配布・コピーできるLikeSlide
packages/document/   # 独立して配布・コピーできるLikeDocument
packages/aichat/      # AIとの会話・ストリーミング応答
packages/chat/        # 人同士のDM・グループ・スペース
apps/playground/    # Vite + Reactのデモ
scripts/            # ビルド・配布・導入検証
docs/               # 開発・構成・公開手順
```

[開発ドキュメント](docs/README.md) にコマンド一覧、構成、配布手順、レビュー記録をまとめています。Board以下の追加モジュールも `packages/<module>/` に実装・テスト・ガイド・スキルをまとめています。

LikeXは[MITライセンス](LICENSE)です。商用利用・改変・再配布が可能です。第三者の著作権・ライセンス通知も保持してください。[ライセンスと配布範囲](docs/licensing.md)に確認方法をまとめています。

GitHubリポジトリは公開しています。npm・GitHub Releasesへのパッケージ公開は未実施で、`private: true` は誤公開を防ぐため維持しています。
