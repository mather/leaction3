import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, resolveLimits } from "../src/shared/schema";

describe("resolveLimits", () => {
  it("環境変数がなければ既定値", () => {
    expect(resolveLimits({})).toEqual(DEFAULT_LIMITS);
  });

  it("環境変数で上書きできる", () => {
    const limits = resolveLimits({ LIMIT_RATE_COUNT: "40", LIMIT_COMMENT_MAX_LENGTH: " 1000 " });
    expect(limits.rateLimitCount).toBe(40);
    expect(limits.commentMaxLength).toBe(1000);
  });

  it("不正な値は無視する", () => {
    const limits = resolveLimits({ LIMIT_RATE_COUNT: "abc", LIMIT_RATE_WINDOW_SEC: "0" });
    expect(limits.rateLimitCount).toBe(DEFAULT_LIMITS.rateLimitCount);
    expect(limits.rateLimitWindowSec).toBe(DEFAULT_LIMITS.rateLimitWindowSec);
  });
});
