import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServices } from "../src/app.js";
import { clearSentMails } from "../src/notifications/legacyMailer.js";
import type { NewReservation } from "../src/reservations/reservation.js";
import { fixedClock } from "../src/shared/clock.js";
import { ConflictError } from "../src/shared/errors.js";

const at = (time: string) => new Date(`2026-11-02T${time}:00+09:00`);
const clock = fixedClock("2026-11-02T08:00:00+09:00");

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

describe("동시 예약 요청", () => {
  let dir: string;

  beforeEach(() => {
    clearSentMails();
    dir = mkdtempSync(join(tmpdir(), "booking-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("한 프로세스에서 같은 회의실·시간대 요청이 동시에 들어오면 한 건만 저장된다", async () => {
    const { reservationService } = createServices({ clock });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        reservationService.create(booking({ title: `회의 ${i}` })),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }
    const stored = await reservationService.scheduleOf("room-302", at("00:00"));
    expect(stored).toHaveLength(1);
  });

  it("DB 연결이 서로 다른 두 워커에서 동시에 요청해도 한 건만 저장된다", async () => {
    const databasePath = join(dir, "reservations.db");
    const workerA = createServices({ clock, databasePath });
    const workerB = createServices({ clock, databasePath });

    const results = await Promise.allSettled([
      workerA.reservationService.create(booking({ title: "A" })),
      workerB.reservationService.create(booking({ title: "B", start: at("10:30"), end: at("11:30") })),
      workerA.reservationService.create(booking({ title: "C" })),
      workerB.reservationService.create(booking({ title: "D" })),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const stored = await workerA.reservationService.scheduleOf("room-302", at("00:00"));
    expect(stored).toHaveLength(1);
  });

  it("같은 시간대라도 회의실이 다르면 동시에 모두 예약된다", async () => {
    const { reservationService } = createServices({ clock });

    const results = await Promise.allSettled([
      reservationService.create(booking({ roomId: "room-301", attendees: [] })),
      reservationService.create(booking({ roomId: "room-302" })),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
});
