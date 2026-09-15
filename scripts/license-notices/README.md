# 配布パッケージで欠けている通知の補完

`registry.json` は、インストール済みパッケージにLICENSE等の本文がない場合だけ使います。名前とバージョンが完全一致したものに限定し、依存を更新したら再確認します。標準のMIT文に作者名を推測して当てはめる処理は行いません。

## react-remove-scroll-bar 2.3.8

- npm配布の `package.json` とREADMEはMITと明記し、作者はAnton Korzunovです。
- npm配布対象の `files` にLICENSEが含まれず、実際のtarballにも本文がありません。
- 同じ作者の[upstream LICENSE](https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE)を変更せず保存しました。著作権表示と許諾文を両方含みます。
- 参照リビジョンは `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff`。そのリポジトリのmanifestは2.3.7です。2.3.8のタグとnpmが返すgitHeadは取得できなかったため、2.3.8のリリースコミット由来のファイルとは記載していません。2.3.8のMIT宣言を、同じupstreamの通知本文で補完する扱いです。

ビルド中にネットワークへアクセスして最新LICENSEを取得することはありません。上流のパッケージに通知が追加されれば、そちらが優先されます。
