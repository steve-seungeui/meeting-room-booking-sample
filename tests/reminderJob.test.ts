import { beforeEach, describe, expect, it } from "vitest";
import { createServices } from "../src/app.js";
import { runReminderJob } from "../src/jobs/reminderJob.js";
import { clearSentMails, sentMails } from "../src/notifications/legacyMailer.js";
import type { NewReservation } from "../src/reservations/reservation.js";
import { fixedClock } from "../src/shared/clock.js";

const NOW = "2026-11-02T08:00:00+09:00";
const at = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);

function meeting(overrides: Partial<NewReservation> = {}): NewReservation {
  return {
    roomId: "room-302",
    title: "디자인 리뷰",
    organizer: "kim@example.com",
    attendees: ["lee@example.com", "park@example.com"],
    start: at("2026-11-02", "10:00"),
    end: at("2026-11-02", "11:00"),
    ...overrides,
  };
}

describe("runReminderJob", () => {
  let services: ReturnType<typeof createServices>;

  /** 같은 저장소를 쓰면서 지정한 시각에 리마인더 작업을 실행한다. */
  function runAt(iso: string) {
    const later = createServices({
      reservationRepository: services.reservationRepository,
      seriesRepository: services.seriesRepository,
      clock: fixedClock(iso),
    });
    return runReminderJob(later.reservationRepository, later.roomService, later.clock);
  }

  beforeEach(() => {
    clearSentMails();
    services = createServices({ clock: fixedClock(NOW) });
  });

  it("10분 안에 시작하는 확정 예약의 주최자와 참석자에게 알림을 한 번 보낸다", async () => {
    const reservation = await services.reservationService.create(meeting());
    clearSentMails();

    const sent = await runAt("2026-11-02T09:55:00+09:00");

    expect(sent).toBe(1);
    expect(sentMails()).toHaveLength(1);
    expect(sentMails()[0].to).toEqual(["kim@example.com", "lee@example.com", "park@example.com"]);
    expect(sentMails()[0].subject).toBe("[곧 시작] 디자인 리뷰");
    expect(sentMails()[0].body).toContain("백두(3층)");
    const saved = await services.reservationRepository.findById(reservation.id);
    expect(saved?.remindedAt).toEqual(new Date("2026-11-02T09:55:00+09:00"));
  });

  it("취소된 예약에는 보내지 않는다", async () => {
    const reservation = await services.reservationService.create(meeting());
    await services.reservationService.cancel(reservation.id, "kim@example.com");
    clearSentMails();

    const sent = await runAt("2026-11-02T09:55:00+09:00");

    expect(sent).toBe(0);
    expect(sentMails()).toHaveLength(0);
  });

  it("이미 알림을 보낸 예약에는 다시 보내지 않는다", async () => {
    await services.reservationService.create(meeting());
    clearSentMails();

    const first = await runAt("2026-11-02T09:52:00+09:00");
    const second = await runAt("2026-11-02T09:53:00+09:00");

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(sentMails()).toHaveLength(1);
  });

  it("10분보다 뒤에 시작하는 예약에는 아직 보내지 않는다", async () => {
    await services.reservationService.create(meeting());
    clearSentMails();

    const early = await runAt("2026-11-02T09:49:00+09:00");

    expect(early).toBe(0);
    expect(sentMails()).toHaveLength(0);

    // 10분 안으로 들어오면 보낸다
    const due = await runAt("2026-11-02T09:51:00+09:00");

    expect(due).toBe(1);
    expect(sentMails()).toHaveLength(1);
  });

  it("반복 예약의 회차는 회차마다 알림을 받는다", async () => {
    const { occurrences } = await services.seriesService.create({
      ...meeting({ title: "주간 회의" }),
      recurrence: { frequency: "weekly", count: 3 },
    });
    clearSentMails();

    const sentPerRun: number[] = [];
    for (const date of ["2026-11-02", "2026-11-09", "2026-11-16"]) {
      sentPerRun.push(await runAt(`${date}T09:55:00+09:00`));
      // 같은 회차를 1분 뒤에 다시 확인해도 중복 발송하지 않는다
      sentPerRun.push(await runAt(`${date}T09:56:00+09:00`));
    }

    expect(sentPerRun).toEqual([1, 0, 1, 0, 1, 0]);
    expect(sentMails()).toHaveLength(3);
    expect(sentMails().every((mail) => mail.subject === "[곧 시작] 주간 회의")).toBe(true);
    expect(sentMails().every((mail) => mail.to.join(",") === "kim@example.com,lee@example.com,park@example.com")).toBe(
      true,
    );
    for (const occurrence of occurrences) {
      const saved = await services.reservationRepository.findById(occurrence.id);
      expect(saved?.remindedAt).toBeDefined();
    }
  });
});
