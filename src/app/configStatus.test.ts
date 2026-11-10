import { describe, expect, it } from "vitest";

import {
  formatRevision,
  summarizeDocument,
  summarizePlan,
  summarizeRecovery,
  summarizeReport,
} from "./configStatus";
import type {
  DesktopServiceChangePlan,
  DesktopServiceChangeReport,
} from "./desktop";

const revision = "0123456789abcdef0123456789abcdef01234567";

function plan(overrides: Partial<DesktopServiceChangePlan> = {}): DesktopServiceChangePlan {
  return {
    started: false,
    unchanged: false,
    liveOnly: false,
    restartRequired: false,
    changedDocument: false,
    ...overrides,
  };
}

function report(overrides: Partial<DesktopServiceChangeReport> = {}): DesktopServiceChangeReport {
  return {
    plan: plan(),
    status: "applied_live",
    restartRequired: false,
    retained: false,
    time: "2026-11-10T00:00:00Z",
    ...overrides,
  };
}

describe("formatRevision", () => {
  it("shortens a hash and keeps an identifier that is not one", () => {
    expect(formatRevision(revision)).toBe("0123456789ab");
    expect(formatRevision("rev-7")).toBe("rev-7");
    expect(formatRevision(undefined)).toBe("");
  });
});

describe("summarizePlan", () => {
  it("says the running service already has the document", () => {
    const summary = summarizePlan(plan({ unchanged: true, targetRevision: revision }));
    expect(summary.lines.join("\n")).toContain("0123456789ab");
    expect(summary.tone).toBe("success");
  });

  it("names the sections that force a restart", () => {
    const summary = summarizePlan(
      plan({
        // A restart plan is about a Box that is already running; `started: false` would be the
        // first start, where nothing can be restarted. The fixture said otherwise and the
        // summarizer used to hide the difference.
        started: true,
        restartRequired: true,
        changedDocument: true,
        changedSections: ["inbounds", "outbounds"],
        currentRevision: "aaaaaaaaaaaa",
        targetRevision: "bbbbbbbbbbbb",
      }),
    );
    expect(summary.lines[0]).toContain("restarts the service");
    expect(summary.lines[0]).toContain("inbounds, outbounds");
    expect(summary.tone).toBe("warning");
  });

  it("reports a live-only change as one that needs no restart", () => {
    const summary = summarizePlan(plan({ started: true, liveOnly: true, targetRevision: revision }));
    expect(summary.lines[0]).toContain("without a restart");
    expect(summary.tone).toBe("success");
  });

  it("stops a stale plan from being applied", () => {
    const summary = summarizePlan(plan({ stale: true }));
    expect(summary.lines[0]).toContain("refresh it before applying");
    expect(summary.tone).toBe("warning");
  });
});

describe("summarizeReport", () => {
  it("reports an applied document with its active revision", () => {
    const summary = summarizeReport(
      report({ status: "applied_live", activeRevision: revision, plan: plan({ targetRevision: revision }) }),
    );
    expect(summary.lines[0]).toContain("applied live");
    expect(summary.lines[1]).toContain("0123456789ab");
    expect(summary.tone).toBe("success");
  });

  it("keeps a failed apply that retained the old document distinct from one that did not", () => {
    const failed = summarizeReport(report({ status: "failed", retained: false }));
    const retained = summarizeReport(report({ status: "failed", retained: true }));
    expect(failed.lines.join("\n")).not.toContain("still the one running");
    expect(retained.lines.join("\n")).toContain("still the one running");
    expect(failed.tone).toBe("error");
    expect(retained.tone).toBe("error");
  });

  it("surfaces a degraded last-good store instead of a clean success", () => {
    const summary = summarizeReport(
      report({
        status: "restarted",
        persistence: "degraded",
        persistenceWarning: "cannot keep the previous document",
        activeRevision: revision,
      }),
    );
    expect(summary.lines.join("\n")).toContain("degraded");
    expect(summary.lines.join("\n")).toContain("cannot keep the previous document");
    expect(summary.tone).toBe("warning");
  });

  it("renders the provider report per tag, not as a count", () => {
    const summary = summarizeReport(
      report({
        status: "applied_live",
        provider: {
          domain: "provider",
          status: "partial",
          restartRequired: true,
          results: [
            {
              tag: "remote-a",
              status: "published",
              pendingTags: ["node-1", "node-2"],
              restartRequired: true,
              reason: "group refused",
            },
            { tag: "local-b", status: "skipped" },
          ],
        },
      }),
    );
    const text = summary.lines.join("\n");
    expect(text).toContain("provider remote-a: published");
    expect(text).toContain("2 pending");
    expect(text).toContain("group refused");
    expect(text).toContain("provider local-b: skipped");
  });

  it("treats a status this client does not know as a failure to report honestly", () => {
    const summary = summarizeReport(report({ status: "future_status" }));
    expect(summary.lines[0]).toContain("unrecognised status");
    expect(summary.tone).toBe("error");
  });
});

describe("summarizeRecovery", () => {
  it("shows both revisions and the failure that caused the recovery", () => {
    const summary = summarizeRecovery({
      time: "2026-11-10T00:00:00Z",
      failedRevision: "ffffffffffffaaaa",
      activeRevision: "ccccccccccccbbbb",
      error: "duplicate inbound tag",
    });
    expect(summary.lines[0]).toContain("ffffffffffff");
    expect(summary.lines[0]).toContain("cccccccccccc");
    expect(summary.lines[1]).toBe("duplicate inbound tag");
    expect(summary.tone).toBe("error");
  });
});

describe("summarizeDocument", () => {
  const render = (value: { status: string }) => ({
    lines: [`document ${value.status}`],
    tone: "success" as const,
  });

  it("does not collapse 'no record yet' into 'this kernel cannot say'", () => {
    const absent = summarizeDocument({ kind: "absent" }, render, "nothing yet", "too old");
    const unsupported = summarizeDocument({ kind: "unsupported" }, render, "nothing yet", "too old");
    expect(absent.lines).toEqual(["nothing yet"]);
    expect(unsupported.lines).toEqual(["too old"]);
    expect(unsupported.tone).toBe("warning");
  });

  it("renders a document through the caller's renderer", () => {
    const summary = summarizeDocument(
      { kind: "document", document: { status: "restarted" } },
      render,
      "nothing yet",
      "too old",
    );
    expect(summary.lines).toEqual(["document restarted"]);
  });
});
