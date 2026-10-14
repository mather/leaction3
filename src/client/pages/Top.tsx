import { A } from "@solidjs/router";
import { For } from "solid-js";
import button from "../components/button.module.css";
import { Icon, type IconName } from "../components/Icon";
import { track, trackView } from "../lib/analytics";
import styles from "./Top.module.css";

const REPOSITORY_URL = "https://github.com/mather/leaction3";

// JSX のテキストを改行すると半角スペースが入るので、文字列で持つ
const LEAD =
  "LT や勉強会の発表に、参加者がリアルタイムでコメントと「いいね」を送れるサービスです。参加者はログインなしで、URL を開くだけで使えます。";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "check",
    title: "参加者はログイン不要",
    body: "URL か QR コードを開けば、すぐにコメントできます。アプリのインストールもいりません。",
  },
  {
    icon: "heart",
    title: "発表ごとにコメントと「いいね」",
    body: "発表を切り替えながら、その場の感想を送れます。気に入ったコメントには「いいね」を。",
  },
  {
    icon: "link",
    title: "主催者も URL だけで管理",
    body: "作成時に届く管理用 URL を開くだけで、発表枠の編集やコメントの非表示ができます。",
  },
];

const STEPS: { title: string; body: string }[] = [
  {
    title: "イベントを作る",
    body: "イベント名・開催日・発表枠を入れるだけ。作成者用の管理 URL は大切に保存してください。",
  },
  {
    title: "URL か QR コードを共有する",
    body: "スライドや会場の画面、SNS で参加者用の URL を知らせます。",
  },
  {
    title: "当日はコメントを楽しむ",
    body: "発表中に届くコメントがリアルタイムに流れます。",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "料金はかかりますか？",
    a: "無料です。主催者・参加者ともにアカウント登録も必要ありません。",
  },
  {
    q: "管理用 URL をなくしてしまいました",
    a: "管理用 URL は再発行できません。共同管理者 URL を発行していれば、そちらで管理を続けられます。作成直後に、ブックマークや自分宛てのメールで保存しておいてください。",
  },
];

function CreateButton(props: { target: "top_create_hero" | "top_create_bottom" }) {
  return (
    <A
      href="/new"
      class={`${button.primary} ${button.block}`}
      onClick={() => track({ name: "click", page: "top", eventId: "", target: props.target })}
    >
      イベントを作る
    </A>
  );
}

export function Top() {
  trackView("top");
  return (
    <div class={styles.page}>
      <header class={styles.hero}>
        <p class={styles.logo}>LeacTion!</p>
        <h1 class={styles.catch}>発表に、その場でひとこと。</h1>
        <p class={styles.lead}>{LEAD}</p>
        <CreateButton target="top_create_hero" />
        <p class={styles.note}>無料・アカウント登録なしで作れます</p>
      </header>

      <main>
        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>できること</h2>
          <ul class={styles.features}>
            <For each={FEATURES}>
              {(f) => (
                <li class={styles.card}>
                  <span class={styles.featureIcon}>
                    <Icon name={f.icon} size={22} />
                  </span>
                  <div>
                    <h3 class={styles.cardTitle}>{f.title}</h3>
                    <p class={styles.cardBody}>{f.body}</p>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>使い方</h2>
          <ol class={styles.steps}>
            <For each={STEPS}>
              {(s, i) => (
                <li class={styles.step}>
                  <span class={styles.stepNumber} aria-hidden="true">
                    {i() + 1}
                  </span>
                  <div>
                    <h3 class={styles.cardTitle}>{s.title}</h3>
                    <p class={styles.cardBody}>{s.body}</p>
                  </div>
                </li>
              )}
            </For>
          </ol>
        </section>

        <section class={styles.section}>
          <h2 class={styles.sectionTitle}>よくある質問</h2>
          <div class={styles.faq}>
            <For each={FAQ}>
              {(item) => (
                <details class={styles.faqItem}>
                  <summary class={styles.faqQuestion}>
                    {item.q}
                    <span class={styles.faqChevron}>
                      <Icon name="chevron" size={18} />
                    </span>
                  </summary>
                  <p class={styles.faqAnswer}>{item.a}</p>
                </details>
              )}
            </For>
          </div>
        </section>

        <section class={styles.section}>
          <CreateButton target="top_create_bottom" />
        </section>
      </main>

      <footer class={styles.footer}>
        <ul class={styles.footerLinks}>
          {/* 文面が決まるまで準備中（docs/requirements.md の未決事項） */}
          <li>利用規約（準備中）</li>
          <li>プライバシー（準備中）</li>
          <li>
            <a href={REPOSITORY_URL} target="_blank" rel="noopener">
              GitHub
            </a>
          </li>
        </ul>
        <p class={styles.copyright}>LeacTion!</p>
      </footer>
    </div>
  );
}
