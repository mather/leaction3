// 共有用の URL。DOM に依存しないのでテストからも使える。

import { uniqueHashtags } from "../../shared/schema";

/** X での共有に必ず付けるサービスのハッシュタグ */
export const SERVICE_HASHTAG = "leaction";

/** X の投稿画面の URL。本文はイベント名、ハッシュタグはイベントのもの（すべて）とサービスのもの */
export function xPostUrl(params: { url: string; text: string; hashtags: string[] }): string {
  const q = new URLSearchParams({ text: params.text, url: params.url });
  // イベントのハッシュタグに同じものがあれば重ねない
  q.set("hashtags", uniqueHashtags([...params.hashtags, SERVICE_HASHTAG]).join(","));
  return `https://x.com/intent/post?${q}`;
}
