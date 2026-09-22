# ライセンスと配布範囲

LikeX本体は[MITライセンス](../LICENSE)です。商用利用、改変、再配布ができます。著作権表示・許諾文を保持してください。第三者の依存は、それぞれのライセンスに従います。

## 利用者へ渡すもの

| 配布方法 | 保持するファイル |
| --- | --- |
| パッケージ | `LICENSE` と `THIRD_PARTY_NOTICES.md`。tarballに同梱されます |
| ソースコピー | 各モジュールの`src/`にある`LICENSE`と`THIRD_PARTY_NOTICES.md`。Coreも一緒にコピーします |
| デモサイト | ビルド先の`third-party-notices.txt`と`third-party-inventory.json`。LikeX・生成CSS・バンドルしたJSの通知を含みます |

パッケージとコピー版の第三者通知は同じ依存から生成します。コピー版の通知は生成CSSと同様にGit管理し、手編集せず `npm run build:library -- --all` で再生成します。生成CSSにはTailwindのMIT本文も保持します。

ライブラリのnpm依存はexternal importですが、利用先のビルドではJSへ組み込まれ得ます。最終アプリに追加した依存や、利用先で解決された別バージョンは、そのアプリ側でも確認してください。

LikeDocumentのProseMirror関連パッケージも実行時依存に含みます。モデル・状態・変換・コマンド・リスト・キーマップ・ビューと、その推移的依存のMIT通知は、Documentのパッケージ／ソースコピー通知とデモのライセンス一覧へ同じ収集処理で含めます。

LikeAIChatとLikeChatも独立した配布単位です。どちらもReact / React DOM、core、lucide-reactの通知を各パッケージ・ソースコピー・デモで確認します。AIサービスやチャット配送サービスのSDKは同梱せず、親アプリで追加する接続先の依存と利用条件は親アプリ側で扱います。

## 許可するライセンスと確認

配布ライブラリの実行時依存・peer依存・生成CSSの出典は、MIT、Apache-2.0、ISC、BSD系、0BSDなどの寛容なライセンスに限定します。許可リストは `scripts/lib/licenses.mjs` にあります。宣言が不明、未承認、または必要な通知本文がない場合は失敗させます。複合SPDX式も全ての構成ライセンスを確認し、許可していない選択肢がある場合は個別レビューが必要です。

```bash
# npm ci後: 本体ライセンス、現在解決されている実行時・推移的依存と通知を確認
npm run check:licenses

# ライブラリ・デモのビルド後: 実際の配布通知の本文まで確認
npm run check:licenses -- --artifacts
```

`check:release`とGitHub Actionsで両方を実行し、`artifacts/license-check.json`に結果を残します。LikeXのルート・各パッケージ・ソースコピーのLICENSEも一致させます。`private: true`はnpmへの誤公開防止であり、MITでの利用許可とは別の設定です。

## 開発・テスト用の依存

この制限の対象は配布物です。開発環境全体がMIT系だけという意味ではありません。

- CSSビルドの`lightningcss`と開発用の`axe-core`にはMPL-2.0が含まれます。
- Next.js互換性テストの`sharp`関連にはLGPL系のバイナリが含まれます。
- ブラウザ互換性データの`caniuse-lite`はCC-BY-4.0です。
- Excelテストファイル作成用のPythonツールは、npmパッケージへ同梱しません。

これらのツール本体をライブラリへ同梱しません。デモの実際のバンドル依存にも許可リストを適用します。利用側がNext.js等を採用する場合は、そのアプリ自身の依存として確認してください。

## 配布元で通知が欠けている場合

`react-remove-scroll-bar@2.3.8`はMITを宣言していますが、配布tarballにLICENSE本文がありません。同じupstreamの通知をリビジョン固定で保存し、名前・バージョンが完全一致した場合だけ補います。本文は改変しません。

取得元と確認根拠は [scripts/license-notices/README.md](../scripts/license-notices/README.md) に記録しています。更新先の版へ自動流用せず、未知の通知不足はビルドで検出します。ビルド中にネットワークから通知を取得する処理はありません。
