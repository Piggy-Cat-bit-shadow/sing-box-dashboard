import { describe, expect, it } from "vitest";

import {
  MAXIMUM_SUBSCRIPTION_QUOTA_VALUE,
  SUBSCRIPTION_QUOTA_COMPATIBILITY_USER_AGENTS,
  SUBSCRIPTION_USER_INFO_HEADER,
  hasSubscriptionQuota,
  parseSubscriptionUserInfo,
  shouldRetryForSubscriptionQuota,
} from "@shared/subscription";

// The module under test is the desktop shell's `src/shared/subscription.ts`, reached through
// the `@shared` alias: it belongs where the fetch happens, and the dashboard's vitest is the
// repository's only test runner. `@shared` is the alias the desktop shell's own build already
// uses for that directory (`tsconfig.web.json`, and the renderer half of
// `electron.vite.config.ts`), so this is an existing convention rather than a new one - it is
// only declared in this workspace's `vite.config.ts` as well, because vitest resolves through
// Vite. The module is free of Node and Electron APIs for exactly this reason: the numbers it
// produces come from a remote server, so it is the part of the subscription feature that has
// to be tested rather than eyeballed.
describe("parseSubscriptionUserInfo", () => {
  it("parses a complete header", () => {
    expect(
      parseSubscriptionUserInfo("upload=1; download=2; total=10; expire=2000000000"),
    ).toEqual({ upload: 1, download: 2, total: 10, expire: 2000000000 });
  });

  it("tolerates key case, missing spaces and surrounding whitespace", () => {
    // Microsoft's own HTTP stacks emit `Subscription-Userinfo`; many panels emit
    // `subscription-userinfo`. The Fetch API lower-cases header NAMES, but not the KEYS
    // inside the value, so this is the parser's problem and not the caller's.
    expect(parseSubscriptionUserInfo(" Upload = 1 ; DOWNLOAD=2 ; total = 10 ")).toEqual({
      upload: 1,
      download: 2,
      total: 10,
    });
    expect(parseSubscriptionUserInfo("UpLoAd=1;DoWnLoAd=2;ToTaL=3;ExPiRe=4")).toEqual({
      upload: 1,
      download: 2,
      total: 3,
      expire: 4,
    });
  });

  it("parses a partial header", () => {
    // Providers that sell no fixed quota omit `total`; providers that never expire omit
    // `expire`. Neither omission may cost the caller the fields that ARE present.
    expect(parseSubscriptionUserInfo("download=2; total=10")).toEqual({
      download: 2,
      total: 10,
    });
    expect(parseSubscriptionUserInfo("expire=2000000000")).toEqual({ expire: 2000000000 });
  });

  it("ignores garbage instead of throwing or inventing values", () => {
    // Not one of these may become 0: a zero upload would understate usage, and a zero total
    // would turn `remaining` into `max(0 - used, 0)`, i.e. a full quota shown as exhausted.
    expect(parseSubscriptionUserInfo("upload=abc; total=-1; whatever=123")).toEqual({});
    expect(
      parseSubscriptionUserInfo("upload=1e9; download=0x10; total=NaN; expire=Infinity"),
    ).toEqual({});
    expect(parseSubscriptionUserInfo("upload=; download= ; total=+; expire=.")).toEqual({});
  });

  it("distinguishes an absent header from an unparseable one", () => {
    // The caller has to be able to tell these apart. Absent means "keep the last known
    // snapshot"; present-but-unusable means "this provider stopped reporting numbers", which
    // must NOT leave a week-old figure on screen looking current.
    expect(parseSubscriptionUserInfo(null)).toBeUndefined();
    expect(parseSubscriptionUserInfo(undefined)).toBeUndefined();
    expect(parseSubscriptionUserInfo("")).toEqual({});
    expect(parseSubscriptionUserInfo("upload=abc")).toEqual({});
  });

  it("rejects numbers a JavaScript number cannot hold exactly", () => {
    // Above 2^53-1, `Number` silently rounds: 9007199254740993 becomes
    // 9007199254740992. Persisting that would store a byte count the provider never sent.
    expect(parseSubscriptionUserInfo("total=9007199254740993")).toEqual({});
    expect(parseSubscriptionUserInfo("total=9007199254740992")).toEqual({});
    // The cap is 1 PiB (~2^50), far past every real quota and comfortably inside the range
    // where every integer is exactly representable - so the boundary is the cap and not the
    // float precision limit, and the two do not have to be reasoned about together.
    expect(parseSubscriptionUserInfo(`total=${MAXIMUM_SUBSCRIPTION_QUOTA_VALUE + 1}`)).toEqual({});
    expect(parseSubscriptionUserInfo(`total=${MAXIMUM_SUBSCRIPTION_QUOTA_VALUE}`)).toEqual({
      total: MAXIMUM_SUBSCRIPTION_QUOTA_VALUE,
    });
  });

  it("keeps expire in seconds, unmultiplied", () => {
    // 2000000000 seconds is 2033-05-18. If this were read as milliseconds it would be
    // 1970-01-24, and the UI would report every subscription as long expired.
    const quota = parseSubscriptionUserInfo("expire=2000000000");
    expect(quota?.expire).toBe(2_000_000_000);
    expect(new Date((quota?.expire ?? 0) * 1000).getUTCFullYear()).toBe(2033);
  });

  it("survives a header with segments that are not assignments", () => {
    expect(parseSubscriptionUserInfo("garbage; upload=1; ; total=2; =3; download")).toEqual({
      upload: 1,
      total: 2,
    });
  });

  it("takes the last value when a key is repeated", () => {
    expect(parseSubscriptionUserInfo("upload=1; upload=2")).toEqual({ upload: 2 });
  });

  it("ignores unknown keys", () => {
    expect(parseSubscriptionUserInfo("upload=1; reset_day=5; plan=pro")).toEqual({ upload: 1 });
  });
});

describe("hasSubscriptionQuota", () => {
  it("reports whether a snapshot carries at least one fact", () => {
    expect(hasSubscriptionQuota(undefined)).toBe(false);
    expect(hasSubscriptionQuota({})).toBe(false);
    expect(hasSubscriptionQuota({ total: 0 })).toBe(true);
    expect(hasSubscriptionQuota({ upload: 0, download: 0 })).toBe(true);
  });
});

describe("retry policy", () => {
  it("names the header the way Fetch looks it up", () => {
    expect(SUBSCRIPTION_USER_INFO_HEADER).toBe("subscription-userinfo");
  });

  it("keeps the compatibility User-Agent list bounded and non-empty", () => {
    // A matrix of guesses would multiply the cost of every update that lacks the header, so
    // the bound is part of the design and not an implementation detail.
    expect(SUBSCRIPTION_QUOTA_COMPATIBILITY_USER_AGENTS.length).toBeGreaterThan(0);
    expect(SUBSCRIPTION_QUOTA_COMPATIBILITY_USER_AGENTS.length).toBeLessThanOrEqual(3);
    for (const userAgent of SUBSCRIPTION_QUOTA_COMPATIBILITY_USER_AGENTS) {
      expect(userAgent.length).toBeGreaterThan(0);
    }
  });

  it("retries only when a successful response carried no header", () => {
    expect(shouldRetryForSubscriptionQuota(true, undefined)).toBe(true);
    // The header was there: a retry would only produce a second answer to a settled question.
    expect(shouldRetryForSubscriptionQuota(true, { total: 1 })).toBe(false);
    expect(shouldRetryForSubscriptionQuota(true, {})).toBe(false);
    // The request itself failed. A different User-Agent does not turn a 404 or a 500 into a
    // subscription, and retrying would triple the cost of every failed update.
    expect(shouldRetryForSubscriptionQuota(false, undefined)).toBe(false);
  });
});
