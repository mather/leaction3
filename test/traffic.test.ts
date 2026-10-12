import { describe, expect, it } from "vitest";
import { landingSource, pageOf, withSource } from "../src/client/lib/traffic";

const ORIGIN = "https://leaction.example";

describe("landingSource", () => {
  it("決まった ?src= はそのまま使う", () => {
    expect(landingSource("qr", "", ORIGIN)).toEqual({ src: "qr", ref: "" });
    expect(landingSource("host", "https://connpass.com/event/1/", ORIGIN)).toEqual({
      src: "host",
      ref: "connpass.com",
    });
  });

  it("知らない ?src= は other", () => {
    expect(landingSource("slide", "", ORIGIN).src).toBe("other");
  });

  it("?src= がなければリファラから決める", () => {
    expect(landingSource(null, "", ORIGIN)).toEqual({ src: "direct", ref: "" });
    expect(landingSource(null, "https://www.google.co.jp/", ORIGIN).src).toBe("search");
    expect(landingSource(null, "https://search.yahoo.co.jp/search?p=x", ORIGIN).src).toBe("search");
    expect(landingSource(null, "https://t.co/abc", ORIGIN).src).toBe("x");
    expect(landingSource(null, "https://connpass.com/", ORIGIN)).toEqual({
      src: "referral",
      ref: "connpass.com",
    });
  });

  it("同じオリジンからは internal", () => {
    expect(landingSource(null, `${ORIGIN}/e/abcdEFGH`, ORIGIN)).toEqual({
      src: "internal",
      ref: "",
    });
  });
});

describe("pageOf", () => {
  it("パスから画面とイベント ID を決める", () => {
    expect(pageOf("/")).toEqual({ page: "top", eventId: "" });
    expect(pageOf("/new")).toEqual({ page: "new", eventId: "" });
    expect(pageOf("/e/abcdEFGH")).toEqual({ page: "event", eventId: "abcdEFGH" });
    expect(pageOf("/e/abcdEFGH/manage")).toEqual({ page: "manage", eventId: "abcdEFGH" });
    expect(pageOf("/e/too-long-id")).toEqual({ page: "other", eventId: "" });
  });
});

describe("withSource", () => {
  it("?tid= などを残して ?src= を付ける", () => {
    expect(withSource(`${ORIGIN}/e/abcdEFGH?tid=t1`, "qr")).toBe(
      `${ORIGIN}/e/abcdEFGH?tid=t1&src=qr`,
    );
  });
});
