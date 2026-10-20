import type { Notification, Notifier } from "./notifier.js";

/**
 * 사내 메신저 웹훅으로 알림을 보낸다.
 * 발송에 실패해도 예약 처리는 계속되도록, 메일 발송과 마찬가지로 오류 응답은 로그만 남긴다.
 */
export class WebhookNotifier implements Notifier {
  private readonly url: URL;

  constructor(
    url: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.url = new URL(url);
  }

  async notify(notification: Notification): Promise<void> {
    if (notification.recipients.length === 0) {
      return;
    }
    const response = await this.fetchFn(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: notification.subject,
        text: notification.body,
        recipients: notification.recipients,
      }),
    });
    if (!response.ok) {
      console.error(`[webhook] 발송 실패 status=${response.status} subject=${notification.subject}`);
    }
  }
}
