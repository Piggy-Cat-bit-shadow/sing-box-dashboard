import type {
  DesktopConfigRecoveryInfo,
  DesktopConfigurationDocument,
  DesktopProviderDomainReport,
  DesktopProviderRefreshResult,
  DesktopServiceChangePlan,
  DesktopServiceChangeReport,
} from "./desktop";

export type ConfigStatusTone = "success" | "warning" | "error";

export interface ConfigStatusSummary {
  lines: string[];
  tone: ConfigStatusTone;
}

/**
 * The revisions are profile-content hashes. Shown whole they are unreadable and push the line
 * that matters off the screen, so they are shortened to the part a person can compare by eye.
 * A value that is not a hash (the daemon is free to use any identifier) is kept as-is.
 */
export function formatRevision(revision: string | undefined): string {
  if (!revision) {
    return "";
  }
  return revision.length > 12 ? revision.slice(0, 12) : revision;
}

function revisionPair(current: string | undefined, target: string | undefined): string {
  if (current && target) {
    return `${formatRevision(current)} → ${formatRevision(target)}`;
  }
  if (target) {
    return formatRevision(target);
  }
  return current ? formatRevision(current) : "";
}

function planReasons(plan: DesktopServiceChangePlan): string[] {
  const reasons: string[] = [];
  // The section names are the caller's own vocabulary, so they are preferred over the generic
  // sentence; the sentence is only the fallback when the kernel names no section.
  if (plan.changedSections && plan.changedSections.length > 0) {
    reasons.push(plan.changedSections.join(", "));
  } else if (plan.changedDocument) {
    reasons.push("the document differs outside the live domains");
  }
  for (const domain of [plan.mode, plan.dns, plan.rule]) {
    if (domain?.restartRequired && domain.changes && domain.changes.length > 0) {
      reasons.push(`${domain.domain}: ${domain.changes.map((change) => change.kind).join(", ")}`);
    }
  }
  return reasons;
}

/**
 * What applying this document would mean.
 *
 * `started` means a Box is RUNNING right now; `started: false` is the first start. The order below
 * is the contract, and it is not the order the fields suggest:
 *
 *   unchanged  the running Box already runs this document, so nothing starts
 *   stale      the plan lost its base; it must be recomputed, whatever else it claims
 *   !started   the only case that starts a new instance
 *   restart    a running Box must be rebuilt, and the plan names why
 *   liveOnly   the running Box absorbs the change in place
 *
 * Reading `started` first, as an inverted "will start" flag, silently hid the live, restart and
 * stale branches behind one wrong sentence - the P1 this ordering fixes.
 */
export function summarizePlan(plan: DesktopServiceChangePlan): ConfigStatusSummary {
  if (plan.unchanged) {
    return {
      lines: [`Preview: the running service already runs revision ${formatRevision(plan.targetRevision) || "(same document)"}`],
      tone: "success",
    };
  }
  if (plan.stale) {
    return {
      lines: ["Preview: the running configuration changed while this plan was computed; refresh it before applying"],
      tone: "warning",
    };
  }
  if (!plan.started) {
    return {
      lines: [
        `Preview: this document would start a new instance (target revision ${formatRevision(plan.targetRevision) || "unknown"})`,
      ],
      tone: "warning",
    };
  }
  const versions = revisionPair(plan.currentRevision, plan.targetRevision);
  if (plan.restartRequired) {
    const reasons = planReasons(plan);
    return {
      lines: [
        `Preview: applying ${versions || "this document"} restarts the service` +
          (reasons.length > 0 ? ` (${reasons.join("; ")})` : ""),
      ],
      tone: "warning",
    };
  }
  if (plan.liveOnly) {
    return {
      lines: [`Preview: applying ${versions || "this document"} takes effect live, without a restart`],
      tone: "success",
    };
  }
  return {
    lines: [`Preview: applying ${versions || "this document"} needs no restart`],
    tone: "success",
  };
}

function providerResultLine(result: DesktopProviderRefreshResult): string {
  const details: string[] = [];
  if (result.pendingTags && result.pendingTags.length > 0) {
    details.push(`${result.pendingTags.length} pending`);
  }
  if (result.restartRequired) {
    details.push("restart required");
  }
  if (result.reason) {
    details.push(result.reason);
  }
  return `provider ${result.tag}: ${result.status}${details.length > 0 ? ` (${details.join("; ")})` : ""}`;
}

/**
 * The provider half of a report, one line per provider.
 *
 * Counts alone would hide which provider refused: the whole point of the per-tag results is that
 * "one of five failed" is actionable and "some providers failed" is not.
 */
function providerLines(provider: DesktopProviderDomainReport): string[] {
  const lines: string[] = [];
  const results = provider.results ?? [];
  for (const result of results) {
    lines.push(providerResultLine(result));
  }
  if (lines.length === 0) {
    lines.push(
      `providers: ${provider.status}` + (provider.reason ? ` (${provider.reason})` : ""),
    );
  }
  return lines;
}

const APPLY_STATUS: Readonly<Record<string, { text: string; tone: ConfigStatusTone }>> = {
  started: { text: "the service started on this document", tone: "success" },
  unchanged: { text: "the running document already matched", tone: "success" },
  applied_live: { text: "the change was applied live", tone: "success" },
  restarted: { text: "a new instance was started for the change", tone: "success" },
  recovered: { text: "the candidate failed and the previous document was restored", tone: "warning" },
  interrupted: { text: "the start was interrupted and nothing is running", tone: "error" },
  failed: { text: "the requested document is not what runs", tone: "error" },
};

/**
 * What the last apply attempt planned and did.
 *
 * `retained` and `persistence` are the two fields that make a report readable: a failed apply
 * that kept the previous configuration is a different event from a failed apply that left nothing
 * running, and a "degraded" persistence means a later failed start cannot return to what runs now.
 */
export function summarizeReport(report: DesktopServiceChangeReport): ConfigStatusSummary {
  const known = APPLY_STATUS[report.status];
  const lines: string[] = [
    `Last apply: ${known ? known.text : `unrecognised status "${report.status}"`}` +
      (report.reason ? ` (${report.reason})` : ""),
  ];
  let tone: ConfigStatusTone = known ? known.tone : "error";

  const active = report.activeRevision;
  const target = report.plan?.targetRevision;
  if (active) {
    lines.push(`Active revision: ${formatRevision(active)}${target && target !== active ? ` (target was ${formatRevision(target)})` : ""}`);
  } else if (report.status === "failed" || report.status === "interrupted") {
    lines.push("No revision is running");
  }

  if (report.retained) {
    lines.push("The configuration that was running before the attempt is still the one running");
    if (tone === "success") {
      tone = "warning";
    }
  }

  if (report.persistence === "degraded") {
    lines.push(
      "The last-good store is degraded: a later failed start cannot return to this document" +
        (report.persistenceWarning ? ` (${report.persistenceWarning})` : ""),
    );
    if (tone === "success") {
      tone = "warning";
    }
  } else if (report.persistence === "not_configured") {
    lines.push("No last-good store is configured: a failed start cannot be rolled back");
  } else if (report.persistenceWarning) {
    lines.push(report.persistenceWarning);
  }

  if (report.provider) {
    lines.push(...providerLines(report.provider));
  }

  return { lines, tone };
}

/**
 * The last recovery from a failed start.
 *
 * This is deliberately an error-toned event and not a neutral note: the service is running a
 * document the user did not ask for, and the reason is the only way to find out why.
 */
export function summarizeRecovery(recovery: DesktopConfigRecoveryInfo): ConfigStatusSummary {
  return {
    lines: [
      `Recovered at ${recovery.time}: ${formatRevision(recovery.failedRevision) || "the requested document"} failed, ` +
        `now running ${formatRevision(recovery.activeRevision) || "an unknown revision"}`,
      recovery.error,
    ],
    tone: "error",
  };
}

/**
 * Renders one of the three documents, keeping "no event" and "this kernel cannot say" apart.
 *
 * A silent `null` would be read as "nothing to report", which is exactly what an old daemon must
 * not be mistaken for. The caller supplies the words for each surface because "no plan yet" and
 * "no recovery yet" are different sentences.
 */
export function summarizeDocument<T>(
  document: DesktopConfigurationDocument<T>,
  render: (value: T) => ConfigStatusSummary,
  absentText: string,
  unsupportedText: string,
): ConfigStatusSummary {
  switch (document.kind) {
    case "document":
      return render(document.document);
    case "absent":
      return { lines: [absentText], tone: "success" };
    case "unsupported":
      return { lines: [unsupportedText], tone: "warning" };
  }
}
