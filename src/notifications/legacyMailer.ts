/**
 * 사내 메일 릴레이로 알림 메일을 보내는 모듈.
 *
 * 초기 버전부터 쓰던 모듈로, 예약 서비스와 리마인더 작업이 직접 호출한다.
 * 메일 릴레이 서버가 없는 개발 환경에서는 메일 내용을 콘솔에 출력한다.
 */

export interface MailMessage {
  to: string[];
  subject: string;
  body: string;
}

const RELAY_HOST = process.env.MAIL_RELAY_HOST;
const SENDER = process.env.MAIL_SENDER ?? "meeting-rooms@example.com";

const sentLog: MailMessage[] = [];

export async function sendMail(message: MailMessage): Promise<void> {
  if (message.to.length === 0) {
    return;
  }
  if (process.env.NODE_ENV === "test") {
    sentLog.push(message);
    return;
  }
  if (!RELAY_HOST) {
    console.log(`[mail] from=${SENDER} to=${message.to.join(",")} subject=${message.subject}\n${message.body}`);
    return;
  }
  // 운영 환경의 메일 릴레이는 HTTP로 메일 발송 요청을 받는다.
  const response = await fetch(`https://${RELAY_HOST}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: SENDER, ...message }),
  });
  if (!response.ok) {
    console.error(`[mail] 발송 실패 status=${response.status} subject=${message.subject}`);
  }
}

/** 테스트에서 발송된 메일을 확인할 때 쓴다. */
export function sentMails(): readonly MailMessage[] {
  return sentLog;
}

export function clearSentMails(): void {
  sentLog.length = 0;
}
