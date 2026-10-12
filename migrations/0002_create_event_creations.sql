-- アクセス解析: イベント作成者の初回接触（観客から作成者への転換の集計用）。docs/analytics.md を参照。
-- コメントなどの中身を含まないので、イベントを削除しても残す。時刻は UNIX エポックからのミリ秒。
-- 計測情報が送られなかった作成（localStorage が使えない等）は anon_id 以下が NULL になる。
CREATE TABLE event_creations (
  event_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  anon_id TEXT,                 -- 作成者の匿名 ID（参加者 ID とは別物）
  first_src TEXT,               -- 初回接触の流入元（qr, link, x, share, host, search, referral, direct など）
  first_entry TEXT,             -- 初回接触の入口（event, top, new, manage, other）
  first_ref TEXT,               -- 初回接触のリファラのホスト
  first_event_id TEXT,          -- 初回接触がイベントページなら、そのイベント
  first_seen_at INTEGER,
  joined_at INTEGER,            -- 観客として初めて他人のイベントページを開いた時刻。なければ NULL
  prior_events INTEGER          -- このブラウザで以前に作ったイベント数
);

CREATE INDEX event_creations_created_at ON event_creations (created_at);
