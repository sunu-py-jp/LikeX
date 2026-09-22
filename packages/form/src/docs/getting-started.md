# LikeFormの導入

フォームの定義を編集する画面と、回答を入力する画面を提供します。定義と回答は別データで、保存先・認証・通知メール・回答集計は利用側が担当します。

```tsx
import { LikeForm, createForm } from "@likex/form";
import "@likex/form/styles.css";
const form = createForm({ title: "お問い合わせ", fields: [
  { id: "name", type: "text", label: "お名前", required: true },
  { id: "body", type: "textarea", label: "お問い合わせ内容", maxLength: 2000 },
] });
<LikeForm initialForm={form} onSave={async definition => {
  await saveDefinition(definition);
}} style={{ height: 700 }} />;
```

React 19.2以降、React DOM、lucide-reactとcoreを使用します。LikeXは公開前のworkspaceです。導入はビルドしたtarball、またはソースコピーを使ってください。Tailwindの導入は不要です。

## ソースコピー

`packages/form/src` と `packages/core/src` を `components/likex/form` と `components/likex/core` にコピーします。form内の `core.ts` を `export * from "../core";` に、`json.ts` を `export * from "../core/json";`、`browser.ts` を `export * from "../core/browser";` に変更します。UIはformの入口、画面なしの操作は `form/model-entry`、CSSは `form/styles.css` から読み込みます。LICENSEとTHIRD_PARTY_NOTICES.mdも保持します。

## Props

| プロパティ | 内容 |
| --- | --- |
| `initialForm: FormModel` | マウント時のフォーム定義。後から差し替えるときはrefのreplace、またはkeyを変更 |
| `mode?: "design" \| "fill"` | 初期値design。fillでは定義を変更せず、回答を入力 |
| `initialAnswers?: FormAnswers` | 回答の初期値。キーは項目ID |
| `onSave`, `onBeforeSave`, `onEditRequest` | 定義の保存・保存前検証・編集許可 |
| `onSubmit`, `onAnswersChange`, `onSubmitComplete` | 回答の送信・入力変更・送信完了 |
| `onChange`, `onDirtyChange`, `onEvent` | 定義の変更と処理通知 |
| `readOnly?: boolean` | 定義と回答の入力を禁止 |
| `features?: FormFeatures` | 既定は全てON。falseの機能の操作UIを非表示 |
| `title`, `primaryColor`, `colorMode` | アプリ名・主色（#RGB / #RRGGBB）・light/dark/system |
| `style`, `className`, `ref` | サイズ・外側クラス・操作API |

`onSave`未指定では定義の編集は読み取り専用です。`mode="fill"` の回答はonSaveを必要とせず、`onSubmit`が送信を担当します。

`features`のキーは `fields`（項目の追加・変更・削除）、`reorder`、`settings`（フォーム見出し）、`import`、`export`、`history`、`preview`、`submit`（入力モードの送信）。GUIとrefの書き込みは同じ制御を通ります。純粋なモデルAPIでは認証・機能制御を呼び出し側で行います。

## 対応範囲

記述式・長文・数値・日付・プルダウン・単一選択・チェック、必須・文字数・数値範囲・条件付き表示、並べ替え、JSON入出力、Undo/Redoに対応します。分岐ページ・ファイル添付・メール送信・サーバーでの回答保存は内蔵しません。

`primaryColor`に合わせてヘッダー・送信ボタンの文字色を自動調整します。`colorMode="system"`はOSの配色変更に追従します。従来の`theme`（light/dark）も別名として受け付けますが、`colorMode`を優先します。

## 右クリックメニュー

設計画面の項目から設定、複製、直後への記述式項目の追加、上下移動、削除を開けます。用紙の余白からは7種類の項目追加とUndo/Redoを選べます。複製は新しい項目IDを作り、型・選択肢・検証・表示条件を保ちます。

項目の追加・複製・削除には `features.fields`、移動にはさらに `features.reorder` が必要です。無効な機能の項目は表示せず、閲覧専用・処理中の書き込みは無効にします。定義変更は公開コマンドと同じ編集許可・履歴を通ります。定義・権限が変わると古いメニューを閉じます。回答入力・プレビューでは設計用メニューを表示せず、入力欄と選択中テキストの標準メニューも維持します。
