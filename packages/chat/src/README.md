# LikeChat ソース導入

`packages/chat/src`と`packages/core/src`を一緒にコピーし、同梱の配布スクリプトで`core.ts` / `json.ts`の参照を解決してください。React UIは`index.ts`、画面なしの操作は`model-entry.ts`から公開します。CSSは`styles.css`を読み込みます。Tailwindやサーバーライブラリは不要です。

人同士のDM・グループ・スペース、スレッド、リアクション、添付メタデータ、既読位置をJSONで保存します。`currentUserId`で操作する参加者を指定し、編集には`onSave`を渡します。メッセージの配送には任意の`onSend`、ファイルのアップロードには`onAttachmentUpload`を渡します。

ネイティブ形式は`likex.chat` version 2です。旧AI会話は`LikeAIChat` / `@likex/aichat`へ移動しており、このモデルとは互換ではありません。旧version 1はAIChatの`parseAIChat`で読み込みます。

同期・認証・配送・永続化は利用側が担当します。モデルAPIは純粋なデータ操作で、ユーザー認証を行いません。セッションはメッセージ作者と現在の参加者、機能フラグ、読み取り専用、編集許可、履歴、保存を共通経路で制御します。詳細は[利用ガイド](docs/README.md)を参照してください。
