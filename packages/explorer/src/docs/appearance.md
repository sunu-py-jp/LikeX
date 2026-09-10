# アイコン・配色・レイアウトのカスタマイズ

[ドキュメント一覧](./README.md)

アイコンの差し替え、サイズ調整、テーマと動的なダークモードの具体例です。

## ファイルとフォルダのアイコンを差し替える

標準アイコンは細い輪郭と、紙の内側に置いた小さな大文字の拡張子で表示します。塗りつぶしの帯は使わず、次の色を落ち着いた配色で使います。紙の面はライトで白、ダークで暗色になり、文字色も切り替わります。これは名前から選ぶ表示であり、ファイル本体の形式検証や、Office文書の内蔵プレビュー対応を意味しません。

| 対象 | 標準アイコン |
| --- | --- |
| Excel（`xls`・`xlsx`・`xlsm`・`xlsb`・`xlt`・`xltx`・`xltm`・`xla`・`xlam`） | 緑 |
| PDF（`pdf`） | 赤 |
| Word（`doc`・`docx`・`docm`・`dot`・`dotx`・`dotm`） | 青 |
| PowerPoint（`ppt`・`pptx`・`pptm`・`pot`・`potx`・`potm`・`pps`・`ppsx`・`ppsm`） | 橙 |
| フォント（`ttf`・`otf`・`woff`・`woff2`・`ttc`・`eot`） | 灰青色の拡張子のみ |
| `json`・`csv`・`tsv`・`xml`・`yaml`・`yml` | 紫 |
| テキスト（`txt`・`md`） | 従来の中立色で拡張子を表示 |
| 圧縮ファイル（`zip`・`7z`・`rar`・`tar`・`gz`・`tgz`・`bz2`・`xz`・`zst`・`lzh`） | 茶系 |
| その他のファイル | 中立色の輪郭 |
| フォルダ | 黄色 |

画像のサムネイルや、対応形式に応じた内蔵プレビューは引き続き利用できます。

`renderIcon?: ExplorerIconRenderer` で、ファイルやフォルダのアイコンを外側から指定できます。Explorerは親から渡された関数を呼び、戻り値をアイコンの位置に描画します。

```ts
type ExplorerIconRenderer = (
  context: ExplorerIconContext,
) => Exclude<ReactNode, Promise<unknown>>;
```

`ExplorerIconRenderer`、`ExplorerIconContext`、`ExplorerIconLocation` は公開入口からimportできます。戻り値は同期のReact描画要素で、Promiseは返せません。

| `context` の項目 | 内容 |
| --- | --- |
| `entry` | 読み取り専用の `ExplorerItemInfo`。正規化された `extension` を含むエントリーの全フィールドと、最新の下書き上の `path` を渡します。ファイルとフォルダの両方を含みます。 |
| `location` | 描画箇所。`"list"` / `"tree"` / `"tab"` / `"destination"` / `"details"` / `"preview"`。 |
| `view` | 現在の `ExplorerViewMode`。一覧の8種類の表示形式を区別できます。 |
| `selected` | その描画箇所の選択状態。 |
| `expanded` | フォルダツリーで展開中かどうか。ファイルの場合は `false`。 |
| `defaultIcon` | Explorerの既定のアイコンまたはサムネイルを表す `ReactElement`。そのまま返すことも、バッジ等と組み合わせることもできます。 |

| `location` | 差し替える箇所 |
| --- | --- |
| `list` | 一覧のファイル・フォルダ。全8表示形式に対応します。 |
| `tree` | フォルダツリーの実フォルダ。 |
| `tab` | 実フォルダを表示しているタブ。 |
| `destination` | 移動先・コピー先の実フォルダ。 |
| `details` | 詳細表示のファイル・フォルダ。 |
| `preview` | 内蔵プレビューのファイルアイコン。 |

ルート・お気に入り・最近の一覧といった仮想場所、操作ボタンのアイコン、空状態のイラストは対象外です。

| 戻り値 | 表示 |
| --- | --- |
| 独自のSVG・画像・React要素 | 既定アイコンや画像サムネイルより優先して表示します。 |
| `null` / `undefined` | 既定表示に戻します。サムネイルが有効な箇所ではサムネイルも使います。 |
| `defaultIcon` | 既定表示をそのまま使います。ほかの要素と組み合わせても構いません。 |
| `false` | アイコンの枠を維持し、内容を描画しません。 |

独自アイコンを返し、`defaultIcon` を含めない場合は、その箇所の既定サムネイル用の本体読込を行いません。`null`・`undefined`・`defaultIcon` に戻すと、既定のサムネイル設定も適用します。

### ID・フォルダ・拡張子で使い分ける

次の例は、特定ID、フォルダ、PDFの順に判定し、それ以外は既定表示に戻します。特定IDの `brand-logo` は利用先の項目IDに置き換えてください。SVGの色も親で指定しています。

```tsx
"use client";

import { FileText, Folder, FolderOpen } from "lucide-react";
import Explorer, {
  type ExplorerIconRenderer,
  type ExplorerProps,
} from "@/components/explorer";

const renderFileIcon: ExplorerIconRenderer = ({ entry, selected, expanded }) => {
  if (entry.id === "brand-logo") {
    return (
      <svg width="100%" height="100%" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#2563eb" />
        <path d="M7 12h10M12 7v10" stroke="white" strokeWidth="2" />
      </svg>
    );
  }

  if (entry.kind === "folder") {
    const Icon = expanded ? FolderOpen : Folder;
    return (
      <Icon
        width="100%"
        height="100%"
        color={selected ? "#b45309" : "#d97706"}
        fill="#fef3c7"
        strokeWidth={1.6}
      />
    );
  }

  if (entry.extension === "pdf") {
    return <FileText width="100%" height="100%" color="#b91c1c" />;
  }

  return null;
};

type Props = Omit<ExplorerProps, "renderIcon">;

export default function ExplorerWithIcons(props: Props) {
  return (
    <div style={{ height: 640, minWidth: 0 }}>
      <Explorer {...props} renderIcon={renderFileIcon} />
    </div>
  );
}
```

### 既定アイコンにバッジを重ねる

以下は一覧のお気に入り項目に印を重ねる例です。`defaultIcon` を含めるため、画像サムネイルも維持します。`renderIcon={renderIconWithBadge}` のように渡します。

```tsx
import type { ExplorerIconRenderer } from "@/components/explorer";

const renderIconWithBadge: ExplorerIconRenderer = ({
  entry,
  location,
  defaultIcon,
}) => {
  if (location !== "list" || !entry.favorite) return defaultIcon;

  return (
    <span style={{ position: "relative", display: "inline-flex", width: "100%", height: "100%" }}>
      {defaultIcon}
      <span
        aria-hidden="true"
        style={{
          position: "absolute", right: 0, bottom: 0,
          width: "35%", height: "35%", borderRadius: "50%",
          background: "#f59e0b", border: "1px solid white",
        }}
      />
    </span>
  );
};
```

アイコンの枠のサイズと配置はExplorerが決めます。返すSVGや画像には `width="100%"`・`height="100%"`、または同等のstyleを指定すると、その枠へ収まります。画像では `objectFit: "contain"` も指定できます。例えば利用先に `public/icons/project.svg` を用意した場合は、`<img src="/icons/project.svg" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />` を返せます。画像URLとアセットは利用先が管理し、Next.jsの画像最適化は必須ではありません。

`renderIcon` はReactの描画中に呼ばれる純粋な関数として実装します。関数内で状態更新・通知・通信を始めず、操作の通知には `onEvent` を使います。hooksや非同期データが必要なら、`return <CustomIcon entry={entry} />` のようにコンポーネントを返し、そのコンポーネント内でhooksを使ってください。描画関数の呼出回数を操作回数として扱わないようにします。

## サイズとスタイルの前提

外枠は `className` / `style`、配色とフォントは `colorMode` / `theme` で調整できます。複数配置する場合は `aria-label` で領域名を付けられます。

Explorer専用の `lxe:` クラスと生成済みCSSを使い、`--explorer-*` のテーマ変数をインスタンスとそのPortalに適用します。基礎スタイルもExplorerの範囲に限定します。通常のDOMに描画するため、ホストの高い詳細度や `!important` を持つCSSから完全に隔離する構成ではありません。外枠の確実なサイズ・余白・角丸の指定には `style` を使ってください。`className` には利用先で定義したクラスも指定できますが、Tailwindクラスを生成する機能は含みません。

## 配色とダークモード

`Explorer` と `ExplorerPopup` は共通の配色APIを使います。公開入口 `@/components/explorer` から、次の型と既定配色をimportできます。

```ts
type ExplorerColorMode = "light" | "dark" | "system";
type ExplorerThemeOverrides = Partial<Omit<ExplorerTheme, "colorScheme">> & {
  baseColor?: string;
};
type ExplorerThemeOptions = Partial<ExplorerTheme> & {
  baseColor?: string;
  light?: ExplorerThemeOverrides;
  dark?: ExplorerThemeOverrides;
};
```

| 指定 | 動作 |
| --- | --- |
| `colorMode="light"` | ライト配色を使います。 |
| `colorMode="dark"` | ダーク配色を使います。暗い背景に対応した文字色等も切り替えます。 |
| `colorMode="system"` | 表示先文書の `defaultView.matchMedia("(prefers-color-scheme: dark)")` を使い、設定変更にも追従します。SSRではライトで描画し、ハイドレーション後に設定を反映します。API非対応時もライトです。 |
| `colorMode` を省略 | 既存の `theme.colorScheme` があればその指定を使い、それもなければライトです。 |
| `colorMode` と `theme.colorScheme` の両方を指定 | `colorMode` を優先します。新しい切替には `colorMode` を使ってください。 |

`lightExplorerTheme` と `darkExplorerTheme` は各モードの既定トークンです。`defaultExplorerTheme` は従来どおりライト配色を表します。既存の `theme={{ accent: "#2563eb", selection: "#eff6ff" }}` や、`Partial<ExplorerTheme>` 型のオブジェクトも引き続き渡せます。

### ベースカラーと個別の上書き

`theme.baseColor` にCSSの色を指定すると、その色を `background` とし、`panel`・`border`・`hover` をベースカラーと文字色の `color-mix()`、`selection` をベースカラーとアクセント色の `color-mix()` で生成します。`foreground` 等の文字色は選択したモードの既定値を使い、ベースカラーだけからライト・ダークを自動判定することはありません。

共通の `theme.baseColor` は両モードに適用されます。明暗を切り替える場合は、`theme.light.baseColor` / `theme.dark.baseColor` を分けて指定すると、各モードに合わせた背景色を使えます。

```tsx
<Explorer
  initialEntries={savedEntries}
  onSave={save}
  colorMode="system"
  theme={{
    accent: "#2563eb",
    light: { baseColor: "#f7f9fc" },
    dark: { baseColor: "#182130", accent: "#7fb6ff" },
  }}
/>
```

個別トークンは `background`、`panel`、`foreground`、`muted`、`border`、`accent`、`accentForeground`、`selection`、`hover`、`danger`、`dangerForeground`、`folder`、`fontFamily` です。共通の `theme` に置けば両モードに適用し、`theme.light` / `theme.dark` に置けば選択中のモードだけを上書きします。`dangerForeground` は削除等の危険な操作ボタンの文字色で、既存のテーマ型との互換性のため省略可能です。既定配色には各モードの値を用意しています。

個別トークンの優先順位は、選択中のモード別指定、共通指定、ベースカラーからの自動生成、モードの既定値の順です。例えば、共通に `panel: "#334155"` がある場合、`dark.baseColor` を指定してもパネルは `#334155` のままです。変更するには `dark.panel` を指定するか、共通の `panel` を外します。外枠の `style` が優先する既存の契約も変わらず、`--explorer-*` 変数での上書きも可能です。

`baseColor` にはCSSの色を指定できますが、`var(--host-color)` のような参照は、その変数が表示先のDOMでも定義されている必要があります。親アプリの入れ子の要素だけに定義した変数は、Portalや別ウィンドウから参照できません。上の例のような色の値を直接渡すと、表示先をまたいで同じ指定を使えます。

### 親に切替ボタンを置く

モード切替UIと設定の保存は親が実装します。次の例では型付きのモード値をstateに保持し、クリックで切り替えます。`ExplorerPopup` にも同じ `colorMode` / `theme` を渡せます。

```tsx
"use client";

import { useState } from "react";
import Explorer, {
  type ExplorerProps,
  type ExplorerColorMode,
  type ExplorerThemeOptions,
} from "@/components/explorer";

const theme = {
  light: { baseColor: "#f7f9fc", accent: "#2563eb" },
  dark: { baseColor: "#182130", accent: "#7fb6ff" },
} satisfies ExplorerThemeOptions;

type Props = Pick<ExplorerProps, "initialEntries" | "onSave" | "readFile">;

export default function ThemedFiles(props: Props) {
  const [colorMode, setColorMode] = useState<ExplorerColorMode>("system");

  return (
    <>
      <div role="group" aria-label="ファイル画面の配色">
        <button type="button" aria-pressed={colorMode === "light"} onClick={() => setColorMode("light")}>
          ライト
        </button>
        <button type="button" aria-pressed={colorMode === "dark"} onClick={() => setColorMode("dark")}>
          ダーク
        </button>
        <button type="button" aria-pressed={colorMode === "system"} onClick={() => setColorMode("system")}>
          システム
        </button>
      </div>
      <div style={{ height: 640, minWidth: 0 }}>
        <Explorer {...props} colorMode={colorMode} theme={theme} />
      </div>
    </>
  );
}
```

`colorMode` / `theme` はマウント後の変更にも反映し、タブ・選択・下書き等を保持します。テーマのためにReactの `key` を変える必要はありません。メニュー・ダイアログ・ツールチップ等のPortal、切り離した子ウィンドウ、`ExplorerPopup` の表示にも反映します。配色はExplorerのインスタンス内に限定し、親アプリのテーマ切替や設定の永続化は行いません。親が描画する外部プレビューやPDFの文書本体は、Explorerのテーマ管理対象外です。
