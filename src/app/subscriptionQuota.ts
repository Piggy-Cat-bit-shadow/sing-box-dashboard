import { formatBytes } from "../api/format";
import type { DesktopProfileSubscription } from "./desktop";
import type { Translate } from "./i18n";

/**
 * What the profile card can show, derived from the stored snapshot.
 *
 * Everything here is computed at render time from the raw numbers the provider sent. Only
 * the raw facts are persisted (see `ProfileSubscriptionQuota`), so a formatting change or a
 * fixed clamp takes effect for data that was already on disk instead of only for data written
 * after the fix.
 */
export interface SubscriptionQuotaDisplay {
  /** Bytes used, or `undefined` when the provider reported neither direction. */
  used?: number;
  /** Bytes left, or `undefined` when the provider sells no fixed quota. */
  remaining?: number;
  /** The quota total, present only when it is a usable positive number. */
  total?: number;
  /** The expiry date, or `undefined` when the provider sets none. */
  expiresAt?: Date;
  /** Whether `expiresAt` is in the past. */
  expired: boolean;
}

/**
 * Reads one field out of the snapshot, refusing anything that is not a usable number.
 *
 * The values arrive from a remote server, over IPC, from a database that may predate this
 * feature. `Number.isFinite` alone would let a negative through and `typeof x === "number"`
 * would let `NaN` through, and both would reach `formatBytes` and the arithmetic below.
 */
function quotaNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Derives what to show, or `undefined` when there is nothing worth showing.
 *
 * Returning `undefined` is the "no quota" answer, and the caller renders NOTHING for it -
 * no placeholder, no row of zeros, no "Unknown". A card that says `0 B / 0 B` because a
 * provider was silent is worse than a card that says nothing: it reads as a measurement.
 */
export function subscriptionQuotaDisplay(
  subscription: DesktopProfileSubscription | undefined,
  now: number,
): SubscriptionQuotaDisplay | undefined {
  if (subscription === undefined) {
    return undefined;
  }
  const upload = quotaNumber(subscription.upload);
  const download = quotaNumber(subscription.download);
  const total = quotaNumber(subscription.total);
  // A provider that reports a zero total is one with no fixed quota, not one with none left.
  const hasTotal = total !== undefined && total > 0;
  // `used` needs at least one direction to be a fact. Reporting 0 used for a provider that
  // reported nothing would understate real traffic.
  const used = upload === undefined && download === undefined
    ? undefined
    : (upload ?? 0) + (download ?? 0);
  // `expire: 0` is "no expiry", which most panels mean by it, and it is certainly not
  // 1970-01-01 - rendering that date would be a defect the user reads as data loss.
  const expiresAt =
    subscription.expire !== undefined && subscription.expire > 0
      ? new Date(subscription.expire * 1000)
      : undefined;
  const usableExpiry =
    expiresAt !== undefined && Number.isFinite(expiresAt.getTime()) ? expiresAt : undefined;

  const remaining = hasTotal ? Math.max(total - (used ?? 0), 0) : undefined;

  if (
    used === undefined &&
    remaining === undefined &&
    usableExpiry === undefined
  ) {
    return undefined;
  }
  const display: SubscriptionQuotaDisplay = {
    expired: usableExpiry !== undefined && usableExpiry.getTime() <= now,
  };
  if (used !== undefined) {
    display.used = used;
  }
  if (remaining !== undefined && hasTotal) {
    display.remaining = remaining;
    display.total = total;
  }
  if (usableExpiry !== undefined) {
    display.expiresAt = usableExpiry;
  }
  return display;
}

/**
 * The summary line: what is left out of what.
 *
 * Only facts that exist are named. A provider that reports usage but no quota gets "Used X",
 * not "Remaining ? / ?"; a provider that reports a quota but no usage gets "Remaining Y / Y",
 * which is true because nothing was reported as consumed.
 */
export function subscriptionQuotaSummary(
  display: SubscriptionQuotaDisplay,
  translate: Translate,
): string | undefined {
  if (display.remaining !== undefined && display.total !== undefined) {
    return translate("Remaining {remaining} / {total}", {
      remaining: formatBytes(display.remaining),
      total: formatBytes(display.total),
    });
  }
  if (display.used !== undefined) {
    return translate("Used {used}", { used: formatBytes(display.used) });
  }
  return undefined;
}

/** The expiry line, or `undefined` when the provider set no expiry. */
export function subscriptionQuotaExpiry(
  display: SubscriptionQuotaDisplay,
  language: string,
  translate: Translate,
): string | undefined {
  if (display.expiresAt === undefined) {
    return undefined;
  }
  const date = display.expiresAt.toLocaleDateString(language);
  return display.expired
    ? translate("Expired {date}", { date })
    : translate("Expires {date}", { date });
}
