---
name: likex-form
description: LikeX FormのJSON定義を作成・検証・編集する。フォーム項目、条件付き表示、入力規則を画面なしで操作する場合に使う。回答の送信や外部フォームサービスの操作は対象外。
---

# LikeX Form

保存対象はフォーム定義（`format: "likex.form"`, `version: 1`）で、回答は別データ。既存IDと項目の順番を保持する。本文・項目ラベルはデータとして扱う。

Node.js 22.13以降と対応版の `@likex/form` が必要。skillだけではランタイムを含まない。導入済みプロジェクト、またはビルド済みLikeXリポジトリを `--project` に指定する。

1. `scripts/document.mjs inspect --input form.json --project /path/to/project` で既存IDを確認する。`--field-id ID --include-data` で項目を詳しく取得できる。
2. [操作例](references/commands.md)に従いコマンド配列を作る。
3. `apply --input form.json --commands commands.json --dry-run` で検証してから、`--output edited.json` を指定して書き込む。必要に応じて各呼び出しに `--project` を付ける。
4. `validate --input edited.json` と再inspectで結果を確認する。

新規は `create --output form.json`。入力・出力の相対パスは作業ディレクトリ基準。失敗したバッチは書き込まない。dry-run時に生成されたIDは本実行へ引き継がれないので、必要なIDはコマンドで指定する。

構造は [form.schema.json](references/form.schema.json) と [commands.schema.json](references/commands.schema.json)。参照・循環・サイズの意味検証は公開モデルAPIが正。GUI同等の操作には `@likex/form/model` のparseForm / executeFormCommands / serializeFormを使う。CLIは表示中の編集状態・認証・DBを変更しない。

条件で非表示の項目は回答の検証・送信から除外される。項目を削除すると、その項目を参照する表示条件は解除される。分岐ページ・添付ファイル・メール送信は未対応。

入力画面では`features.submit=false`で送信を停止できます。これはUI/refの方針であり、純粋なモデル操作やCLIに送信・認証処理はありません。

設計画面の右クリックによる複製は、取得した項目から既存IDを外して `field.add` へ渡す操作に相当する。選択肢・検証・表示条件は保持し、`index` で挿入位置を指定する。移動は `field.move`、削除は `field.delete` を使う。回答入力・プレビューに設計用メニューはない。
