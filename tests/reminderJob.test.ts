import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServices } from "../src/app.js";
import { runReminderJob } from "../src/jobs/reminderJob.js";
import { clearSentMails, sentMails } from "../src/notifications/legacyMailer.js";
import type { NewReservation } from "../src/reservations/reservation.js";
import { fixedClock } from "../src/shared/clock.js";

const at = (time: string) => new Date(`2026-11-02T${time}:00+09:00`);
// 회의 시작 5분 전: 리마인더 대상이 되는 시각
const clock = fixedClock("2026-11-02T09:55:00+09:00");

function booking(overrides: Partial<NewReservation> = {}): NewReservation {
  return {
    roomId: "room-302",
    title: "주간 회의",
    organizer: "kim@example.com",
    attendees: ["lee@example.com"],
    start: at("10:00"),
    end: at("11:00"),
    ...overrides,
  };
}

describe("리마인더 작업과 취소", () => {
  let dir: string;

  beforeEach(() => {
    clearSentMails();
    dir = mkdtempSync(join(tmpdir(), "reminder-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("리마인더 작업이 예약을 읽은 뒤 다른 워커가 취소해도 취소 상태가 유지된다", async () => {
    const databasePath = join(dir, "reservations.db");
    const jobWorker = createServices({ clock, databasePath });
    const apiWorker = createServices({ clock, databasePath });
    const reservation = await apiWorker.reservationService.create(booking());
    clearSentMails();

    // 작업이 확정 상태의 예약 목록을 읽은 직후, API 워커가 취소를 끝내도록 끼워 넣는다.
    const findStartingBetween = jobWorker.reservationRepository.findStartingBetween.bind(jobWorker.reservationRepository);
    jobWorker.reservationRepository.findStartingBetween = async (from, to) => {
      const found = await findStartingBetween(from, to);
      await apiWorker.reservationService.cancel(reservation.id, reservation.organizer);
      return found;
    };

    await runReminderJob(jobWorker.reservationRepository, jobWorker.roomService, clock);

    const stored = await apiWorker.reservationService.get(reservation.id);
    expect(stored.status).toBe("cancelled");
    expect(stored.cancelledAt).toBeDefined();
    expect(sentMails().filter((mail) => mail.subject.includes("곧 시작"))).toEqual([]);
  });

  it("취소된 예약에는 리마인더를 보내지 않는다", async () => {
    const { reservationService, reservationRepository, roomService } = createServices({ clock });
    const reservation = await reservationService.create(booking());
    await reservationService.cancel(reservation.id, reservation.organizer);
    clearSentMails();

    expect(await runReminderJob(reservationRepository, roomService, clock)).toBe(0);
    expect(sentMails()).toEqual([]);
  });

  it("같은 예약의 리마인더는 작업이 겹쳐 실행되어도 한 번만 보낸다", async () => {
    const databasePath = join(dir, "reservations.db");
    const a = createServices({ clock, databasePath });
    const b = createServices({ clock, databasePath });
    await a.reservationService.create(booking());
    clearSentMails();

    const counts = await Promise.all([
      runReminderJob(a.reservationRepository, a.roomService, clock),
      runReminderJob(b.reservationRepository, b.roomService, clock),
    ]);

    expect(counts[0] + counts[1]).toBe(1);
    expect(sentMails()).toHaveLength(1);
  });
});
