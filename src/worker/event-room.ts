import { DurableObject } from "cloudflare:workers";

/**
 * 1 イベント = 1 インスタンス。イベントへの書き込みはすべてここを通して直列化する。
 * ストレージは SQLite API（ctx.storage.sql）を使う。
 */
export class EventRoom extends DurableObject<Env> {
  /** 疎通確認用。DO の SQLite に触れられることを確かめる。 */
  async ping(): Promise<{ ok: true; sqlite: number }> {
    const row = this.ctx.storage.sql.exec<{ one: number }>("SELECT 1 AS one").one();
    return { ok: true, sqlite: row.one };
  }
}
