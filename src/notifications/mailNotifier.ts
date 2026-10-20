import { sendMail } from "./legacyMailer.js";
import type { Notification, Notifier } from "./notifier.js";

/** 사내 메일 릴레이로 알림을 보낸다. */
export class MailNotifier implements Notifier {
  async notify(notification: Notification): Promise<void> {
    await sendMail({
      to: notification.recipients,
      subject: notification.subject,
      body: notification.body,
    });
  }
}
