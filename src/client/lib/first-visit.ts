// イベントページを初めて開いた人への案内（投稿は公開されること、規約への同意）。
// 「OK」を押すか最初のコメントを送ったら、端末内（localStorage）に既読を残して出さなくする。
// 規約を改定して案内し直すときは NOTICE_VERSION を変える。
const NOTICE_KEY = "leaction:noticeAck";
const NOTICE_VERSION = "2026-10-15";

export function loadNoticeAcked(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === NOTICE_VERSION;
  } catch {
    return false;
  }
}

export function saveNoticeAcked(): void {
  try {
    localStorage.setItem(NOTICE_KEY, NOTICE_VERSION);
  } catch {
    // 保存できなければ、次に開いたときにもう一度出すだけ
  }
}
