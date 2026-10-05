import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type {
  AdminKeysResponse,
  AdminSessionResponse,
  CreateAdminKeyResponse,
  DeleteEventResponse,
  GetAdminResponse,
} from "../src/shared/api";
import { WS_CLOSE_EVENT_DELETED } from "../src/shared/protocol";
import {
  adminCookie,
  connect,
  expectType,
  ORIGIN,
  participant,
  postAdminSession,
  request,
  setupAdmin,
  upgrade,
} from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

async function issueKey(id: string, cookie: string) {
  const res = await request(`/api/rooms/${id}/admin-keys`, { method: "POST", cookie });
  expect(res.status).toBe(200);
  return res.json<CreateAdminKeyResponse>();
}

/** 作成者と、作成者が発行した共同管理者 URL の管理 Cookie を用意する */
async function setup() {
  const admin = await setupAdmin();
  const { key, token } = await issueKey(admin.id, admin.cookie);
  return {
    ...admin,
    managerKey: key,
    managerToken: token,
    manager: await adminCookie(admin.id, token),
  };
}

function getAdmin(id: string, cookie: string) {
  return request(`/api/rooms/${id}/admin`, { cookie });
}

function readIndex(id: string) {
  return env.DB.prepare("SELECT deleted_at FROM events WHERE id = ?")
    .bind(id)
    .first<{ deleted_at: number | null }>();
}

describe("共同管理者 URL", () => {
  it("作成者が発行し、そのトークンで共同管理者として管理できる", async () => {
    const { id, cookie } = await setupAdmin();
    const { key, token } = await issueKey(id, cookie);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key).toMatchObject({ revokedAt: null });

    const session = await postAdminSession(id, token);
    expect(await session.json<AdminSessionResponse>()).toEqual({ role: "manager" });
    const manager = (session.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
    const res = await getAdmin(id, manager);
    expect(res.status).toBe(200);
    expect((await res.json<GetAdminResponse>()).role).toBe("manager");
    const patch = await request(`/api/rooms/${id}`, {
      method: "PATCH",
      cookie: manager,
      body: { name: "共同管理者が変更" },
    });
    expect(patch.status).toBe(200);

    // トークンは平文で保存しない
    const stored = await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) =>
      JSON.stringify(state.storage.sql.exec("SELECT * FROM admin_keys").toArray()),
    );
    expect(stored).not.toContain(token);
  });

  it("一覧は共同管理者 URL だけを新しい順に返し、トークンは含めない", async () => {
    const { id, cookie } = await setupAdmin();
    const first = await issueKey(id, cookie);
    const second = await issueKey(id, cookie);
    const res = await request(`/api/rooms/${id}/admin-keys`, { cookie });
    expect(res.status).toBe(200);
    const { keys } = await res.json<AdminKeysResponse>();
    expect(keys).toEqual([second.key, first.key]);
    expect(JSON.stringify(keys)).not.toContain(first.token);
  });

  it("無効化すると、その URL の管理セッションはすぐに使えなくなり、URL からも入れない", async () => {
    const { id, cookie, manager, managerKey, managerToken } = await setup();
    const res = await request(`/api/rooms/${id}/admin-keys/${managerKey.id}`, {
      method: "DELETE",
      cookie,
    });
    expect(res.status).toBe(200);
    const { keys } = await res.json<AdminKeysResponse>();
    expect(keys[0]?.revokedAt).toEqual(expect.any(Number));

    expect((await getAdmin(id, manager)).status).toBe(401);
    const patch = await request(`/api/rooms/${id}`, {
      method: "PATCH",
      cookie: manager,
      body: { name: "x" },
    });
    expect(patch.status).toBe(401);
    expect((await postAdminSession(id, managerToken)).status).toBe(401);
    // 作成者は影響を受けない
    expect((await getAdmin(id, cookie)).status).toBe(200);
  });

  it("作成者の URL や存在しないキーは無効化できない（404）", async () => {
    const { id, cookie } = await setupAdmin();
    const ownerKeyId = await runInDurableObject(
      env.EVENT_ROOM.getByName(id),
      (_, state) =>
        state.storage.sql
          .exec<{ id: string }>("SELECT id FROM admin_keys WHERE role = 'owner'")
          .one().id,
    );
    for (const keyId of [ownerKeyId, "nothere1"]) {
      const res = await request(`/api/rooms/${id}/admin-keys/${keyId}`, {
        method: "DELETE",
        cookie,
      });
      expect(res.status).toBe(404);
    }
    expect((await getAdmin(id, cookie)).status).toBe(200);
  });

  it("有効な共同管理者 URL が上限に達したら 409", async () => {
    const { id, cookie } = await setupAdmin();
    await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => {
      for (let i = 0; i < 20; i++) {
        state.storage.sql.exec(
          "INSERT INTO admin_keys (id, role, token_hash, created_at) VALUES (?, 'manager', ?, 0)",
          `k${i}`,
          `hash${i}`,
        );
      }
    });
    const res = await request(`/api/rooms/${id}/admin-keys`, { method: "POST", cookie });
    expect(res.status).toBe(409);
  });

  it("共同管理者は作成者だけの操作ができない（403）", async () => {
    const { id, manager, managerKey } = await setup();
    const forbidden = [
      ["GET", `/api/rooms/${id}/admin-keys`],
      ["POST", `/api/rooms/${id}/admin-keys`],
      ["DELETE", `/api/rooms/${id}/admin-keys/${managerKey.id}`],
      ["DELETE", `/api/rooms/${id}`],
      ["POST", `/api/rooms/${id}/restore`],
    ] as const;
    for (const [method, path] of forbidden) {
      const res = await request(path, { method, cookie: manager });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(await readIndex(id)).toEqual({ deleted_at: null });
  });

  it("Origin が違えば 403、管理 Cookie がなければ 401", async () => {
    const { id, cookie } = await setupAdmin();
    const evil = await request(`/api/rooms/${id}/admin-keys`, {
      method: "POST",
      cookie,
      origin: "https://evil.example",
    });
    expect(evil.status).toBe(403);
    const anonymous = await request(`/api/rooms/${id}/admin-keys`, { method: "POST" });
    expect(anonymous.status).toBe(401);
  });
});

describe("イベントの削除と復元", () => {
  it("削除すると参加者から見えなくなり、接続も閉じる", async () => {
    const { id, cookie, manager } = await setup();
    const pid = await participant();
    const ws = await connect(id, pid);
    await expectType(ws, "snapshot");
    const closed = new Promise<number>((resolve) =>
      ws.ws.addEventListener("close", (e) => resolve(e.code)),
    );

    const res = await request(`/api/rooms/${id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(200);
    const { deletion } = await res.json<DeleteEventResponse>();
    expect(deletion.restorableUntil - deletion.deletedAt).toBe(7 * DAY_MS);
    expect(await closed).toBe(WS_CLOSE_EVENT_DELETED);

    expect(await readIndex(id)).toEqual({ deleted_at: deletion.deletedAt });
    expect((await exports.default.fetch(`${ORIGIN}/api/rooms/${id}`)).status).toBe(404);
    const reconnect = await upgrade(`/api/rooms/${id}/ws`, { Cookie: pid });
    expect(reconnect.status).toBe(404);

    // 共同管理者は使えなくなり、作成者も復元以外の管理はできない
    expect((await getAdmin(id, manager)).status).toBe(401);
    const patch = await request(`/api/rooms/${id}`, {
      method: "PATCH",
      cookie,
      body: { name: "x" },
    });
    expect(patch.status).toBe(401);

    const alarm = await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBe(deletion.restorableUntil);
  });

  it("削除済みでも作成者 URL では開けて、削除の状態が返る", async () => {
    const { id, ownerToken, cookie, managerToken } = await setup();
    await request(`/api/rooms/${id}`, { method: "DELETE", cookie });

    const session = await postAdminSession(id, ownerToken);
    expect(session.status).toBe(200);
    const res = await getAdmin(id, cookie);
    expect(res.status).toBe(200);
    const body = await res.json<GetAdminResponse>();
    expect(body.role).toBe("owner");
    expect(body.event.name).toBe("LT 会");
    expect(body.deletion).toEqual({
      deletedAt: expect.any(Number),
      restorableUntil: expect.any(Number),
    });
    // 共同管理者 URL では入れない
    expect((await postAdminSession(id, managerToken)).status).toBe(401);
  });

  it("7 日以内なら復元でき、参加者の画面と共同管理者 URL も元に戻る", async () => {
    const { id, cookie, manager } = await setup();
    await request(`/api/rooms/${id}`, { method: "DELETE", cookie });

    const res = await request(`/api/rooms/${id}/restore`, { method: "POST", cookie });
    expect(res.status).toBe(200);
    expect((await res.json<GetAdminResponse>()).deletion).toBeNull();

    expect(await readIndex(id)).toEqual({ deleted_at: null });
    expect((await exports.default.fetch(`${ORIGIN}/api/rooms/${id}`)).status).toBe(200);
    expect((await getAdmin(id, manager)).status).toBe(200);
    const ws = await connect(id, await participant());
    await expectType(ws, "snapshot");
    const alarm = await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBeNull();
  });

  it("期限を過ぎたら復元できない（404）", async () => {
    const { id, cookie } = await setupAdmin();
    await request(`/api/rooms/${id}`, { method: "DELETE", cookie });
    await runInDurableObject(env.EVENT_ROOM.getByName(id), (_, state) => {
      state.storage.sql.exec("UPDATE event SET deleted_at = ?", Date.now() - 8 * DAY_MS);
    });
    const res = await request(`/api/rooms/${id}/restore`, { method: "POST", cookie });
    expect(res.status).toBe(404);
  });

  it("期限のアラームで、全データと D1 の索引を消す", async () => {
    const { id, cookie } = await setupAdmin();
    const ws = await connect(id, await participant());
    await expectType(ws, "snapshot");
    await request(`/api/rooms/${id}`, { method: "DELETE", cookie });
    const stub = env.EVENT_ROOM.getByName(id);
    await runInDurableObject(stub, (_, state) => {
      state.storage.sql.exec("UPDATE event SET deleted_at = ?", Date.now() - 8 * DAY_MS);
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await readIndex(id)).toBeNull();
    const counts = await runInDurableObject(stub, (_, state) =>
      ["event", "talks", "admin_keys"].map(
        (table) =>
          state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n,
      ),
    );
    expect(counts).toEqual([0, 0, 0]);
    expect((await request(`/api/rooms/${id}/restore`, { method: "POST", cookie })).status).toBe(
      401,
    );
  });

  it("期限前に復元していれば、アラームが動いても何も消さない", async () => {
    const { id, cookie } = await setupAdmin();
    await request(`/api/rooms/${id}`, { method: "DELETE", cookie });
    const stub = env.EVENT_ROOM.getByName(id);
    // 復元前に仕掛けたアラームが、取り消しと行き違いで動いた場合
    await request(`/api/rooms/${id}/restore`, { method: "POST", cookie });
    await runInDurableObject(stub, (_, state) => state.storage.setAlarm(Date.now()));
    await runDurableObjectAlarm(stub);
    expect(await readIndex(id)).toEqual({ deleted_at: null });
    expect((await getAdmin(id, cookie)).status).toBe(200);
  });
});
