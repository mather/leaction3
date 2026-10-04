import { For, Match, Switch } from "solid-js";
import { linkify } from "../lib/linkify";

/**
 * コメント本文。プレーンテキストとして表示し（innerHTML は使わない）、URL だけをリンクにする。
 * リンクはすぐには開かず、onOpenUrl で確認を出してから開く。
 */
export function CommentBody(props: { body: string; onOpenUrl: (url: string) => void }) {
  return (
    <For each={linkify(props.body)}>
      {(segment) => (
        <Switch>
          <Match when={segment.type === "url" && segment}>
            {(link) => (
              <a
                href={link().url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  props.onOpenUrl(link().url);
                }}
              >
                {link().text}
              </a>
            )}
          </Match>
          <Match when={segment.type === "text"}>{segment.text}</Match>
        </Switch>
      )}
    </For>
  );
}
