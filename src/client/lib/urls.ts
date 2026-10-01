// 画面に表示・共有する URL。オリジンは表示中のページに合わせる。

export function eventUrl(id: string): string {
  return `${location.origin}/e/${id}`;
}

/** 作成者・共同管理者用の管理 URL。トークンは `#k=` に置き、サーバーへ送らない。 */
export function manageUrl(id: string, token: string): string {
  return `${location.origin}/e/${id}/manage#k=${token}`;
}
