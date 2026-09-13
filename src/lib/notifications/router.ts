import { getEnv } from "@/config/env";
import { LogEmailProvider } from "@/lib/notifications/providers/log-email";
import { ResendEmailProvider } from "@/lib/notifications/providers/resend-email";
import type { NotificationProvider } from "@/lib/notifications/types";

export function getNotificationProvider(
  override?: NotificationProvider,
): NotificationProvider {
  if (override) return override;

  const env = getEnv();
  if (env.NOTIFICATION_PROVIDER === "resend") {
    return new ResendEmailProvider();
  }
  return new LogEmailProvider();
}
