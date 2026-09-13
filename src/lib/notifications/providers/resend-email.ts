import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import type {
  NotificationMessage,
  NotificationProvider,
  NotificationSendResult,
} from "@/lib/notifications/types";

/**
 * Resend HTTP email provider (no LLM; transport only).
 * https://resend.com/docs/api-reference/emails/send-email
 */
export class ResendEmailProvider implements NotificationProvider {
  readonly name = "resend_email";

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
  }

  async send(message: NotificationMessage): Promise<NotificationSendResult> {
    const env = getEnv();
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      return { ok: false, error: "Resend email provider is not configured" };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
        }),
        signal: AbortSignal.timeout(env.EMAIL_PROVIDER_TIMEOUT_MS),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        name?: string;
      };

      if (!response.ok) {
        const error =
          payload.message || payload.name || `Resend HTTP ${response.status}`;
        logger.warn("Resend email send failed", {
          to: message.to,
          status: response.status,
          error,
        });
        return { ok: false, error };
      }

      return { ok: true, providerMessageId: payload.id };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.warn("Resend email send errored", {
        to: message.to,
        error: messageText,
      });
      return { ok: false, error: messageText };
    }
  }
}
