// Which selection attempt a confirmation belongs to.
//
// The groups page used to settle a selection by tags: `api.selectOutbound(group, item)` and a
// pending value keyed by nothing. Two clicks on one group were two unawaited promises, and a
// late answer for the first could clear or keep the second's pending value; a failure only cleared
// it by hand. The daemon's response now carries the caller's request id, the member the group
// actually holds and the group revision after the selection, so the page can decide per attempt.
//
// Pure values, no React and no generated protobuf: the rules are testable with `vitest` without a
// daemon.

export interface SelectionSnapshot {
  readonly groupTag: string;
  readonly outboundTag: string;
  readonly requestId: bigint;
  readonly expectedRevision: bigint;
}

export interface SelectionResponse {
  readonly requestId: bigint;
  readonly appliedOutboundTag: string;
  readonly appliedRevision: bigint;
  readonly stale: boolean;
}

export type SelectionSettlement =
  | { readonly kind: "applied"; readonly outboundTag: string; readonly revision: bigint; readonly stale: boolean }
  | { readonly kind: "unconfirmed"; readonly reason: string }
  | { readonly kind: "ignored-older-request"; readonly latestRequestId: bigint }
  | { readonly kind: "ignored-older-revision"; readonly latestRevision: bigint }
  | { readonly kind: "failed"; readonly reason: string };

export class SelectionLedger {
  private readonly pending = new Map<string, { requestId: bigint; outboundTag: string }>();
  private readonly appliedRevisions = new Map<string, bigint>();
  private nextRequestId = 0n;

  begin(groupTag: string, outboundTag: string): SelectionSnapshot {
    this.nextRequestId += 1n;
    const snapshot: SelectionSnapshot = {
      groupTag,
      outboundTag,
      requestId: this.nextRequestId,
      expectedRevision: this.appliedRevisions.get(groupTag) ?? 0n,
    };
    this.pending.set(groupTag, { requestId: snapshot.requestId, outboundTag });
    return snapshot;
  }

  pendingSelection(groupTag: string): { readonly requestId: bigint; readonly outboundTag: string } | null {
    return this.pending.get(groupTag) ?? null;
  }

  appliedRevision(groupTag: string): bigint {
    return this.appliedRevisions.get(groupTag) ?? 0n;
  }

  settle(snapshot: SelectionSnapshot, response: SelectionResponse): SelectionSettlement {
    const current = this.pending.get(snapshot.groupTag);
    if (current === undefined || current.requestId !== snapshot.requestId) {
      return { kind: "ignored-older-request", latestRequestId: current?.requestId ?? snapshot.requestId };
    }
    if (response.requestId !== snapshot.requestId) {
      this.pending.delete(snapshot.groupTag);
      return { kind: "unconfirmed", reason: `the daemon answered request ${response.requestId}, not ${snapshot.requestId}` };
    }
    if (!response.appliedOutboundTag) {
      this.pending.delete(snapshot.groupTag);
      return { kind: "unconfirmed", reason: "the daemon did not name the member the group holds" };
    }
    const latestRevision = this.appliedRevisions.get(snapshot.groupTag) ?? 0n;
    if (response.appliedRevision < latestRevision) {
      this.pending.delete(snapshot.groupTag);
      return { kind: "ignored-older-revision", latestRevision };
    }
    this.pending.delete(snapshot.groupTag);
    this.appliedRevisions.set(snapshot.groupTag, response.appliedRevision);
    return { kind: "applied", outboundTag: response.appliedOutboundTag, revision: response.appliedRevision, stale: response.stale };
  }

  fail(snapshot: SelectionSnapshot, reason: string): SelectionSettlement {
    const current = this.pending.get(snapshot.groupTag);
    if (current === undefined || current.requestId !== snapshot.requestId) {
      return { kind: "ignored-older-request", latestRequestId: current?.requestId ?? snapshot.requestId };
    }
    this.pending.delete(snapshot.groupTag);
    return { kind: "failed", reason };
  }
}
