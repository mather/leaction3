import { A, useParams } from "@solidjs/router";
import styles from "./Top.module.css";

// イベントページの本実装は MVP ステップ 3。作成完了画面からの遷移先として仮に置く。
export function EventPage() {
  const params = useParams<{ id: string }>();
  return (
    <main class={styles.page}>
      <A href="/" class={styles.logo}>
        LeacTion!
      </A>
      <section class={styles.card}>
        <h1 class={styles.cardTitle}>イベントページ（準備中）</h1>
        <p class={styles.muted}>イベント ID: {params.id}</p>
      </section>
    </main>
  );
}
