/**
 * Local calendar parts for an IANA timezone.
 */
export function localPartsForTimezone(
  now: Date,
  timeZone: string,
): { date: string; hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);

    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;

    if (year && month && day && hour !== undefined && minute !== undefined) {
      return {
        date: `${year}-${month}-${day}`,
        hour: Number(hour),
        minute: Number(minute),
      };
    }
  } catch {
    // fall through to UTC
  }

  return {
    date: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`,
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
  };
}

/**
 * Whether the subscription's local clock is at/past its configured delivery time.
 */
export function isEmailDeliveryDue(options: {
  now: Date;
  timezone: string;
  deliveryHour: number;
  deliveryMinute: number;
}): { due: boolean; localDate: string; localHour: number; localMinute: number } {
  const local = localPartsForTimezone(options.now, options.timezone);
  const dueMinutes = options.deliveryHour * 60 + options.deliveryMinute;
  const nowMinutes = local.hour * 60 + local.minute;
  return {
    due: nowMinutes >= dueMinutes,
    localDate: local.date,
    localHour: local.hour,
    localMinute: local.minute,
  };
}

export function buildUnsubscribeUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}
