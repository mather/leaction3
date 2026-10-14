import { A } from "@solidjs/router";
import type { JSX } from "solid-js";
import { CONTACT_FORM_URL } from "../lib/site";
import styles from "./LegalPage.module.css";

/** 利用規約・プライバシーポリシーの共通の枠。本文は見出し（h2）と段落・リストで書く */
export function LegalPage(props: { title: string; enactedAt: string; children: JSX.Element }) {
  return (
    <div class={styles.page}>
      <header class={styles.header}>
        <A href="/" class={styles.logo}>
          LeacTion!
        </A>
        <h1 class={styles.title}>{props.title}</h1>
        <p class={styles.date}>制定日: {props.enactedAt}</p>
      </header>

      <main class={styles.body}>{props.children}</main>

      <footer class={styles.footer}>
        <ul class={styles.footerLinks}>
          <li>
            <A href="/terms">利用規約</A>
          </li>
          <li>
            <A href="/privacy">プライバシーポリシー</A>
          </li>
          <li>
            <a href={CONTACT_FORM_URL} target="_blank" rel="noopener">
              お問い合わせ
            </a>
          </li>
        </ul>
      </footer>
    </div>
  );
}

/** 本文中の問い合わせフォームへのリンク */
export function ContactLink() {
  return (
    <a href={CONTACT_FORM_URL} target="_blank" rel="noopener">
      お問い合わせフォーム
    </a>
  );
}
