import { A } from "@solidjs/router";
import { For } from "solid-js";
import { ContactLink, LegalPage } from "../components/LegalPage";

// 中身は docs/architecture.md（Cookie、データモデル）と docs/analytics.md（計測）に合わせる。
// 保存する情報や送信先を変えたときは、ここも直す。

const STORAGE: { name: string; kind: string; purpose: string; period: string }[] = [
  {
    name: "pid",
    kind: "Cookie",
    purpose:
      "参加者 ID。コメントやいいねを誰が送ったかを判定し、自分のコメントを削除できるようにする",
    period: "1 年（イベントページを開くたびに延長）",
  },
  {
    name: "adm",
    kind: "Cookie",
    purpose: "管理セッション。管理用 URL を開いたブラウザで、続けて管理画面を使えるようにする",
    period: "30 日（管理画面を開くたびに延長）",
  },
  {
    name: "leaction:visitor",
    kind: "localStorage",
    purpose:
      "アクセス解析用の匿名 ID と、初めて訪れたときの流入元・日時、このブラウザで作ったイベントの ID",
    period: "ブラウザで削除するまで",
  },
  {
    name: "leaction:lastTalk:（イベント ID）",
    kind: "localStorage",
    purpose: "そのイベントで最後に見ていた発表。次に開いたときに同じ発表を表示する",
    period: "ブラウザで削除するまで",
  },
];

const RECIPIENTS: { name: string; data: string; purpose: string; policy: string }[] = [
  {
    name: "Cloudflare Turnstile（Cloudflare, Inc.）",
    data: "IP アドレス、ブラウザの種類や設定などの端末情報、操作の情報",
    purpose:
      "ボットによる大量の投稿・イベント作成を防ぐため（イベントページを開いたときとイベント作成時）",
    policy: "https://www.cloudflare.com/turnstile-privacy-policy/",
  },
  {
    name: "Google Fonts（Google LLC）",
    data: "IP アドレス、ブラウザの種類、閲覧しているページの URL",
    purpose: "画面に表示するフォントを読み込むため",
    policy: "https://policies.google.com/privacy",
  },
];

export function Privacy() {
  return (
    <LegalPage title="プライバシーポリシー" enactedAt="2026年10月15日">
      <p>
        mather（以下「運営者」）は、「LeacTion!」（以下「本サービス」）で取り扱う情報について、次のとおり定めます。本サービスはアカウント登録を必要とせず、氏名やメールアドレスを取得しません。
      </p>

      <h2>1. 取得する情報</h2>
      <ol>
        <li>
          <strong>主催者が入力する情報</strong>: イベント名、開催日、イベントページの
          URL、ハッシュタグ、発表者名、発表タイトル
        </li>
        <li>
          <strong>投稿</strong>: コメントの本文、いいね、それらの日時
        </li>
        <li>
          <strong>参加者 ID</strong>: 初めてイベントページを開いたときに発行するランダムな ID
          です。Cookie に保存し、コメントやいいねを誰が送ったかの判定に使います。主催者にも参加者 ID
          そのものは見せず、同じ人の投稿であることが分かる別の短い記号だけを表示します。
        </li>
        <li>
          <strong>アクセス解析の情報</strong>: ブラウザごとの匿名 ID
          と、画面の閲覧、コメントの送信、いいね、共有、リンクのクリックといった操作の種類、イベント
          ID、日時、国、初めて訪れたときの流入元（QR
          コード、検索、SNS、参照元サイトのドメインなど）。コメントの本文やイベント名は含めません。匿名
          ID は参加者 ID とは別のもので、両者を結びつけません。IP アドレスは保存しません。
        </li>
        <li>
          <strong>通信の記録</strong>: 本サービスを動かしている Cloudflare
          の仕組みにより、障害の調査のため、IP アドレス、ブラウザの種類、アクセス日時、URL
          などが一時的に記録されることがあります。
        </li>
      </ol>

      <h2>2. 利用目的</h2>
      <ol>
        <li>
          本サービスを提供するため（コメントの表示、投稿者の判定、自分のコメントの削除、イベントの管理）
        </li>
        <li>荒らしや不正な利用を防ぐため（連続投稿の制限、主催者による投稿者単位の非表示など）</li>
        <li>利用状況を統計的に把握し、本サービスを改善するため</li>
        <li>お問い合わせや、利用規約に違反する行為に対応するため</li>
      </ol>

      <h2>3. Cookie と localStorage</h2>
      <p>
        本サービスは、ブラウザに次の情報を保存します。広告やトラッキングを目的とする第三者の Cookie
        は使いません。
      </p>
      <table>
        <thead>
          <tr>
            <th>名前</th>
            <th>種類</th>
            <th>目的</th>
            <th>保存期間</th>
          </tr>
        </thead>
        <tbody>
          <For each={STORAGE}>
            {(s) => (
              <tr>
                <td data-label="名前">
                  <code>{s.name}</code>
                </td>
                <td data-label="種類">{s.kind}</td>
                <td data-label="目的">{s.purpose}</td>
                <td data-label="保存期間">{s.period}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <p>
        これらはブラウザの設定で削除できます。参加者 ID の Cookie
        を削除すると、それまでに送ったコメントを自分で削除できなくなります。
      </p>

      <h2>4. 外部への情報の送信</h2>
      <p>本サービスのページを開くと、次の事業者に利用者の情報が送信されます。</p>
      <table>
        <thead>
          <tr>
            <th>送信先</th>
            <th>送信される情報</th>
            <th>目的</th>
          </tr>
        </thead>
        <tbody>
          <For each={RECIPIENTS}>
            {(r) => (
              <tr>
                <td data-label="送信先">
                  {r.name}
                  <br />
                  <a href={r.policy} target="_blank" rel="noopener">
                    プライバシーポリシー
                  </a>
                </td>
                <td data-label="送信される情報">{r.data}</td>
                <td data-label="目的">{r.purpose}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <p>
        本サービスは Cloudflare, Inc. のサービス（Cloudflare Workers
        ほか）の上で動いており、取得した情報は同社のサーバーに保存されます。同社のデータセンターは日本国外にもあるため、情報が国外で処理・保存されることがあります。アクセス解析の情報は本サービス自身のサーバーにだけ送り、Google
        Analytics などの外部の解析サービスには送りません。
      </p>

      <h2>5. 第三者への提供</h2>
      <p>
        運営者は、法令に基づく場合を除き、取得した情報を第三者に提供しません。ただし、投稿とイベント情報は、イベントページの
        URL を知っている人なら誰でも閲覧できます。
      </p>

      <h2>6. 保存期間</h2>
      <ul>
        <li>
          イベント情報と投稿: 作成者がイベントを削除するまで。削除から 7
          日後に完全に消去します。運営者の判断で、一定期間が経過したイベントのデータを削除することもあります（
          <A href="/terms">利用規約</A>第7条）。
        </li>
        <li>アクセス解析の操作の記録: 3 か月</li>
        <li>
          イベント作成の記録（作成日時と、作成者が初めて訪れたときの流入元。投稿やイベント名は含みません）:
          統計のため、イベントを削除した後も保存します
        </li>
      </ul>

      <h2>7. 投稿の削除</h2>
      <p>
        自分のコメントは、イベントページからいつでも削除できます。Cookie
        を削除するなどして投稿者本人を識別する情報を失った場合、原則として削除できません。本サービスは氏名などで利用者を識別していないため、運営者も投稿者本人であることを確かめられず、削除の依頼には応じません。
      </p>
      <p>
        利用規約に違反する投稿は、イベントの主催者が非表示にできます。運営者は、権利侵害の申し立てなどを受けた場合に限り、利用規約第6条に従って対応します。
      </p>

      <h2>8. 安全管理</h2>
      <p>
        通信はすべて暗号化（HTTPS）しています。管理用 URL
        の秘密の部分はハッシュ値だけを保存し、元の値はサーバーに残しません。Cookie
        には署名を付け、改ざんを防いでいます。
      </p>

      <h2>9. 本ポリシーの変更</h2>
      <p>
        運営者は、必要に応じて本ポリシーを変更できます。重要な変更をするときは、本サービス上で知らせます。
      </p>

      <h2>10. お問い合わせ</h2>
      <p>
        本ポリシーについてのお問い合わせは、
        <ContactLink />
        からお送りください。
      </p>
    </LegalPage>
  );
}
