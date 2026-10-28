import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailMessage } from "../src/notifications/legacyMailer.js";

type LegacyMailer = typeof import("../src/notifications/legacyMailer.js");

// MAIL_RELAY_HOST, MAIL_SENDER, MAIL_RELAY_TOKEN은 모듈을 불러올 때 읽으므로, 환경을 바꾼 뒤 모듈을 새로 불러온다.
// 지정하지 않은 값은 비워 두어, 개발자나 CI의 환경 변수에 영향받지 않게 한다.
async function loadMailer(env: Record<string, string | undefined>): Promise<LegacyMailer> {
  const merged = { MAIL_RELAY_HOST: undefined, MAIL_SENDER: undefined, MAIL_RELAY_TOKEN: undefined, ...env };
  for (const [key, value] of Object.entries(merged)) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  return import("../src/notifications/legacyMailer.js");
}

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    to: ["kim@example.com", "lee@example.com"],
    subject: "회의실 예약 확정",
    body: "302호 회의실 10:00~11:00",
    ...overrides,
  };
}

function okResponse(): Response {
  return new Response(null, { status: 200 });
}

describe("sendMail", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // 어떤 경우에도 실제 네트워크 요청이 나가지 않도록 fetch를 항상 가짜로 바꿔 둔다.
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("테스트 환경 (NODE_ENV=test)", () => {
    it("수신자가 없으면 기록하지 않는다", async () => {
      const mailer = await loadMailer({ NODE_ENV: "test", MAIL_RELAY_HOST: "relay.example.com" });

      await mailer.sendMail(message({ to: [] }));

      expect(mailer.sentMails()).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("보낸 메일을 순서대로 sentMails()에 기록하고 릴레이로 보내지 않는다", async () => {
      const mailer = await loadMailer({ NODE_ENV: "test", MAIL_RELAY_HOST: "relay.example.com" });

      await mailer.sendMail(message({ subject: "첫 번째" }));
      await mailer.sendMail(message({ subject: "두 번째" }));

      expect(mailer.sentMails().map((mail) => mail.subject)).toEqual(["첫 번째", "두 번째"]);
      expect(mailer.sentMails()[0]).toEqual(message({ subject: "첫 번째" }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it("clearSentMails()를 호출하면 기록이 비워지고 이후 메일은 새로 기록된다", async () => {
      const mailer = await loadMailer({ NODE_ENV: "test" });
      await mailer.sendMail(message({ subject: "지워질 메일" }));

      mailer.clearSentMails();
      expect(mailer.sentMails()).toEqual([]);

      await mailer.sendMail(message({ subject: "새 메일" }));
      expect(mailer.sentMails().map((mail) => mail.subject)).toEqual(["새 메일"]);
    });

    it("모듈을 새로 불러오면 이전 테스트의 기록이 남아 있지 않다", async () => {
      const first = await loadMailer({ NODE_ENV: "test" });
      await first.sendMail(message());
      expect(first.sentMails()).toHaveLength(1);

      const second = await loadMailer({ NODE_ENV: "test" });
      expect(second.sentMails()).toEqual([]);
    });
  });

  describe("릴레이가 없는 개발 환경", () => {
    it("수신자가 없으면 콘솔에도 출력하지 않는다", async () => {
      const mailer = await loadMailer({ NODE_ENV: "development", MAIL_RELAY_HOST: undefined });

      await mailer.sendMail(message({ to: [] }));

      expect(log).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("MAIL_SENDER가 없으면 기본 발신자로 메일 내용을 콘솔에 출력한다", async () => {
      const mailer = await loadMailer({
        NODE_ENV: "development",
        MAIL_RELAY_HOST: undefined,
        MAIL_SENDER: undefined,
      });

      await mailer.sendMail(message());

      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        "[mail] from=meeting-rooms@example.com to=kim@example.com,lee@example.com subject=회의실 예약 확정\n302호 회의실 10:00~11:00",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mailer.sentMails()).toEqual([]);
    });

    it("MAIL_SENDER가 있으면 그 주소를 발신자로 출력한다", async () => {
      const mailer = await loadMailer({
        NODE_ENV: "development",
        MAIL_RELAY_HOST: undefined,
        MAIL_SENDER: "rooms@corp.example.com",
      });

      await mailer.sendMail(message());

      expect(log).toHaveBeenCalledWith(expect.stringContaining("[mail] from=rooms@corp.example.com "));
    });

    it("MAIL_RELAY_HOST가 빈 문자열이면 릴레이가 없는 것으로 보고 콘솔에 출력한다", async () => {
      const mailer = await loadMailer({ NODE_ENV: "development", MAIL_RELAY_HOST: "" });

      await mailer.sendMail(message());

      expect(log).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("MAIL_RELAY_TOKEN이 있어도 콘솔 출력에 토큰을 남기지 않는다", async () => {
      const mailer = await loadMailer({
        NODE_ENV: "development",
        MAIL_RELAY_HOST: undefined,
        MAIL_RELAY_TOKEN: "test-token-123",
      });

      await mailer.sendMail(message());

      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain("test-token-123");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("모듈을 불러온 뒤에 바꾼 환경 변수는 반영하지 않는다", async () => {
      const mailer = await loadMailer({ NODE_ENV: "development", MAIL_RELAY_HOST: undefined, MAIL_SENDER: undefined });
      vi.stubEnv("MAIL_RELAY_HOST", "relay.example.com");
      vi.stubEnv("MAIL_SENDER", "late@example.com");

      await mailer.sendMail(message());

      expect(fetchMock).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("from=meeting-rooms@example.com"));
    });
  });

  describe("릴레이가 있는 운영 환경", () => {
    it("수신자가 없으면 릴레이에 요청하지 않는다", async () => {
      const mailer = await loadMailer({ NODE_ENV: "production", MAIL_RELAY_HOST: "relay.example.com" });

      await mailer.sendMail(message({ to: [] }));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("https://<host>/send로 JSON 본문을 POST한다", async () => {
      const mailer = await loadMailer({
        NODE_ENV: "production",
        MAIL_RELAY_HOST: "relay.example.com",
        MAIL_SENDER: undefined,
      });

      await mailer.sendMail(message());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://relay.example.com/send");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "content-type": "application/json" });
      expect(JSON.parse(init.body as string)).toEqual({
        from: "meeting-rooms@example.com",
        to: ["kim@example.com", "lee@example.com"],
        subject: "회의실 예약 확정",
        body: "302호 회의실 10:00~11:00",
      });
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(mailer.sentMails()).toEqual([]);
    });

    it("MAIL_SENDER가 있으면 요청 본문의 from에 그 주소를 넣는다", async () => {
      const mailer = await loadMailer({
        NODE_ENV: "production",
        MAIL_RELAY_HOST: "relay.example.com",
        MAIL_SENDER: "rooms@corp.example.com",
      });

      await mailer.sendMail(message());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string).from).toBe("rooms@corp.example.com");
    });

    it("MAIL_RELAY_TOKEN이 있으면 Authorization: Bearer 헤더로 보낸다", async () => {
      const mailer = await loadMailer({
        NODE_ENV: "production",
        MAIL_RELAY_HOST: "relay.example.com",
        MAIL_RELAY_TOKEN: "test-token-123",
      });

      await mailer.sendMail(message());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.headers).toEqual({
        "content-type": "application/json",
        authorization: "Bearer test-token-123",
      });
    });

    it("토큰은 요청 본문에 넣지 않는다", async () => {
      const mailer = await loadMailer({
        NODE_ENV: "production",
        MAIL_RELAY_HOST: "relay.example.com",
        MAIL_RELAY_TOKEN: "test-token-123",
      });

      await mailer.sendMail(message());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.body as string).not.toContain("test-token-123");
    });

    it("MAIL_RELAY_TOKEN이 없거나 빈 문자열이면 Authorization 헤더를 넣지 않는다", async () => {
      for (const token of [undefined, ""]) {
        fetchMock.mockClear();
        const mailer = await loadMailer({
          NODE_ENV: "production",
          MAIL_RELAY_HOST: "relay.example.com",
          MAIL_RELAY_TOKEN: token,
        });

        await mailer.sendMail(message());

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.headers).toEqual({ "content-type": "application/json" });
      }
    });

    it("릴레이가 토큰을 거절(401)하면 console.error로 남기고 토큰은 로그에 남기지 않는다", async () => {
      const mailer = await loadMailer({
        NODE_ENV: "production",
        MAIL_RELAY_HOST: "relay.example.com",
        MAIL_RELAY_TOKEN: "test-token-123",
      });
      fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

      await expect(mailer.sendMail(message())).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith("[mail] 발송 실패 status=401 subject=회의실 예약 확정");
      expect(JSON.stringify(error.mock.calls)).not.toContain("test-token-123");
    });

    it("모듈을 불러온 뒤에 바꾼 MAIL_RELAY_TOKEN은 반영하지 않는다", async () => {
      const mailer = await loadMailer({ NODE_ENV: "production", MAIL_RELAY_HOST: "relay.example.com" });
      vi.stubEnv("MAIL_RELAY_TOKEN", "late-token");

      await mailer.sendMail(message());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.headers).toEqual({ "content-type": "application/json" });
    });

    it("릴레이가 실패 응답을 주면 console.error로 남기고 예외를 던지지 않는다", async () => {
      const mailer = await loadMailer({ NODE_ENV: "production", MAIL_RELAY_HOST: "relay.example.com" });
      fetchMock.mockResolvedValueOnce(new Response("relay down", { status: 503 }));

      await expect(mailer.sendMail(message())).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith("[mail] 발송 실패 status=503 subject=회의실 예약 확정");
    });

    // 버그: 기대 동작은 실패 응답(!response.ok)과 마찬가지로 console.error로 남기고 정상 종료하는 것이다.
    // 실제 동작은 fetch의 reject(DNS 실패, 연결 거부 등)가 그대로 호출자에게 전파된다.
    // 예약 서비스는 DB 저장 뒤 sendMail을 await하므로 예약은 저장되었는데 API는 500을 돌려주고,
    // 리마인더 작업은 markReminded를 남긴 뒤 중단되어 그 예약과 남은 예약의 리마인더가 영영 나가지 않는다.
    it.fails("fetch가 reject되어도 console.error로 남기고 예외를 던지지 않는다", async () => {
      const mailer = await loadMailer({ NODE_ENV: "production", MAIL_RELAY_HOST: "relay.example.com" });
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(mailer.sendMail(message())).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("[mail] 발송 실패"));
    });
  });
});
