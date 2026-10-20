import { MailNotifier } from "./mailNotifier.js";
import type { Notifier } from "./notifier.js";
import { WebhookNotifier } from "./webhookNotifier.js";

/** MESSENGER_WEBHOOK_URL이 있으면 메신저 웹훅으로, 없으면 메일로 알림을 보낸다. */
export function createNotifier(env: NodeJS.ProcessEnv = process.env): Notifier {
  const webhookUrl = env.MESSENGER_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    return new WebhookNotifier(webhookUrl);
  }
  return new MailNotifier();
}
