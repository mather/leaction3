// 共有用の URL。DOM に依存しないのでテストからも使える。

/** X の投稿画面の URL。本文はイベント名、ハッシュタグがあれば付ける */
export function xPostUrl(params: { url: string; text: string; hashtag: string | null }): string {
  const q = new URLSearchParams({ text: params.text, url: params.url });
  if (params.hashtag) q.set("hashtags", params.hashtag);
  return `https://x.com/intent/post?${q}`;
}
