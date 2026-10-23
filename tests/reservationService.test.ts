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

    it("취소된 예약의 시간대에는 다시 예약할 수 있다", async () => {
      const cancelled = await services.reservationService.create(booking({ title: "취소될 회의" }));
      await services.reservationService.cancel(cancelled.id, "kim@example.com");

      const next = await services.reservationService.create(booking({ title: "새 회의" }));
      expect(next.status).toBe("confirmed");

      // 충돌 메시지에는 취소된 예약이 아니라 확정된 예약이 나와야 한다.
      const error = await services.reservationService
        .create(booking({ title: "또 다른 회의" }))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).message).toContain("새 회의");
      expect((error as ConflictError).message).not.toContain("취소될 회의");
    });

    it("다른 회의실이면 같은 시간에도 예약할 수 있다", async () => {
      await services.reservationService.create(booking());
      const other = await services.reservationService.create(booking({ roomId: "room-501" }));

      expect(other.status).toBe("confirmed");
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

  describe("reschedule", () => {
    const kim = "kim@example.com";

    it("주최자는 예약 시간을 바꿀 수 있고 참석자에게 메일이 간다", async () => {
      const created = await services.reservationService.create(booking());
      clearSentMails();

      const updated = await services.reservationService.reschedule(created.id, kim, at("13:00"), at("14:00"));

      expect(updated.start).toEqual(at("13:00"));
      expect((await services.reservationService.get(created.id)).end).toEqual(at("14:00"));
      expect(sentMails()).toHaveLength(1);
      expect(sentMails()[0].to).toEqual([kim, "lee@example.com", "park@example.com"]);
    });

    it("주최자가 아니면 바꿀 수 없다", async () => {
      const created = await services.reservationService.create(booking());

      await expect(
        services.reservationService.reschedule(created.id, "lee@example.com", at("13:00"), at("14:00")),
      ).rejects.toBeInstanceOf(ValidationError);
      expect((await services.reservationService.get(created.id)).start).toEqual(at("10:00"));
    });

    it("같은 회의실의 다른 예약과 겹치면 거절하고 원래 시간을 유지한다", async () => {
      const created = await services.reservationService.create(booking());
      await services.reservationService.create(booking({ title: "다른 회의", start: at("13:00"), end: at("14:00") }));

      await expect(
        services.reservationService.reschedule(created.id, kim, at("13:30"), at("14:30")),
      ).rejects.toBeInstanceOf(ConflictError);
      expect((await services.reservationService.get(created.id)).start).toEqual(at("10:00"));
    });

    it("자기 자신의 기존 시간과 겹치는 이동은 허용한다", async () => {
      const created = await services.reservationService.create(booking());

      const updated = await services.reservationService.reschedule(created.id, kim, at("10:30"), at("11:30"));

      expect(updated.start).toEqual(at("10:30"));
    });

    it("끝 시각이 다른 예약의 시작 시각과 같으면 허용하고, 취소된 예약과는 겹쳐도 된다", async () => {
      const created = await services.reservationService.create(booking());
      await services.reservationService.create(booking({ start: at("12:00"), end: at("13:00") }));
      const cancelled = await services.reservationService.create(booking({ start: at("14:00"), end: at("15:00") }));
      await services.reservationService.cancel(cancelled.id, kim);

      await services.reservationService.reschedule(created.id, kim, at("11:00"), at("12:00"));
      const updated = await services.reservationService.reschedule(created.id, kim, at("14:00"), at("15:00"));

      expect(updated.start).toEqual(at("14:00"));
    });

    it("취소된 예약과 없는 예약은 바꿀 수 없다", async () => {
      const created = await services.reservationService.create(booking());
      await services.reservationService.cancel(created.id, kim);

      await expect(
        services.reservationService.reschedule(created.id, kim, at("13:00"), at("14:00")),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        services.reservationService.reschedule("rsv-none", kim, at("13:00"), at("14:00")),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("지난 시각이나 잘못된 구간으로는 바꿀 수 없다", async () => {
      const created = await services.reservationService.create(booking());

      await expect(
        services.reservationService.reschedule(created.id, kim, at("07:00"), at("08:00")),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        services.reservationService.reschedule(created.id, kim, at("14:00"), at("13:00")),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
