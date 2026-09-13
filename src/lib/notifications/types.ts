export type NotificationChannel = "email";

export type NotificationMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Opaque correlation id for delivery logs. */
  correlationId?: string;
  headers?: Record<string, string>;
};

export type NotificationSendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

/**
 * Transport-agnostic notification sender.
 * News retrieval / AI stay outside this boundary.
 */
export interface NotificationProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(message: NotificationMessage): Promise<NotificationSendResult>;
}
