# LLM向けのドキュメント操作スキル

保存用JSONを持つ各モジュールには、画面を用意せずネイティブJSONを操作するスキルを同梱しています。

| スキル | 対象 |
| --- | --- |
| [likex-spreadsheet](../packages/spreadsheet/skills/likex-spreadsheet/SKILL.md) | `.spon`のブック、セル、行列、書式、図形など |
| [likex-slide](../packages/slide/skills/likex-slide/SKILL.md) | `.slon`のページ、テキスト、図形、画像など |
| [likex-document](../packages/document/skills/likex-document/SKILL.md) | `.dcon`の文章、段落、書式、表、画像など |
| [likex-board](../packages/board/skills/likex-board/SKILL.md) | カードとタスクのかんばんのJSON |
| [likex-diagram](../packages/diagram/skills/likex-diagram/SKILL.md) | ノード・接続線の図のJSON |
| [likex-calendar](../packages/calendar/skills/likex-calendar/SKILL.md) | 月・週・日の予定管理のJSON |
| [likex-whiteboard](../packages/whiteboard/skills/likex-whiteboard/SKILL.md) | 付箋・図形・画像のキャンバスのJSON |
| [likex-aichat](../packages/aichat/skills/likex-aichat/SKILL.md) | AI会話・ストリーミング応答のJSON（`likex.aichat` / version 1） |
| [likex-chat](../packages/chat/skills/likex-chat/SKILL.md) | 人同士のDM・グループ・スペース・返信のJSON（`likex.chat` / version 2） |
| [likex-dataview](../packages/dataview/skills/likex-dataview/SKILL.md) | 型付きレコード・検索・集計表示のJSON |
| [likex-form](../packages/form/skills/likex-form/SKILL.md) | フォーム設計・回答・検証のJSON |

旧AI LikeChatの `likex.chat` / version 1ファイルは `likex-aichat` スキルとAIChatのパーサーを使って検証・移行します。人同士の会話には `likex-chat` スキルを選び、形式名だけで互換性を判断しないでください。

## 利用する

`packages/<module>/skills/likex-<module>/` がスキルの単位です。パッケージにも同じフォルダを同梱します。LLMに入口の `SKILL.md` を渡し、必要なときに `references/` を読めるようにします。スクリプト実行機能があるエージェントには `scripts/` も渡してください。チャットへ `SKILL.md` の文章だけを貼っても、参照ファイルの読み込みやスクリプト実行が自動で可能になるわけではありません。

実行にはNode.js 22.13以上と、スキルと同じバージョンのLikeXパッケージが必要です。npmレジストリへの公開はまだ行っていないため、各パッケージの導入ガイドにあるtarballを使用してください。スキルのコピーだけではライブラリ本体は含まれません。Reactの描画・DOM・CSSは不要です。

インストールしたパッケージ内のCLIは、そのパッケージのモデルを使用します。スキルを別の場所へコピーした場合は、`--project` でライブラリをインストールしたプロジェクトを指定できます。読み書きする相対パスは、コマンドを実行したディレクトリを基準にします。

```bash
node /path/to/likex-spreadsheet/scripts/document.mjs inspect \
  --project /path/to/application \
  --input report.spon

node /path/to/likex-spreadsheet/scripts/document.mjs apply \
  --project /path/to/application \
  --input report.spon --commands changes.json --output report-edited.spon
```

利用できる操作と引数は各スキルの `SKILL.md` と `references/commands.md`、CLIの `--help` にあります。既存のファイルを編集する場合は先に `inspect` でIDや文書位置を調べてください。CLIは外部ストレージとの同期、認証、ロック、PPTX／XLSX／DOCX変換を行いません。

リポジトリ内で使う場合は、最初に `npm ci` と `npm run build:library -- --module spreadsheet`（または `slide`、`document`、`board`、`diagram`、`calendar`、`whiteboard`、`aichat`、`chat`、`dataview`、`form`）を実行します。その後、対象パッケージのスキル内にあるCLIを呼び出します。

## 更新する

編集ロジックは各ライブラリの公開モデルAPI、保存の規則は専用のparse／serialize関数が正です。スキル用に別の行列移動や重なり順の処理を実装しません。

- `SKILL.md` とMarkdown参照は維持する説明です。長い型一覧はJSON Schemaを参照させます。
- JSON Schemaは `scripts/build-skill-schemas.mjs` で公開型から生成します。型で表現しない参照整合性や制約は、実際のパーサー・コマンドAPIでも検証します。
- 各CLIは `scripts/build-skill-scripts.mjs` と `scripts/skills/` の共通実装から生成します。スキル内の生成物だけを直接編集しません。

```bash
npm run build:skills
npm run check:skills
npm run test:scripts
```

`check:skills` は生成物の更新漏れを検出します。公開前チェックとパッケージ生成時にも実行します。パッケージの利用確認では、同梱されたCLIで作成・編集・検証し、スキルを別の場所にコピーした実行も確認します。失敗した操作が入力ファイルを書き換えないことも検証します。

配布物に含めるスキルのファイルは `scripts/lib/package-files.mjs` で限定しています。新しい参照やスクリプトを追加する場合は、生成・テスト・配布対象の変更を同じ更新に含めてください。
