import { describe, expect, it } from "vitest";

import { SelectionLedger } from "./selectionLedger";

function readBack(requestId: bigint, outboundTag = "member-b", appliedRevision = 7n, stale = false) {
  return { requestId, appliedOutboundTag: outboundTag, appliedRevision, stale };
}

describe("SelectionLedger", () => {
  it("applies the member the group holds, not the member that was requested", () => {
    const ledger = new SelectionLedger();
    const snapshot = ledger.begin("group-a", "member-b");
    expect(ledger.settle(snapshot, readBack(snapshot.requestId, "member-c", 7n))).toEqual({
      kind: "applied",
      outboundTag: "member-c",
      revision: 7n,
      stale: false,
    });
    expect(ledger.pendingSelection("group-a")).toBeNull();
    expect(ledger.appliedRevision("group-a")).toBe(7n);
  });

  it("carries the last applied revision as the next attempt's expectation", () => {
    const ledger = new SelectionLedger();
    const first = ledger.begin("group-a", "member-b");
    ledger.settle(first, readBack(first.requestId, "member-b", 9n));
    const second = ledger.begin("group-a", "member-c");
    expect(second.expectedRevision).toBe(9n);
    expect(second.requestId).not.toBe(first.requestId);
  });

  it("ignores the answer of a replaced attempt", () => {
    const ledger = new SelectionLedger();
    const first = ledger.begin("group-a", "member-b");
    const second = ledger.begin("group-a", "member-c");
    expect(ledger.settle(first, readBack(first.requestId, "member-b"))).toEqual({
      kind: "ignored-older-request",
      latestRequestId: second.requestId,
    });
    expect(ledger.pendingSelection("group-a")?.outboundTag).toBe("member-c");
  });

  it("ignores an answer older than a revision already applied", () => {
    const ledger = new SelectionLedger();
    const first = ledger.begin("group-a", "member-b");
    ledger.settle(first, readBack(first.requestId, "member-b", 9n));
    const second = ledger.begin("group-a", "member-c");
    expect(ledger.settle(second, readBack(second.requestId, "member-c", 8n))).toEqual({
      kind: "ignored-older-revision",
      latestRevision: 9n,
    });
    expect(ledger.appliedRevision("group-a")).toBe(9n);
  });

  it("treats a daemon without identity as unconfirmed, never as success", () => {
    const ledger = new SelectionLedger();
    const snapshot = ledger.begin("group-a", "member-b");
    // An old daemon answers the token-less message: id 0 and no applied member.
    const settlement = ledger.settle(snapshot, readBack(0n, "", 0n));
    expect(settlement.kind).toBe("unconfirmed");
    expect(ledger.pendingSelection("group-a")).toBeNull();
    expect(ledger.appliedRevision("group-a")).toBe(0n);
  });

  it("does not let a failure for a replaced attempt clear the newer one", () => {
    const ledger = new SelectionLedger();
    const first = ledger.begin("group-a", "member-b");
    const second = ledger.begin("group-a", "member-c");
    expect(ledger.fail(first, "connection reset")).toEqual({
      kind: "ignored-older-request",
      latestRequestId: second.requestId,
    });
    expect(ledger.pendingSelection("group-a")?.requestId).toBe(second.requestId);
  });

  it("clears the pending overlay when the latest attempt fails", () => {
    const ledger = new SelectionLedger();
    const snapshot = ledger.begin("group-a", "member-b");
    expect(ledger.fail(snapshot, "timeout")).toEqual({ kind: "failed", reason: "timeout" });
    expect(ledger.pendingSelection("group-a")).toBeNull();
  });
});
