import { beforeEach, describe, expect, it } from "vitest";
import { createServices } from "../src/app.js";
import { runReminderJob } from "../src/jobs/reminderJob.js";
import { clearSentMails, sentMails } from "../src/notifications/legacyMailer.js";
import type { NewReservation } from "../src/reservations/reservation.js";
import type { Clock } from "../src/shared/clock.js";

const at = (time: string) => new Date(`2026-11-02T${time}:00+09:00`);

function booking(overrides: Partial<NewReservation> = {}): NewReservation {
  return {
    roomId: "room-302",
    title: "주간 회의",
    organizer: "kim@example.com",
    attendees: ["lee@example.com", "park@example.com"],
    start: at("10:00"),
    end: at("11:00"),
    ...overrides,
  };
}

/** 테스트 도중 시각을 옮길 수 있는 시계 */
function movableClock(time: string): Clock & { set(time: string): void } {
  let current = at(time);
  return {
    now: () => new Date(current),
    set(next: string) {
      current = at(next);
    },
  };
}

describe("runReminderJob", () => {
  let clock: ReturnType<typeof movableClock>;
  let services: ReturnType<typeof createServices>;

  const run = () => runReminderJob(services.reservationRepository, services.roomService, clock);

  beforeEach(() => {
    clock = movableClock("08:00");
    services = createServices({ clock });
    clearSentMails();
  });

  it("10분 안에 시작하는 회의의 주최자와 참석자에게 리마인더 메일을 보낸다", async () => {
    const reservation = await services.reservationService.create(booking());
    clearSentMails();
    clock.set("09:52");

    const sent = await run();

    expect(sent).toBe(1);
    expect(sentMails()).toEqual([
      {
        to: ["kim@example.com", "lee@example.com", "park@example.com"],
        subject: "[곧 시작] 주간 회의",
        body: expect.stringContaining("백두(3층) 회의실에서"),
      },
    ]);
    const saved = await services.reservationRepository.findById(reservation.id);
    expect(saved?.remindedAt).toEqual(at("09:52"));
  });

  it("이미 리마인더를 보낸 예약에는 다시 보내지 않는다", async () => {
    await services.reservationService.create(booking());
    clock.set("09:52");
    await run();
    clearSentMails();
    clock.set("09:53");

    const sent = await run();

    expect(sent).toBe(0);
    expect(sentMails()).toHaveLength(0);
  });

  it("10분 넘게 남은 회의에는 아직 보내지 않는다", async () => {
    await services.reservationService.create(booking());
    clearSentMails();
    clock.set("09:50");

    const sent = await run();

    expect(sent).toBe(0);
    expect(sentMails()).toHaveLength(0);
  });

  it("취소된 예약에는 보내지 않는다", async () => {
    const reservation = await services.reservationService.create(booking());
    await services.reservationService.cancel(reservation.id, "kim@example.com");
    clearSentMails();
    clock.set("09:52");

    const sent = await run();

    expect(sent).toBe(0);
    expect(sentMails()).toHaveLength(0);
  });

  it("여러 예약이 있으면 각각 한 통씩 보낸다", async () => {
    await services.reservationService.create(booking());
    await services.reservationService.create(
      booking({ roomId: "room-501", title: "디자인 리뷰", start: at("10:05"), end: at("10:30") }),
    );
    clearSentMails();
    clock.set("09:56");

    const sent = await run();

    expect(sent).toBe(2);
    expect(sentMails().map((mail) => mail.subject).sort()).toEqual([
      "[곧 시작] 디자인 리뷰",
      "[곧 시작] 주간 회의",
    ]);
  });
});
