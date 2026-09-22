# 回答と送信

```tsx
<LikeForm
  initialForm={form}
  mode="fill"
  initialAnswers={{ name: "山田" }}
  onAnswersChange={answers => console.log(answers)}
  onSubmit={async (values, { form, signal, requestId }) => {
    const response = await fetch("/api/responses", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId: form.id, values, requestId }),
    });
    if (!response.ok) throw new Error("回答を送信できませんでした。");
  }}
  onSubmitComplete={values => console.log("送信完了", values)}
/>
```

`FormAnswers`は `Record<string, string | number | boolean | null>` です。キーには項目IDを使います。未入力の数値はnull、文字列は空文字、チェックはfalseです。defaultValueがあれば初期値に使われます。

送信前に検証し、エラーを各項目の下に表示します。送信中は入力と再送信を抑止し、Promiseの完了まで待ちます。throwはエラーメッセージになります。アンマウント・モード変更・読み取り専用への変更・定義変更・ref.cancelPendingでsignalが中止され、古い完了結果は表示しません。

## 条件付き表示

```ts
{ id: "details", type: "textarea", label: "相談内容", required: true,
  visibleWhen: { fieldId: "consult", operator: "equals", value: true } }
```

operatorは `equals`、`notEquals`、`contains`、`notEmpty`。参照する項目自体が非表示なら、この項目も非表示です。非表示項目は必須検証と送信値から除外されます。入力中の回答は保持するため、条件が戻れば再表示されます。循環参照は拒否します。

## 画面なしで検証

```ts
import { validateFormAnswers } from "@likex/form/model";
const result = validateFormAnswers(form, { name: "山田" });
// { valid: boolean, errors: { fieldId: string; message: string }[], values: FormAnswers }
```

結果のvaluesには表示対象の項目のみを含みます。未知の項目ID・NaN等の構造不正はthrow、必須・範囲・選択肢等の入力エラーはerrorsで返します。ブラウザの検証だけを信用せず、サーバーでも同じ定義で検証してください。

`features={{ submit: false }}`は入力モードの送信ボタンを非表示にし、refの`submit()`も拒否します。回答入力と検証は引き続き使えます。送信中に無効化・読み取り専用化・モード変更・アンマウントがあるとsignalを中断し、古い完了通知を反映しません。`onAnswersChange`は通知なので、例外を投げても受理した回答は保持します。
