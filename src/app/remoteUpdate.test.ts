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

  it("names an old daemon instead of claiming an empty success", () => {
    const summary = summarizeRemoteUpdate(
      update({ providers: { status: "unsupported" } }),
    );
    expect(summary.providers).toContain("predates");
    expect(summary.tone).toBe("warning");
  });
});
