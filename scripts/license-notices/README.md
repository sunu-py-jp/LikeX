# 配布パッケージで欠けている通知の補完

`registry.json` は、インストール済みパッケージにLICENSE等の本文がない場合だけ使います。名前とバージョンが完全一致したものに限定し、依存を更新したら再確認します。標準のMIT文に作者名を推測して当てはめる処理は行いません。

## react-remove-scroll-bar 2.3.8

- npm配布の `package.json` とREADMEはMITと明記し、作者はAnton Korzunovです。
- npm配布対象の `files` にLICENSEが含まれず、実際のtarballにも本文がありません。
- 同じ作者の[upstream LICENSE](https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE)を変更せず保存しました。著作権表示と許諾文を両方含みます。
- 参照リビジョンは `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff`。そのリポジトリのmanifestは2.3.7です。2.3.8のタグとnpmが返すgitHeadは取得できなかったため、2.3.8のリリースコミット由来のファイルとは記載していません。2.3.8のMIT宣言を、同じupstreamの通知本文で補完する扱いです。

## @napi-rs/canvas のOS・CPU別パッケージ 1.0.10

- PlaygroundのPDF.jsが持つNode.js向け任意依存 `@napi-rs/canvas@1.0.10` は、下記11パッケージを同じ1.0.10に固定して参照します。親パッケージの[npm公式メタデータ](https://registry.npmjs.org/@napi-rs%2fcanvas/1.0.10)は、MITとリリースの `gitHead: 7d19abed029287e7c26b14eaa6e67d560a37d853` を示します。
- 全11パッケージのnpm公式1.0.10メタデータと、同コミットの各manifestで、名前・版・MIT宣言・`git+https://github.com/Brooooooklyn/canvas.git` への帰属が一致することを確認しました。親の[manifest](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/package.json)と同じリポジトリ内のプラットフォーム別バイナリです。
- インストール済みの `@napi-rs/canvas-darwin-arm64@1.0.10` にはLICENSE本文がありません。各プラットフォームの配布用manifestの `files` もネイティブバイナリ等だけを列挙し、LICENSEを含めていません。通知本文が既に同梱された環境では、既存の収集処理がその本文を優先します。
- 同リリースコミットの[upstream LICENSE](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/LICENSE)を `napi-rs-canvas-1.0.10.txt` に改変せず保存しました。`Copyright (c) 2020 lynweklm@gmail.com` とMIT許諾文を含み、親パッケージに同梱されたLICENSEとバイト単位で一致します。SHA-256は `8802fecf9da4367bc23bcf20b21cc143785fc6c92b152f3fa7fbe6ce08d344d6` です。
- フォールバックは下記の各名前と1.0.10版の完全一致だけに適用します。ライセンス検証から依存を除外せず、将来の版へも流用しません。この登録はパッケージが宣言するMIT通知の復元であり、バイナリ内部の第三者コードを別ライセンスへ変更するものではありません。

| 対象パッケージ（すべて1.0.10） | 固定コミットのmanifest |
| --- | --- |
| `@napi-rs/canvas-android-arm64` | [android-arm64](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/android-arm64/package.json) |
| `@napi-rs/canvas-darwin-arm64` | [darwin-arm64](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/darwin-arm64/package.json) |
| `@napi-rs/canvas-darwin-x64` | [darwin-x64](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/darwin-x64/package.json) |
| `@napi-rs/canvas-linux-arm-gnueabihf` | [linux-arm-gnueabihf](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/linux-arm-gnueabihf/package.json) |
| `@napi-rs/canvas-linux-arm64-gnu` | [linux-arm64-gnu](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/linux-arm64-gnu/package.json) |
| `@napi-rs/canvas-linux-arm64-musl` | [linux-arm64-musl](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/linux-arm64-musl/package.json) |
| `@napi-rs/canvas-linux-riscv64-gnu` | [linux-riscv64-gnu](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/linux-riscv64-gnu/package.json) |
| `@napi-rs/canvas-linux-x64-gnu` | [linux-x64-gnu](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/linux-x64-gnu/package.json) |
| `@napi-rs/canvas-linux-x64-musl` | [linux-x64-musl](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/linux-x64-musl/package.json) |
| `@napi-rs/canvas-win32-arm64-msvc` | [win32-arm64-msvc](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/win32-arm64-msvc/package.json) |
| `@napi-rs/canvas-win32-x64-msvc` | [win32-x64-msvc](https://github.com/Brooooooklyn/canvas/blob/7d19abed029287e7c26b14eaa6e67d560a37d853/npm/win32-x64-msvc/package.json) |

ビルド中にネットワークへアクセスして最新LICENSEを取得することはありません。上流のパッケージに通知が追加されれば、そちらが優先されます。
