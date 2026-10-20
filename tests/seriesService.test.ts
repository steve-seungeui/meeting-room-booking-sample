import { beforeEach, describe, expect, it } from "vitest";
import { createServices } from "../src/app.js";
import { runReminderJob } from "../src/jobs/reminderJob.js";
import { clearSentMails, sentMails } from "../src/notifications/legacyMailer.js";
import type { NewReservationSeries } from "../src/reservations/series.js";
import { fixedClock } from "../src/shared/clock.js";
import { ConflictError, ValidationError } from "../src/shared/errors.js";

const NOW = "2026-11-02T08:00:00+09:00";
const at = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);

function weekly(overrides: Partial<NewReservationSeries> = {}): NewReservationSeries {
  return {
    roomId: "room-302",
    title: "주간 회의",
    organizer: "kim@example.com",
    attendees: ["lee@example.com", "park@example.com"],
    start: at("2026-11-02", "10:00"),
    end: at("2026-11-02", "11:00"),
    recurrence: { frequency: "weekly", count: 4 },
    ...overrides,
  };
}

describe("ReservationSeriesService", () => {
  let services: ReturnType<typeof createServices>;

  /** 같은 저장소를 쓰면서 시각만 다른 서비스를 만든다. */
  function servicesAt(iso: string) {
    return createServices({
      reservationRepository: services.reservationRepository,
      seriesRepository: services.seriesRepository,
      clock: fixedClock(iso),
    });
  }

  beforeEach(() => {
    clearSentMails();
    services = createServices({ clock: fixedClock(NOW) });
  });

  describe("create", () => {
    it("모든 회차를 예약으로 저장하고 메일은 1통만 보낸다", async () => {
      const { series, occurrences } = await services.seriesService.create(weekly());

      expect(series.count).toBe(4);
      expect(occurrences).toHaveLength(4);
      expect(occurrences.every((occurrence) => occurrence.seriesId === series.id)).toBe(true);
      expect(await services.reservationRepository.findBySeries(series.id)).toHaveLength(4);
      expect(sentMails()).toHaveLength(1);
      expect(sentMails()[0].to).toEqual(["kim@example.com", "lee@example.com", "park@example.com"]);
      expect(sentMails()[0].body).toContain("매주 월요일 10:00 ~ 11:00");
      expect(sentMails()[0].body).toContain("11월 2일(월) ~ 11월 23일(월) (4회)");
    });

    it("until로 요청해도 실제 회차 수를 저장한다", async () => {
      const { series } = await services.seriesService.create(
        weekly({ recurrence: { frequency: "weekly", until: "2026-11-16" } }),
      );

      expect(series.count).toBe(3);
    });

    it("첫 회차가 지난 시각이면 거부한다", async () => {
      await expect(
        services.seriesService.create(weekly({ start: at("2026-11-02", "07:00"), end: at("2026-11-02", "07:30") })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("4시간을 넘으면 거부한다", async () => {
      await expect(
        services.seriesService.create(weekly({ start: at("2026-11-02", "09:00"), end: at("2026-11-02", "13:30") })),
      ).rejects.toThrow("4시간");
    });

    it("수용 인원을 넘으면 거부한다", async () => {
      const attendees = ["a@example.com", "b@example.com", "c@example.com", "d@example.com"];

      await expect(
        services.seriesService.create(weekly({ roomId: "room-301", attendees })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("반복 규칙이 잘못되면 거부한다", async () => {
      await expect(
        services.seriesService.create(weekly({ recurrence: { frequency: "weekly", count: 27 } })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("한 회차라도 겹치면 아무것도 저장하지 않고 겹치는 날짜를 모두 알려 준다", async () => {
      await services.reservationService.create({
        ...weekly(),
        title: "팀 회의",
        start: at("2026-11-09", "10:30"),
        end: at("2026-11-09", "11:30"),
      });
      await services.reservationService.create({
        ...weekly(),
        title: "채용 면접",
        start: at("2026-11-23", "09:00"),
        end: at("2026-11-23", "10:30"),
      });
      clearSentMails();

      const attempt = services.seriesService.create(weekly());

      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toThrow(
        "백두 회의실은 다음 날짜에 이미 예약되어 있습니다: 11월 9일(월) 팀 회의, 11월 23일(월) 채용 면접",
      );
      expect(await services.reservationRepository.findByRoom("room-302")).toHaveLength(2);
      expect(sentMails()).toHaveLength(0);
    });
  });

  describe("get", () => {
    it("취소된 회차를 포함해 시작 시각 순으로 돌려준다", async () => {
      const { series, occurrences } = await services.seriesService.create(weekly());
      await services.reservationService.cancel(occurrences[1].id, "kim@example.com");

      const found = await services.seriesService.get(series.id);

      expect(found.occurrences.map((occurrence) => occurrence.status)).toEqual([
        "confirmed",
        "cancelled",
        "confirmed",
        "confirmed",
      ]);
      expect(found.occurrences.map((occurrence) => occurrence.id)).toEqual(occurrences.map((o) => o.id));
    });
  });

  describe("cancel", () => {
    it("회차 하나를 취소하면 그 회차만 취소되고 시리즈는 그대로다", async () => {
      const { series, occurrences } = await services.seriesService.create(weekly());
      clearSentMails();

      const cancelled = await services.reservationService.cancel(occurrences[2].id, "kim@example.com");

      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.seriesId).toBe(series.id);
      const found = await services.seriesService.get(series.id);
      expect(found.series.cancelledAt).toBeUndefined();
      expect(found.occurrences.filter((occurrence) => occurrence.status === "cancelled")).toHaveLength(1);
      expect(sentMails()).toHaveLength(1);
    });

    it("시리즈 전체 취소는 아직 시작하지 않은 회차만 취소한다", async () => {
      const { series } = await services.seriesService.create(weekly());
      clearSentMails();

      // 두 번째 회차가 진행 중인 시각
      const later = servicesAt("2026-11-09T10:30:00+09:00");
      const result = await later.seriesService.cancel(series.id, "kim@example.com");

      expect(result.series.cancelledAt).toEqual(new Date("2026-11-09T10:30:00+09:00"));
      expect(result.occurrences.map((occurrence) => occurrence.status)).toEqual([
        "confirmed",
        "confirmed",
        "cancelled",
        "cancelled",
      ]);
      expect(sentMails()).toHaveLength(1);
      expect(sentMails()[0].subject).toContain("취소");
      expect(sentMails()[0].body).toContain("취소된 회차: 2회");
    });

    it("주최자가 아니면 취소할 수 없다", async () => {
      const { series } = await services.seriesService.create(weekly());

      await expect(services.seriesService.cancel(series.id, "lee@example.com")).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("두 번 취소해도 결과가 같고 메일은 한 번만 보낸다", async () => {
      const { series } = await services.seriesService.create(weekly());
      clearSentMails();

      const first = await services.seriesService.cancel(series.id, "kim@example.com");
      const second = await services.seriesService.cancel(series.id, "kim@example.com");

      expect(second).toEqual(first);
      expect(sentMails()).toHaveLength(1);
    });

    it("취소할 미래 회차가 없어도 시리즈는 취소되고 메일은 보내지 않는다", async () => {
      const { series } = await services.seriesService.create(weekly());
      clearSentMails();

      const result = await servicesAt("2026-12-01T00:00:00+09:00").seriesService.cancel(series.id, "kim@example.com");

      expect(result.series.cancelledAt).toBeDefined();
      expect(result.occurrences.every((occurrence) => occurrence.status === "confirmed")).toBe(true);
      expect(sentMails()).toHaveLength(0);
    });
  });

  describe("연동", () => {
    it("회차가 하루 일정에 나온다", async () => {
      await services.seriesService.create(weekly());

      const schedule = await services.reservationService.scheduleOf("room-302", at("2026-11-16", "00:00"));

      expect(schedule).toHaveLength(1);
      expect(schedule[0].start).toEqual(at("2026-11-16", "10:00"));
    });

    it("리마인더 작업이 회차마다 알림을 보낸다", async () => {
      await services.seriesService.create(weekly());
      clearSentMails();

      for (const date of ["2026-11-02", "2026-11-09"]) {
        const later = servicesAt(`${date}T09:55:00+09:00`);
        const sent = await runReminderJob(later.reservationRepository, later.roomService, later.clock);
        expect(sent).toBe(1);
      }
      expect(sentMails().map((mail) => mail.subject)).toEqual(["[곧 시작] 주간 회의", "[곧 시작] 주간 회의"]);
    });
  });
});
