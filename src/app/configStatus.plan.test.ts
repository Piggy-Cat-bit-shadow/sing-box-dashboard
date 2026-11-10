import { describe, expect, it } from "vitest";

import { summarizePlan } from "./configStatus";
import type { DesktopServiceChangePlan } from "./desktop";

/**
 * The plan fixtures are the kernel's own `PreviewServiceChange` output, captured from
 * `TestZZCapturePreviewJSON` (daemon/service_change.go) rather than written by hand.
 *
 * That matters for the field this file exists to pin: `started` means "a Box is running now",
 * and `started=false` is the first start. The client used to read it the other way round, so a
 * live apply, a restart and a stale plan were all replaced by "would start a new instance".
 * A hand-written fixture is exactly how that inversion can be written down as if it were right.
 */
function captured(json: string): DesktopServiceChangePlan {
  return JSON.parse(json) as DesktopServiceChangePlan;
}

// started=false: there is no running Box, so applying starts one.
const FIRST_START = captured(
  '{"started":false,"targetRevision":"a28eeff6b2d5077a","unchanged":false,"liveOnly":false,' +
    '"restartRequired":false,"changedDocument":false,' +
    '"mode":{"domain":"mode","supported":false,"restartRequired":false},' +
    '"dns":{"domain":"dns","supported":false,"restartRequired":false},' +
    '"rule":{"domain":"rule","supported":false,"restartRequired":false},' +
    '"provider":{"domain":"provider","supported":true,' +
    '"liveRefreshReason":"the document changed; provider declarations are rebuilt with it",' +
    '"targetRevision":"a28eeff6b2d5077a"}}',
);

// started=true, live only: the running Box absorbs the mode change.
const LIVE_ONLY = captured(
  '{"started":true,"currentRevision":"5cdda4a0c6c03666","targetRevision":"8082aed150b32c3e",' +
    '"unchanged":false,"liveOnly":true,"restartRequired":false,"changedDocument":true,' +
    '"mode":{"domain":"mode","supported":true,"restartRequired":false,' +
    '"changes":[{"kind":"mode","from":"Global","to":"Direct"}],' +
    '"currentRevision":"5cdda4a0c6c03666","targetRevision":"8082aed150b32c3e"},' +
    '"dns":{"domain":"dns","supported":true,"restartRequired":false,' +
    '"currentRevision":"5cdda4a0c6c03666","targetRevision":"8082aed150b32c3e"},' +
    '"rule":{"domain":"rule","supported":true,"restartRequired":false,' +
    '"currentRevision":"5cdda4a0c6c03666","targetRevision":"8082aed150b32c3e"},' +
    '"provider":{"domain":"provider","supported":true,' +
    '"liveRefreshReason":"the document changed; provider declarations are rebuilt with it",' +
    '"currentRevision":"5cdda4a0c6c03666","targetRevision":"8082aed150b32c3e"}}',
);

// started=true, restart required: the log level has no live owner.
const RESTART = captured(
  '{"started":true,"currentRevision":"a28eeff6b2d5077a","targetRevision":"e8d96760b5608ebc",' +
    '"unchanged":false,"liveOnly":false,"restartRequired":true,"changedDocument":true,' +
    '"changedSections":["log"],' +
    '"mode":{"domain":"mode","supported":false,' +
    '"unsupportedReason":"the running configuration has no clash_api owner",' +
    '"restartRequired":false,"currentRevision":"a28eeff6b2d5077a",' +
    '"targetRevision":"e8d96760b5608ebc"},' +
    '"dns":{"domain":"dns","supported":true,"restartRequired":false,' +
    '"currentRevision":"a28eeff6b2d5077a","targetRevision":"e8d96760b5608ebc"},' +
    '"rule":{"domain":"rule","supported":true,"restartRequired":false,' +
    '"currentRevision":"a28eeff6b2d5077a","targetRevision":"e8d96760b5608ebc"},' +
    '"provider":{"domain":"provider","supported":true,' +
    '"liveRefreshReason":"the document changed; provider declarations are rebuilt with it",' +
    '"currentRevision":"a28eeff6b2d5077a","targetRevision":"e8d96760b5608ebc"}}',
);

// started=true, unchanged: the running document is the one being previewed.
const UNCHANGED = captured(
  '{"started":true,"currentRevision":"a28eeff6b2d5077a","targetRevision":"a28eeff6b2d5077a",' +
    '"unchanged":true,"liveOnly":false,"restartRequired":false,"changedDocument":false,' +
    '"mode":{"domain":"mode","supported":false,' +
    '"unsupportedReason":"the running configuration has no clash_api owner",' +
    '"restartRequired":false,"currentRevision":"a28eeff6b2d5077a",' +
    '"targetRevision":"a28eeff6b2d5077a"},' +
    '"dns":{"domain":"dns","supported":true,"restartRequired":false,' +
    '"currentRevision":"a28eeff6b2d5077a","targetRevision":"a28eeff6b2d5077a"},' +
    '"rule":{"domain":"rule","supported":true,"restartRequired":false,' +
    '"currentRevision":"a28eeff6b2d5077a","targetRevision":"a28eeff6b2d5077a"},' +
    '"provider":{"domain":"provider","supported":true,' +
    '"liveRefreshReason":"the document declares no remote provider",' +
    '"currentRevision":"a28eeff6b2d5077a","targetRevision":"a28eeff6b2d5077a"}}',
);

/**
 * `stale` is report-only: a preview is computed against the running document and cannot be stale
 * when it is returned. The fixture is the restart plan of a report that lost its base, which is
 * the shape the summarizer has to read once a plan arrives from `GetLastServiceChange`.
 */
const STALE: DesktopServiceChangePlan = { ...RESTART, stale: true };

describe("summarizePlan: started means a Box is running", () => {
  it("reads started=false as the first start", () => {
    const summary = summarizePlan(FIRST_START);
    expect(summary.lines[0]).toContain("start a new instance");
    expect(summary.lines[0]).toContain("a28eeff6b2d5");
    expect(summary.tone).toBe("warning");
  });

  it("applies a live-only change to the running Box instead of starting a new instance", () => {
    const summary = summarizePlan(LIVE_ONLY);
    expect(summary.lines[0]).toContain("takes effect live");
    expect(summary.lines[0]).toContain("5cdda4a0c6c0");
    expect(summary.lines[0]).toContain("8082aed150b3");
    expect(summary.lines[0]).not.toContain("new instance");
    expect(summary.tone).toBe("success");
  });

  it("reports a restart against the running Box and names the section that forces it", () => {
    const summary = summarizePlan(RESTART);
    expect(summary.lines[0]).toContain("restarts the service");
    expect(summary.lines[0]).toContain("log");
    expect(summary.lines[0]).toContain("a28eeff6b2d5");
    expect(summary.lines[0]).toContain("e8d96760b560");
    expect(summary.lines[0]).not.toContain("new instance");
    expect(summary.tone).toBe("warning");
  });

  it("keeps an unchanged running document out of the start branch", () => {
    const summary = summarizePlan(UNCHANGED);
    expect(summary.lines[0]).toContain("already runs revision a28eeff6b2d5");
    expect(summary.lines[0]).not.toContain("new instance");
    expect(summary.tone).toBe("success");
  });

  it("refuses to apply a stale plan before anything else", () => {
    const summary = summarizePlan(STALE);
    expect(summary.lines[0]).toContain("refresh it before applying");
    expect(summary.lines[0]).not.toContain("restarts the service");
    expect(summary.tone).toBe("warning");
  });

  it("reports a running document that changes nothing that needs a restart", () => {
    const summary = summarizePlan(
      captured(
        '{"started":true,"currentRevision":"aaaaaaaaaaaa","targetRevision":"bbbbbbbbbbbb",' +
          '"unchanged":false,"liveOnly":false,"restartRequired":false,"changedDocument":false}',
      ),
    );
    expect(summary.lines[0]).toContain("needs no restart");
    expect(summary.tone).toBe("success");
  });
});
