import { beforeEach, describe, expect, it } from "vitest";
import { createServices } from "../src/app.js";
import { clearSentMails, sentMails } from "../src/notifications/legacyMailer.js";
import type { NewReservation } from "../src/reservations/reservation.js";
import { fixedClock } from "../src/shared/clock.js";
import { ConflictError, NotFoundError, ValidationError } from "../src/shared/errors.js";

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

describe("ReservationService", () => {
  let services: ReturnType<typeof createServices>;

  beforeEach(() => {
    clearSentMails();
    services = createServices({ clock: fixedClock("2026-11-02T08:00:00+09:00") });
  });

  describe("create", () => {
    it("예약을 확정하고 주최자와 참석자에게 메일을 보낸다", async () => {
      const reservation = await services.reservationService.create(booking());

      expect(reservation.status).toBe("confirmed");
      expect(sentMails()).toHaveLength(1);
      expect(sentMails()[0].to).toEqual(["kim@example.com", "lee@example.com", "park@example.com"]);
    });

    it("같은 회의실의 겹치는 시간에는 예약할 수 없다", async () => {
      await services.reservationService.create(booking());

      await expect(
        services.reservationService.create(booking({ start: at("10:30"), end: at("11:30") })),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("이어지는 시간에는 예약할 수 있다", async () => {
      await services.reservationService.create(booking());
      const next = await services.reservationService.create(
        booking({ start: at("11:00"), end: at("12:00") }),
      );

      expect(next.status).toBe("confirmed");
    });

    it("다른 회의실이면 같은 시간에도 예약할 수 있다", async () => {
      await services.reservationService.create(booking());
      const other = await services.reservationService.create(booking({ roomId: "room-501" }));

      expect(other.status).toBe("confirmed");
    });

    it("같은 회의실, 같은 시간대의 요청이 동시에 들어오면 한 건만 예약된다", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => services.reservationService.create(booking())),
      );

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(4);
      for (const result of rejected) {
        expect(result.reason).toBeInstanceOf(ConflictError);
      }

      const stored = await services.reservationRepository.findByRoom("room-302");
      expect(stored).toHaveLength(1);
    });

    it("겹치지 않는 요청은 동시에 들어와도 모두 예약된다", async () => {
      const results = await Promise.allSettled([
        services.reservationService.create(booking()),
        services.reservationService.create(booking({ start: at("11:00"), end: at("12:00") })),
        services.reservationService.create(booking({ roomId: "room-501" })),
      ]);

      expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    });

    it("취소된 예약과 겹치는 시간에는 다시 예약할 수 있다", async () => {
      const first = await services.reservationService.create(booking());
      await services.reservationService.cancel(first.id, "kim@example.com");

      const again = await services.reservationService.create(booking({ title: "재예약" }));

      expect(again.status).toBe("confirmed");
      const schedule = await services.reservationService.scheduleOf("room-302", at("00:00"));
      expect(schedule.map((reservation) => reservation.id)).toEqual([again.id]);
    });

    it("수용 인원을 넘으면 거절한다", async () => {
      const attendees = ["a@example.com", "b@example.com", "c@example.com", "d@example.com"];

      await expect(
        services.reservationService.create(booking({ roomId: "room-301", attendees })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("4시간을 넘는 예약은 거절한다", async () => {
      await expect(
        services.reservationService.create(booking({ start: at("09:00"), end: at("13:30") })),
      ).rejects.toThrow("4시간");
    });

    it("지난 시각으로는 예약할 수 없다", async () => {
      await expect(
        services.reservationService.create(booking({ start: at("07:00"), end: at("07:30") })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("없는 회의실이면 NotFoundError를 던진다", async () => {
      await expect(
        services.reservationService.create(booking({ roomId: "room-999" })),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("cancel", () => {
    it("주최자가 취소하면 상태가 바뀌고 취소 메일을 보낸다", async () => {
      const reservation = await services.reservationService.create(booking());
      clearSentMails();

      const cancelled = await services.reservationService.cancel(reservation.id, "kim@example.com");

      expect(cancelled.status).toBe("cancelled");
      expect(sentMails()[0].subject).toContain("취소");
    });

    it("주최자가 아니면 취소할 수 없다", async () => {
      const reservation = await services.reservationService.create(booking());

      await expect(
        services.reservationService.cancel(reservation.id, "lee@example.com"),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("취소된 예약은 일정에 나오지 않는다", async () => {
      const reservation = await services.reservationService.create(booking());
      await services.reservationService.cancel(reservation.id, "kim@example.com");

      const schedule = await services.reservationService.scheduleOf("room-302", at("00:00"));
      expect(schedule).toHaveLength(0);
    });
  });
});
