import { describe, expect, it } from "vitest";
import {
  isEmailDeliveryDue,
  localPartsForTimezone,
} from "@/lib/notifications/schedule";

describe("email delivery schedule", () => {
  it("reads local parts in a timezone", () => {
    const now = new Date("2026-09-13T10:30:00.000Z");
    const utc = localPartsForTimezone(now, "UTC");
    expect(utc.date).toBe("2026-09-13");
    expect(utc.hour).toBe(10);
    expect(utc.minute).toBe(30);
  });

  it("marks delivery due at/after configured local time", () => {
    const now = new Date("2026-09-13T06:00:00.000Z");
    const due = isEmailDeliveryDue({
      now,
      timezone: "UTC",
      deliveryHour: 6,
      deliveryMinute: 0,
    });
    expect(due.due).toBe(true);
    expect(due.localDate).toBe("2026-09-13");

    const early = isEmailDeliveryDue({
      now: new Date("2026-09-13T05:59:00.000Z"),
      timezone: "UTC",
      deliveryHour: 6,
      deliveryMinute: 0,
    });
    expect(early.due).toBe(false);
  });
});
