// 共有用の URL。DOM に依存しないのでテストからも使える。

/** X での共有に必ず付けるサービスのハッシュタグ */
export const SERVICE_HASHTAG = "leaction";

/** X の投稿画面の URL。本文はイベント名、ハッシュタグはイベントのもの（あれば）とサービスのもの */
export function xPostUrl(params: { url: string; text: string; hashtag: string | null }): string {
  const q = new URLSearchParams({ text: params.text, url: params.url });
  const tags = [params.hashtag, SERVICE_HASHTAG].filter((t): t is string => !!t);
  // イベントのハッシュタグが同じなら重ねない（X のハッシュタグは大文字小文字を区別しない）
  const unique = tags.filter(
    (t, i) => tags.findIndex((u) => u.toLowerCase() === t.toLowerCase()) === i,
  );
  q.set("hashtags", unique.join(","));
  return `https://x.com/intent/post?${q}`;
}
