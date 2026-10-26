import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServices } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { clearSentMails } from "../src/notifications/legacyMailer.js";
import type { NewReservation } from "../src/reservations/reservation.js";
import { SqliteReservationRepository } from "../src/reservations/reservationRepository.js";
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

/**
 * 모든 참여자가 예약을 읽을 때까지 서로 기다리게 하는 장치.
 * 읽기-검사-쓰기 서비스는 한쪽이 먼저 끝나면 다른 쪽이 바뀐 값을 읽어 정상적으로 순서대로 처리되므로,
 * 두 요청이 같은 값을 읽은 뒤에 쓰는 경합을 실행 순서에 맡기지 않고 항상 재현하려고 쓴다.
 */
function readBarrier(parties: number) {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  return async () => {
    arrived += 1;
    if (arrived >= parties) {
      release();
    }
    await open;
  };
}

/** 같은 DB 파일에 연결하되, 예약을 읽은 직후 barrier에서 다른 워커를 기다리는 워커. */
function gatedWorker(databasePath: string, barrier: () => Promise<void>) {
  const repository = new SqliteReservationRepository(openDatabase(databasePath));
  const findById = repository.findById.bind(repository);
  repository.findById = async (id) => {
    const found = await findById(id);
    await barrier();
    return found;
  };
  return createServices({ clock, databasePath, reservationRepository: repository });
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
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }
    const stored = await workerA.reservationService.scheduleOf("room-302", at("00:00"));
    expect(stored).toHaveLength(1);
  });

  it("DB 연결이 서로 다른 두 워커가 겹치지 않는 시간대를 동시에 쓰면 모두 저장된다", async () => {
    const databasePath = join(dir, "reservations.db");
    const workers = [createServices({ clock, databasePath }), createServices({ clock, databasePath })];

    // 두 회의실 × 10개 시간대 = 서로 겹치지 않는 20건을 두 워커에 번갈아 보낸다.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => {
        const hour = String(9 + (i % 10)).padStart(2, "0");
        return workers[i % 2].reservationService.create(
          booking({
            roomId: i < 10 ? "room-302" : "room-501",
            start: at(`${hour}:00`),
            end: at(`${hour}:30`),
            attendees: [],
          }),
        );
      }),
    );

    // SQLITE_BUSY 같은 저장소 오류가 ConflictError나 다른 실패로 새어 나오지 않아야 한다.
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
  });

  it("같은 시간대라도 회의실이 다르면 동시에 모두 예약된다", async () => {
    const { reservationService } = createServices({ clock });

    const results = await Promise.allSettled([
      reservationService.create(booking({ roomId: "room-301", attendees: [] })),
      reservationService.create(booking({ roomId: "room-302" })),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("DB 연결이 서로 다른 두 워커가 서로 다른 예약을 같은 시간대로 동시에 옮기면 한 건만 옮겨지고 나머지는 ConflictError로 거절된다", async () => {
    const databasePath = join(dir, "reservations.db");
    const workerA = createServices({ clock, databasePath });
    const workerB = createServices({ clock, databasePath });
    const a = await workerA.reservationService.create(
      booking({ title: "A", start: at("09:00"), end: at("10:00") }),
    );
    const b = await workerA.reservationService.create(
      booking({ title: "B", organizer: "park@example.com", attendees: [], start: at("13:00"), end: at("14:00") }),
    );

    const results = await Promise.allSettled([
      workerA.reservationService.reschedule(a.id, a.organizer, at("15:00"), at("16:00")),
      workerB.reservationService.reschedule(b.id, b.organizer, at("15:30"), at("16:30")),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }
    const stored = await workerA.reservationService.scheduleOf("room-302", at("00:00"));
    expect(stored.filter((r) => r.start >= at("15:00"))).toHaveLength(1);
    expect(stored).toHaveLength(2);
  });

  it("DB 연결이 서로 다른 두 워커가 새 예약과 시간 변경을 같은 시간대로 동시에 보내면 한 건만 남고 나머지는 ConflictError로 거절된다", async () => {
    const databasePath = join(dir, "reservations.db");
    const workerA = createServices({ clock, databasePath });
    const workerB = createServices({ clock, databasePath });
    const existing = await workerA.reservationService.create(
      booking({ start: at("09:00"), end: at("10:00") }),
    );

    const results = await Promise.allSettled([
      workerA.reservationService.reschedule(existing.id, existing.organizer, at("15:00"), at("16:00")),
      workerB.reservationService.create(booking({ title: "신규", start: at("15:00"), end: at("16:00") })),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }
    const stored = await workerA.reservationService.scheduleOf("room-302", at("00:00"));
    expect(stored.filter((r) => r.start >= at("15:00") && r.start < at("16:00"))).toHaveLength(1);
  });

  it("DB 연결이 서로 다른 두 워커가 서로 다른 예약을 같은 회의실로 동시에 옮기면 한 건만 옮겨지고 나머지는 ConflictError로 거절된다", async () => {
    const databasePath = join(dir, "reservations.db");
    const workerA = createServices({ clock, databasePath });
    const workerB = createServices({ clock, databasePath });
    const a = await workerA.reservationService.create(booking({ title: "A", roomId: "room-302" }));
    const b = await workerA.reservationService.create(
      booking({ title: "B", roomId: "room-501", organizer: "park@example.com", attendees: [] }),
    );

    const results = await Promise.allSettled([
      workerA.reservationService.changeRoom(a.id, a.organizer, "room-502"),
      workerB.reservationService.changeRoom(b.id, b.organizer, "room-502"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }
    const stored = await workerA.reservationService.scheduleOf("room-502", at("00:00"));
    expect(stored).toHaveLength(1);
  });

  it("DB 연결이 서로 다른 두 워커가 새 예약과 회의실 변경을 같은 회의실·시간대로 동시에 보내면 한 건만 남고 나머지는 ConflictError로 거절된다", async () => {
    const databasePath = join(dir, "reservations.db");
    const workerA = createServices({ clock, databasePath });
    const workerB = createServices({ clock, databasePath });
    const existing = await workerA.reservationService.create(booking({ roomId: "room-302" }));

    const results = await Promise.allSettled([
      workerA.reservationService.changeRoom(existing.id, existing.organizer, "room-501"),
      workerB.reservationService.create(booking({ title: "신규", roomId: "room-501", attendees: [] })),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }
    const stored = await workerA.reservationService.scheduleOf("room-501", at("00:00"));
    expect(stored).toHaveLength(1);
  });
  it("DB 연결이 서로 다른 두 워커가 같은 예약의 참석자를 동시에 바꾸면 한 건만 바뀌고 나머지는 ConflictError로 거절된다", async () => {
    const databasePath = join(dir, "reservations.db");
    const existing = await createServices({ clock, databasePath }).reservationService.create(
      booking({ roomId: "room-301", attendees: [] }),
    );
    const barrier = readBarrier(2);
    const workerA = gatedWorker(databasePath, barrier);
    const workerB = gatedWorker(databasePath, barrier);

    const results = await Promise.allSettled([
      workerA.reservationService.updateAttendees(existing.id, existing.organizer, ["a@example.com", "b@example.com"]),
      workerB.reservationService.updateAttendees(existing.id, existing.organizer, ["c@example.com", "d@example.com"]),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }
    const stored = await workerA.reservationService.get(existing.id);
    expect(stored.attendees).toHaveLength(2);
  });

  it("DB 연결이 서로 다른 두 워커에서 참석자 추가와 더 작은 회의실로의 이동을 동시에 보내도 수용 인원을 넘는 예약이 남지 않는다", async () => {
    const databasePath = join(dir, "reservations.db");
    // room-302(8명)의 3명 예약. 3명이면 room-301(4명)로 옮길 수 있고 7명으로 늘릴 수도 있지만, 둘 다 되면 7명이 4명 방에 남는다.
    const existing = await createServices({ clock, databasePath }).reservationService.create(
      booking({ roomId: "room-302", attendees: ["a@example.com", "b@example.com"] }),
    );
    const barrier = readBarrier(2);
    const workerA = gatedWorker(databasePath, barrier);
    const workerB = gatedWorker(databasePath, barrier);

    const results = await Promise.allSettled([
      workerA.reservationService.updateAttendees(existing.id, existing.organizer, [
        "a@example.com",
        "b@example.com",
        "c@example.com",
        "d@example.com",
        "e@example.com",
        "f@example.com",
      ]),
      workerB.reservationService.changeRoom(existing.id, existing.organizer, "room-301"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }
    const stored = await workerA.reservationService.get(existing.id);
    const capacity = stored.roomId === "room-301" ? 4 : 8;
    expect(new Set([stored.organizer, ...stored.attendees]).size).toBeLessThanOrEqual(capacity);
  });
});
