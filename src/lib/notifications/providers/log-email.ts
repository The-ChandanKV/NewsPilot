import { logger } from "@/lib/logger";
import type {
  NotificationMessage,
  NotificationProvider,
  NotificationSendResult,
} from "@/lib/notifications/types";

/**
 * Dev/test email provider — never hits the network.
 * Logs the rendered DailyBriefing email payload.
 */
export class LogEmailProvider implements NotificationProvider {
  readonly name = "log_email";

  isConfigured(): boolean {
    return true;
  }

  async send(message: NotificationMessage): Promise<NotificationSendResult> {
    logger.info("Email notification (log provider)", {
      to: message.to,
      subject: message.subject,
      correlationId: message.correlationId,
      textPreview: message.text.slice(0, 240),
    });
    return {
      ok: true,
      providerMessageId: `log-${message.correlationId ?? Date.now()}`,
    };
  }
}
