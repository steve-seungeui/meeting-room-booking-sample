import { describe, expect, it, vi } from "vitest";
import { createNotifier } from "../src/notifications/createNotifier.js";
import { MailNotifier } from "../src/notifications/mailNotifier.js";
import { WebhookNotifier } from "../src/notifications/webhookNotifier.js";

const notification = {
  recipients: ["kim@example.com", "lee@example.com"],
  subject: "[회의실 예약] 주간 회의",
  body: "백두(3층) 회의실 예약이 확정되었습니다.",
};

function fakeFetch(status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(null, { status }));
}

describe("WebhookNotifier", () => {
  it("웹훅 주소로 제목, 본문, 수신자를 JSON으로 보낸다", async () => {
    const fetchFn = fakeFetch();
    const notifier = new WebhookNotifier("https://messenger.example.com/hooks/abc", fetchFn);

    await notifier.notify(notification);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe("https://messenger.example.com/hooks/abc");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "[회의실 예약] 주간 회의",
      text: "백두(3층) 회의실 예약이 확정되었습니다.",
      recipients: ["kim@example.com", "lee@example.com"],
    });
  });

  it("수신자가 없으면 보내지 않는다", async () => {
    const fetchFn = fakeFetch();
    const notifier = new WebhookNotifier("https://messenger.example.com/hooks/abc", fetchFn);

    await notifier.notify({ ...notification, recipients: [] });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("오류 응답을 받으면 예외 없이 로그만 남긴다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifier = new WebhookNotifier("https://messenger.example.com/hooks/abc", fakeFetch(500));

    await expect(notifier.notify(notification)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("status=500"));
    error.mockRestore();
  });

  it("주소 형식이 잘못되면 만들 때 바로 실패한다", () => {
    expect(() => new WebhookNotifier("not a url")).toThrow();
  });
});

describe("createNotifier", () => {
  it("MESSENGER_WEBHOOK_URL이 있으면 웹훅으로 보낸다", () => {
    const notifier = createNotifier({ MESSENGER_WEBHOOK_URL: "https://messenger.example.com/hooks/abc" });

    expect(notifier).toBeInstanceOf(WebhookNotifier);
  });

  it("MESSENGER_WEBHOOK_URL이 없거나 비어 있으면 메일로 보낸다", () => {
    expect(createNotifier({})).toBeInstanceOf(MailNotifier);
    expect(createNotifier({ MESSENGER_WEBHOOK_URL: "  " })).toBeInstanceOf(MailNotifier);
  });
});
