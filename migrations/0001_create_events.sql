-- イベントの索引。中身は EventRoom（DO）の SQLite に置く。
-- 時刻は UNIX エポックからのミリ秒。
CREATE TABLE events (
  id TEXT PRIMARY KEY,          -- nanoid 8 文字
  name TEXT NOT NULL,
  date TEXT NOT NULL,           -- 開催日 YYYY-MM-DD
  created_at INTEGER NOT NULL,
  deleted_at INTEGER            -- 論理削除。NULL なら有効
);

CREATE INDEX events_deleted_at ON events (deleted_at) WHERE deleted_at IS NOT NULL;
