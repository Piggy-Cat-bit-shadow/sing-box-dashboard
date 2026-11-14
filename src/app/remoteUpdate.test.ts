import { describe, expect, it } from "vitest";

import type { DesktopRemoteProfileUpdate } from "./desktop";
import { summarizeRemoteUpdate } from "./remoteUpdate";

function update(
  overrides: Partial<DesktopRemoteProfileUpdate> = {},
): DesktopRemoteProfileUpdate {
  return {
    profileId: "p",
    changed: true,
    config: { status: "applied" },
    providers: { status: "published", counts: { published: 1, unchanged: 0, failed: 0, skipped: 0, busy: 0, pending: 0, restartRequired: 0, total: 1 } },
    ...overrides,
  };
}

describe("summarizeRemoteUpdate", () => {
  it("renders both halves of a clean apply", () => {
    const summary = summarizeRemoteUpdate(update());
    expect(summary.config).toContain("applied");
    expect(summary.providers).toContain("1 published");
    expect(summary.tone).toBe("success");
  });

  it("shows a partial provider document as an error, not a clean publish", () => {
    // The core reports a refused group membership as published + pending_tags. Counting statuses
    // alone used to present that as success.
    const summary = summarizeRemoteUpdate(
      update({
        providers: {
          status: "partial",
          counts: { published: 1, unchanged: 0, failed: 0, skipped: 0, busy: 0, pending: 2, restartRequired: 1, total: 1 },
        },
      }),
    );
    expect(summary.providers).toContain("2 pending");
    expect(summary.providers).toContain("1 need a restart");
    expect(summary.tone).toBe("error");
  });

  it("keeps saved-only and not-active updates out of the success tone", () => {
    const summary = summarizeRemoteUpdate(
      update({
        config: { status: "saved" },
        providers: { status: "not-running" },
      }),
    );
    expect(summary.config).toContain("next start");
    expect(summary.providers).toContain("not refreshed");
    expect(summary.tone).toBe("warning");
  });

  it("reports a download failure while the old instance was still refreshed", () => {
    const summary = summarizeRemoteUpdate(
      update({
        changed: false,
        config: { status: "download-failed", detail: "503 Service Unavailable" },
        providers: { status: "unchanged", counts: { published: 0, unchanged: 3, failed: 0, skipped: 0, busy: 0, pending: 0, restartRequired: 0, total: 3 } },
      }),
    );
    expect(summary.config).toContain("503");
    expect(summary.providers).toContain("unchanged");
    expect(summary.tone).toBe("error");
  });

  it("names an old service instead of claiming an empty success", () => {
    const summary = summarizeRemoteUpdate(
      update({ providers: { status: "unsupported" } }),
    );
    expect(summary.providers).toContain("does not support");
    expect(summary.tone).toBe("warning");
  });

  it("does not hide a failed provider behind a partial result", () => {
    const summary = summarizeRemoteUpdate(
      update({
        providers: {
          status: "partial",
          counts: { published: 1, unchanged: 0, failed: 1, skipped: 0, busy: 0, pending: 2, restartRequired: 0, total: 2 },
        },
      }),
    );
    expect(summary.providers).toContain("2 pending");
    expect(summary.providers).toContain("1 failed");
    expect(summary.tone).toBe("error");
  });

  it("renders both lines through the catalog translator", () => {
    const summary = summarizeRemoteUpdate(update(), (key) => `T:${key}`);
    expect(summary.config).toBe("T:Config applied");
    expect(summary.providers).toBe("T:Providers: {published} published");
    expect(summary.tone).toBe("success");
  });

  it("does not attribute a provider report to an instance replaced mid-update", () => {
    const summary = summarizeRemoteUpdate(
      update({
        providers: { status: "superseded", detail: "the instance changed during the update" },
      }),
    );
    expect(summary.providers).toContain("newer operation owns the instance");
    expect(summary.tone).toBe("warning");
  });
});
