import { describe, expect, it } from "vitest";

import {
  subscriptionQuotaDisplay,
  subscriptionQuotaExpiry,
  subscriptionQuotaSummary,
} from "./subscriptionQuota";

// The identity translate: English is the key, and the only substitution it performs is
// `{name}`. Using it here means the assertions read as the strings the card actually shows.
const t = (key: string, params?: Record<string, string | number>): string => {
  let text = key;
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
};

const NOW = Date.UTC(2026, 0, 1);

describe("subscriptionQuotaDisplay", () => {
  it("shows nothing at all when there is no snapshot", () => {
    // The no-data behaviour, and the reason this returns `undefined` rather than an object of
    // zeroes: the caller renders nothing, so a provider that was silent produces no
    // placeholder, no `0 B / 0 B` and no "Unknown" block.
    expect(subscriptionQuotaDisplay(undefined, NOW)).toBeUndefined();
    expect(subscriptionQuotaDisplay({ updatedAt: NOW }, NOW)).toBeUndefined();
  });

  it("shows `Remaining X / Y` when a quota is known", () => {
    const display = subscriptionQuotaDisplay(
      { upload: 100, download: 200, total: 1000, updatedAt: NOW },
      NOW,
    );
    expect(display).toBeDefined();
    expect(subscriptionQuotaSummary(display!, t)).toBe("Remaining 700 B / 1 KB");
  });

  it("shows `Used X` when usage is known but no quota is", () => {
    const display = subscriptionQuotaDisplay({ upload: 100, download: 200, updatedAt: NOW }, NOW);
    expect(subscriptionQuotaSummary(display!, t)).toBe("Used 300 B");
  });

  it("treats a zero total as no quota rather than an exhausted one", () => {
    // `total=0` is what panels send for an unmetered plan. Reporting `Remaining 0 B / 0 B`
    // would claim the opposite of what it means.
    const display = subscriptionQuotaDisplay(
      { upload: 100, download: 200, total: 0, updatedAt: NOW },
      NOW,
    );
    expect(display?.total).toBeUndefined();
    expect(display?.remaining).toBeUndefined();
    expect(subscriptionQuotaSummary(display!, t)).toBe("Used 300 B");
  });

  it("clamps remaining at zero when usage exceeds the quota", () => {
    const display = subscriptionQuotaDisplay(
      { upload: 900, download: 900, total: 1000, updatedAt: NOW },
      NOW,
    );
    // Never a negative number: "-800 B remaining" is not a thing a provider can mean, and a
    // percentage derived from it would run backwards.
    expect(display?.remaining).toBe(0);
    expect(subscriptionQuotaSummary(display!, t)).toBe("Remaining 0 B / 1 KB");
  });

  it("counts a snapshot with only one direction", () => {
    const downloadOnly = subscriptionQuotaDisplay(
      { download: 500, total: 1000, updatedAt: NOW },
      NOW,
    );
    expect(downloadOnly?.used).toBe(500);
    expect(downloadOnly?.remaining).toBe(500);
  });

  it("withholds the whole line when the fields are unusable", () => {
    // Values arrive from a remote server, over IPC, from a database that may predate this
    // feature. `NaN` and negatives must not reach `formatBytes` or the arithmetic.
    expect(
      subscriptionQuotaDisplay(
        { upload: Number.NaN, download: -1, total: Number.POSITIVE_INFINITY, updatedAt: NOW },
        NOW,
      ),
    ).toBeUndefined();
  });

  it("ignores a zero or negative expire instead of rendering 1970", () => {
    // `expire=0` is "no expiry" to most panels. `new Date(0)` is 1970-01-01, and showing that
    // would read as data loss.
    expect(subscriptionQuotaDisplay({ expire: 0, updatedAt: NOW }, NOW)).toBeUndefined();
    expect(subscriptionQuotaDisplay({ expire: -5, updatedAt: NOW }, NOW)).toBeUndefined();
  });

  it("converts expire from seconds, not milliseconds", () => {
    // 2000000000 seconds is 2033-05-18 UTC. Read as milliseconds it would be 1970-01-24.
    const display = subscriptionQuotaDisplay({ expire: 2_000_000_000, updatedAt: NOW }, NOW);
    expect(display?.expiresAt?.toISOString().slice(0, 10)).toBe("2033-05-18");
    expect(display?.expired).toBe(false);
  });

  it("reports an expiry that has passed", () => {
    const display = subscriptionQuotaDisplay({ expire: 1_600_000_000, updatedAt: NOW }, NOW);
    expect(display?.expired).toBe(true);
    expect(subscriptionQuotaExpiry(display!, "en-US", t)).toContain("Expired");
  });
});

describe("subscriptionQuotaSummary", () => {
  it("returns nothing when there is neither a quota nor usage", () => {
    // Reachable when the only usable field was an expiry: an expiry alone is a fact worth
    // showing, but it is not a traffic figure.
    const display = subscriptionQuotaDisplay({ expire: 2_000_000_000, updatedAt: NOW }, NOW);
    expect(subscriptionQuotaSummary(display!, t)).toBeUndefined();
    expect(subscriptionQuotaExpiry(display!, "en-US", t)).toContain("Expires");
  });
});

describe("subscriptionQuotaExpiry", () => {
  it("returns nothing when the provider set no expiry", () => {
    const display = subscriptionQuotaDisplay({ total: 1000, updatedAt: NOW }, NOW);
    expect(subscriptionQuotaExpiry(display!, "en-US", t)).toBeUndefined();
  });
});
