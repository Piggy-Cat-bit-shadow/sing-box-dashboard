import type { DesktopRemoteProfileUpdate } from "./desktop";
import type { Translate } from "./i18n";

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

/** The identity translator keeps the pure summarizer usable in tests and non-UI callers. */
const identityTranslate: Translate = (key, params) => {
  let text: string = key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
};

function withDetail(text: string, detail: string | undefined): string {
  return detail ? `${text}: ${detail}` : text;
}

function configText(update: DesktopRemoteProfileUpdate, t: Translate): string {
  const { status, detail } = update.config;
  switch (status) {
    case "unchanged":
      return t("Config unchanged");
    case "applied":
      return t("Config applied");
    case "saved":
      return t("Config saved; it applies on the next start");
    case "apply-failed":
      return withDetail(t("Config apply failed"), detail);
    case "apply-unconfirmed":
      return t("Config apply was not confirmed");
    case "invalid-config":
      return withDetail(t("Config rejected by validation"), detail);
    case "download-failed":
      return withDetail(t("Subscription download failed"), detail);
    case "superseded":
      return withDetail(t("Update superseded by a newer action"), detail);
  }
}

function providerText(update: DesktopRemoteProfileUpdate, t: Translate): string {
  const { status, counts, detail } = update.providers;
  const total = counts?.total ?? 0;
  switch (status) {
    case "published":
      // Only meaningful non-zero counts: "1 published, 0 unchanged" is noise, not a result.
      return (counts?.unchanged ?? 0) > 0
        ? t("Providers: {published} published, {unchanged} unchanged", {
            published: counts?.published ?? 0,
            unchanged: counts?.unchanged ?? 0,
          })
        : t("Providers: {published} published", { published: counts?.published ?? 0 });
    case "unchanged":
      return t("Providers unchanged");
    case "partial": {
      // A partial result can also contain outright failures. Folding them into "partial"
      // without saying so is how a failed source disappeared behind a pending one.
      const parts: string[] = [];
      if ((counts?.pending ?? 0) > 0) {
        parts.push(t("{pending} pending", { pending: counts?.pending ?? 0 }));
      }
      if ((counts?.restartRequired ?? 0) > 0) {
        parts.push(t("{restart} need a restart", { restart: counts?.restartRequired ?? 0 }));
      }
      if ((counts?.failed ?? 0) > 0) {
        parts.push(t("{failed} failed", { failed: counts?.failed ?? 0 }));
      }
      return parts.length > 0
        ? t("Providers partly applied: {detail}", { detail: parts.join(", ") })
        : t("Providers partly applied");
    }
    case "failed":
      // An unknown status makes the refresh fail without incrementing `failed`; "0 of 1 failed"
      // would contradict the detail that explains it.
      return withDetail(
        (counts?.failed ?? 0) > 0
          ? t("Providers failed: {failed} of {total}", {
              failed: counts?.failed ?? 0,
              total,
            })
          : t("Providers failed"),
        detail,
      );
    case "busy":
      return t("Provider refresh did not run: another refresh is in progress");
    case "cancelled":
      return t("Provider refresh was cancelled");
    case "box-changed":
      return withDetail(t("Provider refresh did not finish: the running instance changed"), detail);
    case "none":
      return t("The running config has no remote providers");
    case "not-active":
      return t("Providers not refreshed: the profile is not active");
    case "not-running":
      return t("Providers not refreshed: not connected");
    case "superseded":
      return withDetail(
        t("Providers not refreshed: a newer operation owns the instance"),
        detail,
      );
    case "unsupported":
      return t("Providers not refreshed: the running service does not support this refresh");
    case "unavailable":
      return withDetail(t("Provider refresh unavailable"), detail);
  }
}

/**
 * Turns the shell's structured result into the two lines the profile card shows.
 *
 * Both halves are always rendered, including the "nothing to refresh" reasons. The old UI could
 * only show a thrown error, so "profile saved but providers not refreshed" and "provider refresh
 * refused a group" were indistinguishable from a clean update.
 *
 * [t] is the existing catalog translator; the identity default keeps the function pure for tests.
 */
export function summarizeRemoteUpdate(
  update: DesktopRemoteProfileUpdate,
  t: Translate = identityTranslate,
): RemoteUpdateSummary {
  const configStatus = update.config.status;
  const providerStatus = update.providers.status;
  let tone: RemoteUpdateTone = "success";
  if (CONFIG_ERROR.has(configStatus) || PROVIDER_ERROR.has(providerStatus)) {
    tone = "error";
  } else if (CONFIG_WARNING.has(configStatus) || PROVIDER_WARNING.has(providerStatus)) {
    tone = "warning";
  }
  return {
    config: configText(update, t),
    providers: providerText(update, t),
    tone,
  };
}
