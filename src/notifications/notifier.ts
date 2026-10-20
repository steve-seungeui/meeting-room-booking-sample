/**
 * 예약 알림을 보내는 통로. 예약 서비스와 리마인더 작업은 이 인터페이스로만 알림을 보낸다.
 */

export interface Notification {
  recipients: string[];
  subject: string;
  body: string;
}

export interface Notifier {
  notify(notification: Notification): Promise<void>;
}
