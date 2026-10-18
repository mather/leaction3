// 枠を畳んだかどうか。発表やイベントをまたいで、その端末に覚えておく
const OPEN_KEY = "leaction:reactionsOpen";

export function loadReactionsOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveReactionsOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // 保存できなければ、次に開いたときは開いた状態に戻るだけ
  }
}
