import type { DesktopRemoteProfileUpdate } from "./desktop";

export type RemoteUpdateTone = "success" | "warning" | "error";

export interface RemoteUpdateSummary {
  config: string;
  providers: string;
  tone: RemoteUpdateTone;
}

const CONFIG_ERROR: ReadonlySet<DesktopRemoteProfileUpdate["config"]["status"]> = new Set([
  "apply-failed",
  "invalid-config",
  "download-failed",
]);
const CONFIG_WARNING: ReadonlySet<DesktopRemoteProfileUpdate["config"]["status"]> = new Set([
  "saved",
  "apply-unconfirmed",
  "superseded",
]);

const PROVIDER_ERROR: ReadonlySet<DesktopRemoteProfileUpdate["providers"]["status"]> = new Set([
  "failed",
  "partial",
  "box-changed",
  "cancelled",
  "busy",
  "unavailable",
]);
const PROVIDER_WARNING: ReadonlySet<DesktopRemoteProfileUpdate["providers"]["status"]> = new Set([
  "not-active",
  "not-running",
  "superseded",
  "unsupported",
]);

function withDetail(text: string, detail: string | undefined): string {
  return detail ? `${text}: ${detail}` : text;
}

function configText(update: DesktopRemoteProfileUpdate): string {
  const { status, detail } = update.config;
  switch (status) {
    case "unchanged":
      return "Config unchanged";
    case "applied":
      return "Config applied on a new instance";
    case "saved":
      return "Config saved; it applies on the next start";
    case "apply-failed":
      return withDetail("Config apply failed", detail);
    case "apply-unconfirmed":
      return "Config apply was not confirmed by the daemon";
    case "invalid-config":
      return withDetail("Config rejected by validation", detail);
    case "download-failed":
      return withDetail("Subscription download failed", detail);
    case "superseded":
      return withDetail("Update superseded by a newer action", detail);
  }
}

function providerText(update: DesktopRemoteProfileUpdate): string {
  const { status, counts, detail } = update.providers;
  const total = counts?.total ?? 0;
  switch (status) {
    case "published":
      return total === 1
        ? "Providers: 1 published"
        : `Providers: ${counts?.published ?? 0} published, ${counts?.unchanged ?? 0} unchanged`;
    case "unchanged":
      return "Providers unchanged";
    case "partial":
      return (
        `Providers partly applied: ${counts?.pending ?? 0} pending` +
        (counts && counts.restartRequired > 0 ? `, ${counts.restartRequired} need a restart` : "")
      );
    case "failed":
      return withDetail(
        `Providers failed: ${counts?.failed ?? 0} of ${total}`,
        detail,
      );
    case "busy":
      return "Providers busy; the refresh did not run";
    case "cancelled":
      return "Provider refresh cancelled";
    case "box-changed":
      return withDetail("Provider refresh crossed two Box instances", detail);
    case "none":
      return "The running config has no remote providers";
    case "not-active":
      return "Providers not refreshed: the profile is not active";
    case "not-running":
      return "Providers not refreshed: not connected";
    case "superseded":
      return withDetail("Providers not refreshed: a newer operation owns the instance", detail);
    case "unsupported":
      return "Providers not refreshed: the daemon predates the provider refresh RPC";
    case "unavailable":
      return withDetail("Provider refresh unavailable", detail);
  }
}

/**
 * Turns the shell's structured result into the two lines the profile card shows.
 *
 * Both halves are always rendered, including the "nothing to refresh" reasons. The old UI could
 * only show a thrown error, so "profile saved but providers not refreshed" and "provider refresh
 * refused a group" were indistinguishable from a clean update.
 */
export function summarizeRemoteUpdate(update: DesktopRemoteProfileUpdate): RemoteUpdateSummary {
  const configStatus = update.config.status;
  const providerStatus = update.providers.status;
  let tone: RemoteUpdateTone = "success";
  if (CONFIG_ERROR.has(configStatus) || PROVIDER_ERROR.has(providerStatus)) {
    tone = "error";
  } else if (CONFIG_WARNING.has(configStatus) || PROVIDER_WARNING.has(providerStatus)) {
    tone = "warning";
  }
  return { config: configText(update), providers: providerText(update), tone };
}
