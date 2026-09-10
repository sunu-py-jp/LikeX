# ZIPの生成

`createZipArchive` は、Blobの一覧からZIP形式のBlobを生成します。ファイルの取得、ダウンロードの開始、ストレージへの保存は利用側が行います。

## API

```ts
type ZipArchiveContent = Blob | (() => MaybePromise<Blob>);

type ZipArchiveEntry = Readonly<{ path: string; updatedAt?: string }> & (
  | Readonly<{ directory: true; content?: never }>
  | Readonly<{ directory?: false; content: ZipArchiveContent }>
);

type ZipArchiveOptions = Readonly<{
  signal?: AbortSignal;
  type?: string;
}>;

function createZipArchive(
  entries: Iterable<ZipArchiveEntry> | AsyncIterable<ZipArchiveEntry>,
  options?: ZipArchiveOptions,
): Promise<Blob>;
```

| 項目 | 既定値 | 説明 |
| --- | --- | --- |
| `path` | 必須 | ZIP内の相対パス。階層は `/` で区切る |
| `content` | ファイルで必須 | Blob、またはBlobを返す関数 |
| `directory` | `false` | `true` ならフォルダ項目。`content` は指定不可 |
| `updatedAt` | 1980年1月1日 | ZIPに記録する更新日時の文字列 |
| `signal` | なし | 生成処理の中止 |
| `type` | `application/zip` | 返却するBlobのMIMEタイプ |

## ファイルとフォルダをまとめる

```ts
import { createZipArchive } from "@likex/core";

const zip = await createZipArchive([
  { path: "reports", directory: true },
  {
    path: "reports/summary.txt",
    content: new Blob(["売上報告"], { type: "text/plain;charset=utf-8" }),
    updatedAt: "2026-09-10T09:00:00+09:00",
  },
  {
    path: "reports/amounts.csv",
    content: new Blob(["month,amount\n9,12000\n"]),
  },
]);

console.log(zip.type); // application/zip
```

親フォルダはパスに含めるだけでも階層になります。空フォルダを明示的に入れる場合は `directory: true` の項目を追加します。

## 必要になった順に読み込む

```ts
import { createZipArchive } from "@likex/core";

const controller = new AbortController();
const zip = await createZipArchive([
  {
    path: "report.pdf",
    content: async () => {
      const response = await fetch("/api/files/report/content", {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("ファイルを取得できませんでした");
      return response.blob();
    },
  },
], { signal: controller.signal });

// 中止ボタンなどから controller.abort() を呼ぶ。
```

サンプルのAPIパスは親アプリが実装します。全パスを検証してからファイル本体を順番に読み込みます。`content` 関数に引数は渡されないので、中止できる通信には例のように同じsignalを渡します。外部の読み込み自体が中止に対応しない場合、その読み込みの完了までは待機します。

## 制約とエラー

圧縮しないSTORE方式のZIPです。ZIP64には対応していません。

| 項目 | 上限・扱い |
| --- | --- |
| 全体サイズ | 4 GiB未満。実際に扱える量は端末のメモリにも依存 |
| 項目数 | 65,534件まで |
| パス長 | UTF-8で65,535バイトまで |
| 無効または未指定の日時 | 1980年1月1日 |
| 1980年より前の日時 | 1980年1月1日 |
| 2107年より後の日時 | 2107年末 |
| 途中の失敗 | 全体がreject。部分的なZIPは返さない |

絶対パス、`.` / `..`、空のパス区間、バックスラッシュ、コロン、制御文字、不正なUnicode、末尾がドットまたは空白のパス区間、重複パス、ファイルと親フォルダの衝突を拒否します。大きなファイル群はメモリ使用量を確認し、必要なら利用側のサーバーでZIPを生成してください。
