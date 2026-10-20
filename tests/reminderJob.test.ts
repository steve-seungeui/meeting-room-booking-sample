import { beforeEach, describe, expect, it } from "vitest";
import { createServices } from "../src/app.js";
import { runReminderJob } from "../src/jobs/reminderJob.js";
import { clearSentMails } from "../src/notifications/legacyMailer.js";
import type { NewReservation } from "../src/reservations/reservation.js";
import type { RoomService } from "../src/rooms/roomService.js";
import { fixedClock } from "../src/shared/clock.js";

const at = (time: string) => new Date(`2026-11-02T${time}:00+09:00`);

function booking(overrides: Partial<NewReservation> = {}): NewReservation {
  return {
    roomId: "room-302",
    title: "주간 회의",
    organizer: "kim@example.com",
    attendees: ["lee@example.com"],
    start: at("08:05"),
    end: at("09:00"),
    ...overrides,
  };
}

describe("runReminderJob", () => {
  let services: ReturnType<typeof createServices>;

  beforeEach(() => {
    clearSentMails();
    services = createServices({ clock: fixedClock("2026-11-02T08:00:00+09:00") });
  });

  it("곧 시작하는 예약에 알림을 보내고 보낸 시각을 기록한다", async () => {
    const reservation = await services.reservationService.create(booking());

    const sent = await runReminderJob(
      services.reservationRepository,
      services.roomService,
      services.clock,
    );

    expect(sent).toBe(1);
    const stored = await services.reservationService.get(reservation.id);
    expect(stored.remindedAt).toEqual(services.clock.now());
  });

  it("알림을 보내는 사이에 들어온 취소를 덮어쓰지 않는다", async () => {
    const reservation = await services.reservationService.create(booking());
    // 작업이 예약을 읽은 뒤 메일을 보내는 사이에 주최자가 취소하는 상황을 만든다.
    const rooms = {
      get: async (roomId: string) => {
        await services.reservationService.cancel(reservation.id, "kim@example.com");
        return services.roomService.get(roomId);
      },
    } as RoomService;

    await runReminderJob(services.reservationRepository, rooms, services.clock);

    const stored = await services.reservationService.get(reservation.id);
    expect(stored.status).toBe("cancelled");
    expect(stored.cancelledAt).toBeDefined();
  });
});
