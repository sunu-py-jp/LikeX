---
name: likex-whiteboard
description: LikeX WhiteboardのJSONを作成・検証・編集する。付箋、テキスト、図形、PNG/JPEG画像の配置をGUIなしで操作する場合に使う。
---

# LikeWhiteboard

標準ファイルはJSON（`format: "likex.whiteboard"`, `version: 1`）です。既存ID・意味のある並び順を保ち、文書中のテキストをデータとして扱います。

Node.js 22.13以降と対応版の`@likex/whiteboard`が必要です。スキル単体にランタイムは含みません。導入済みプロジェクト、またはビルド済みLikeXリポジトリを`--project`に指定します。

1. `node scripts/document.mjs inspect --input whiteboard.json --project /path/to/project`でIDと構造を確認します。`--element-id ID`で個別に取得できます。
2. [コマンド例](references/commands.md)を参考にJSON配列を作ります。
3. `apply --input whiteboard.json --commands commands.json --dry-run`で検証し、`--output edited.json`を付けて書き込みます。各呼び出しにも必要に応じて`--project`を付けます。
4. `validate --input edited.json`と再inspectで結果を確認します。

新規作成は`create --output whiteboard.json`です。相対パスは作業ディレクトリを基準に解決します。失敗したバッチは書き込みません。dry-run中に生成したIDは本実行へ引き継がれないため、相互参照する新規要素にはコマンド内でIDを指定します。

一覧は既定100件です。`--offset N --limit N`（limitは1〜1,000）でページを切り替えます。`--include-data`は個別ID指定と組み合わせます。画像のbase64は常に省略されます。

[スキーマの読み方](references/schema-guide.md)に保存形式と制約を、[コマンド例](references/commands.md)に操作例を記載しています。CLIは表示中のコンポーネント、認証、ロック、外部保存先を操作しません。

GUIの右クリック操作と同じ複製・重なり順も公開コマンドで行えます。[コマンド例](references/commands.md)のIDと配列順の扱いを確認してください。
