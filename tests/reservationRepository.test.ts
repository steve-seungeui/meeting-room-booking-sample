import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import type { Reservation } from "../src/reservations/reservation.js";
import { SqliteReservationRepository } from "../src/reservations/reservationRepository.js";

const at = (time: string) => new Date(`2026-11-02T${time}:00+09:00`);

function booking(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: "r-1",
    roomId: "room-302",
    title: "주간 회의",
    organizer: "kim@example.com",
    attendees: ["lee@example.com", "park@example.com"],
    start: at("10:00"),
    end: at("11:00"),
    status: "confirmed",
    createdAt: at("08:00"),
    ...overrides,
  };
}

describe("SqliteReservationRepository", () => {
  let repository: SqliteReservationRepository;

  beforeEach(() => {
    repository = new SqliteReservationRepository(openDatabase(":memory:"));
  });

  describe("save와 findById", () => {
    it("저장한 예약을 같은 값으로 다시 읽는다", async () => {
      const reservation = booking();
      await repository.save(reservation);

      const found = await repository.findById("r-1");

      expect(found).toEqual(reservation);
      expect(found?.start).toBeInstanceOf(Date);
      expect(found?.end).toBeInstanceOf(Date);
      expect(found?.createdAt).toBeInstanceOf(Date);
    });

    it("취소 시각과 리마인더 시각이 없으면 undefined로 읽는다", async () => {
      await repository.save(booking());

      const found = await repository.findById("r-1");

      expect(found?.cancelledAt).toBeUndefined();
      expect(found?.remindedAt).toBeUndefined();
    });

    it("취소 시각과 리마인더 시각이 있으면 Date로 읽는다", async () => {
      const reservation = booking({ status: "cancelled", cancelledAt: at("09:00"), remindedAt: at("09:55") });
      await repository.save(reservation);

      const found = await repository.findById("r-1");

      expect(found).toEqual(reservation);
      expect(found?.cancelledAt).toBeInstanceOf(Date);
      expect(found?.remindedAt).toBeInstanceOf(Date);
    });

    it("참석자가 없거나 특수 문자가 있어도 목록을 그대로 읽는다", async () => {
      await repository.save(booking({ id: "empty", attendees: [] }));
      await repository.save(booking({ id: "special", roomId: "room-501", attendees: ['"따옴표"@example.com', "이,름@example.com"] }));

      expect((await repository.findById("empty"))?.attendees).toEqual([]);
      expect((await repository.findById("special"))?.attendees).toEqual(['"따옴표"@example.com', "이,름@example.com"]);
    });

    it("없는 id를 찾으면 undefined를 돌려준다", async () => {
      expect(await repository.findById("missing")).toBeUndefined();
    });

    it("같은 id로 다시 저장하면 모든 열을 새 값으로 덮어쓴다", async () => {
      await repository.save(booking({ remindedAt: at("09:55") }));
      const updated = booking({
        roomId: "room-501",
        title: "바뀐 회의",
        organizer: "choi@example.com",
        attendees: ["a@example.com"],
        start: at("13:00"),
        end: at("14:00"),
        status: "cancelled",
        createdAt: at("07:00"),
        cancelledAt: at("09:00"),
      });

      await repository.save(updated);

      expect(await repository.findById("r-1")).toEqual(updated);
      expect(await repository.findByRoom("room-302")).toEqual([]);
      expect(await repository.findByRoom("room-501")).toHaveLength(1);
    });

    it("다시 저장할 때 취소 시각과 리마인더 시각을 비우면 null로 저장되어 undefined로 읽는다", async () => {
      await repository.save(booking({ cancelledAt: at("09:00"), remindedAt: at("09:55") }));

      await repository.save(booking());

      const found = await repository.findById("r-1");
      expect(found?.cancelledAt).toBeUndefined();
      expect(found?.remindedAt).toBeUndefined();
    });
  });

  describe("findByRoom", () => {
    it("해당 회의실의 예약만 시작 시각 순으로 돌려준다", async () => {
      await repository.save(booking({ id: "late", start: at("15:00"), end: at("16:00") }));
      await repository.save(booking({ id: "early", start: at("09:00"), end: at("10:00") }));
      await repository.save(booking({ id: "other-room", roomId: "room-501", start: at("08:00"), end: at("09:00") }));
      await repository.save(booking({ id: "middle", start: at("12:00"), end: at("13:00") }));

      const found = await repository.findByRoom("room-302");

      expect(found.map((r) => r.id)).toEqual(["early", "middle", "late"]);
    });

    it("취소된 예약도 함께 돌려준다", async () => {
      await repository.save(booking({ status: "cancelled", cancelledAt: at("09:00") }));

      const found = await repository.findByRoom("room-302");

      expect(found.map((r) => r.status)).toEqual(["cancelled"]);
    });

    it("예약이 없는 회의실이면 빈 배열을 돌려준다", async () => {
      expect(await repository.findByRoom("room-999")).toEqual([]);
    });
  });

  describe("findStartingBetween", () => {
    it("from 이상 to 미만에 시작하는 예약을 회의실과 관계없이 시작 시각 순으로 돌려준다", async () => {
      await repository.save(booking({ id: "before", start: at("09:59"), end: at("10:30") }));
      await repository.save(booking({ id: "at-from", roomId: "room-501", start: at("10:00"), end: at("10:30") }));
      await repository.save(booking({ id: "inside", start: at("10:30"), end: at("11:30") }));
      await repository.save(booking({ id: "inside-other", roomId: "room-301", start: at("10:15"), end: at("10:45") }));
      await repository.save(booking({ id: "at-to", roomId: "room-501", start: at("11:00"), end: at("12:00") }));

      const found = await repository.findStartingBetween(at("10:00"), at("11:00"));

      expect(found.map((r) => r.id)).toEqual(["at-from", "inside-other", "inside"]);
    });

    it("구간 전에 시작해 구간 안에서 진행 중인 예약은 돌려주지 않는다", async () => {
      await repository.save(booking({ start: at("09:00"), end: at("12:00") }));

      expect(await repository.findStartingBetween(at("10:00"), at("11:00"))).toEqual([]);
    });

    it("취소된 예약도 함께 돌려준다", async () => {
      await repository.save(booking({ status: "cancelled", cancelledAt: at("09:00") }));

      const found = await repository.findStartingBetween(at("10:00"), at("11:00"));

      expect(found.map((r) => r.id)).toEqual(["r-1"]);
    });
  });

  describe("findConflict", () => {
    beforeEach(async () => {
      await repository.save(booking());
    });

    it("같은 회의실에서 구간이 겹치는 예약을 돌려준다", async () => {
      expect((await repository.findConflict("room-302", at("10:30"), at("11:30")))?.id).toBe("r-1");
      expect((await repository.findConflict("room-302", at("09:30"), at("10:30")))?.id).toBe("r-1");
      expect((await repository.findConflict("room-302", at("10:15"), at("10:45")))?.id).toBe("r-1");
      expect((await repository.findConflict("room-302", at("09:00"), at("12:00")))?.id).toBe("r-1");
    });

    it("끝과 시작이 맞닿기만 하면 겹치지 않는다", async () => {
      expect(await repository.findConflict("room-302", at("11:00"), at("12:00"))).toBeUndefined();
      expect(await repository.findConflict("room-302", at("09:00"), at("10:00"))).toBeUndefined();
    });

    it("다른 회의실의 예약은 겹침으로 보지 않는다", async () => {
      expect(await repository.findConflict("room-501", at("10:00"), at("11:00"))).toBeUndefined();
    });

    it("취소된 예약은 겹침으로 보지 않는다", async () => {
      await repository.save(booking({ status: "cancelled", cancelledAt: at("09:00") }));

      expect(await repository.findConflict("room-302", at("10:00"), at("11:00"))).toBeUndefined();
    });

    it("겹치는 예약이 여럿이면 가장 먼저 끝나는 예약을 돌려준다", async () => {
      await repository.save(booking({ id: "r-2", start: at("11:00"), end: at("12:00") }));
      await repository.save(booking({ id: "r-0", start: at("09:00"), end: at("10:00") }));

      const found = await repository.findConflict("room-302", at("09:30"), at("11:30"));

      expect(found?.id).toBe("r-0");
    });
  });

  describe("saveIfAvailable", () => {
    it("겹치는 예약이 없으면 저장하고 true를 돌려준다", async () => {
      const reservation = booking({ remindedAt: at("09:55") });

      expect(await repository.saveIfAvailable(reservation)).toBe(true);
      expect(await repository.findById("r-1")).toEqual(reservation);
    });

    it("같은 회의실에 겹치는 예약이 있으면 저장하지 않고 false를 돌려준다", async () => {
      await repository.save(booking());

      expect(await repository.saveIfAvailable(booking({ id: "r-2", start: at("10:59"), end: at("11:30") }))).toBe(false);
      expect(await repository.saveIfAvailable(booking({ id: "r-3", start: at("09:00"), end: at("10:01") }))).toBe(false);
      expect(await repository.saveIfAvailable(booking({ id: "r-4", start: at("09:00"), end: at("12:00") }))).toBe(false);
      expect(await repository.findById("r-2")).toBeUndefined();
      expect(await repository.findById("r-3")).toBeUndefined();
      expect(await repository.findById("r-4")).toBeUndefined();
    });

    it("끝과 시작이 맞닿는 예약은 저장한다", async () => {
      await repository.save(booking());

      expect(await repository.saveIfAvailable(booking({ id: "after", start: at("11:00"), end: at("12:00") }))).toBe(true);
      expect(await repository.saveIfAvailable(booking({ id: "before", start: at("09:00"), end: at("10:00") }))).toBe(true);
      expect((await repository.findByRoom("room-302")).map((r) => r.id)).toEqual(["before", "r-1", "after"]);
    });

    it("다른 회의실의 같은 시간대 예약은 겹침으로 보지 않는다", async () => {
      await repository.save(booking());

      expect(await repository.saveIfAvailable(booking({ id: "r-2", roomId: "room-501" }))).toBe(true);
    });

    it("취소된 예약의 시간대에는 저장한다", async () => {
      await repository.save(booking({ status: "cancelled", cancelledAt: at("09:00") }));

      expect(await repository.saveIfAvailable(booking({ id: "r-2" }))).toBe(true);
      expect((await repository.findById("r-2"))?.status).toBe("confirmed");
    });
  });

  describe("markReminded", () => {
    it("리마인더를 보내지 않은 확정 예약에 시각을 기록하고 true를 돌려준다", async () => {
      await repository.save(booking());

      expect(await repository.markReminded("r-1", at("09:55"))).toBe(true);
      expect((await repository.findById("r-1"))?.remindedAt).toEqual(at("09:55"));
    });

    it("이미 리마인더를 보낸 예약이면 기록을 바꾸지 않고 false를 돌려준다", async () => {
      await repository.save(booking({ remindedAt: at("09:50") }));

      expect(await repository.markReminded("r-1", at("09:55"))).toBe(false);
      expect((await repository.findById("r-1"))?.remindedAt).toEqual(at("09:50"));
    });

    it("같은 예약에 두 번 기록하면 두 번째는 false를 돌려준다", async () => {
      await repository.save(booking());

      expect(await repository.markReminded("r-1", at("09:55"))).toBe(true);
      expect(await repository.markReminded("r-1", at("09:56"))).toBe(false);
      expect((await repository.findById("r-1"))?.remindedAt).toEqual(at("09:55"));
    });

    it("취소된 예약이면 기록하지 않고 false를 돌려준다", async () => {
      await repository.save(booking({ status: "cancelled", cancelledAt: at("09:00") }));

      expect(await repository.markReminded("r-1", at("09:55"))).toBe(false);
      expect((await repository.findById("r-1"))?.remindedAt).toBeUndefined();
    });

    it("없는 예약이면 false를 돌려준다", async () => {
      expect(await repository.markReminded("missing", at("09:55"))).toBe(false);
    });

    it("리마인더 시각 외의 열은 바꾸지 않는다", async () => {
      const reservation = booking();
      await repository.save(reservation);

      await repository.markReminded("r-1", at("09:55"));

      expect(await repository.findById("r-1")).toEqual({ ...reservation, remindedAt: at("09:55") });
    });
  });

  describe("cancelIfActive", () => {
    it("확정 예약을 취소 상태로 바꾸고 true를 돌려준다", async () => {
      await repository.save(booking());

      expect(await repository.cancelIfActive("r-1", at("09:00"))).toBe(true);

      const found = await repository.findById("r-1");
      expect(found?.status).toBe("cancelled");
      expect(found?.cancelledAt).toEqual(at("09:00"));
    });

    it("이미 취소된 예약이면 취소 시각을 바꾸지 않고 false를 돌려준다", async () => {
      await repository.save(booking({ status: "cancelled", cancelledAt: at("08:30") }));

      expect(await repository.cancelIfActive("r-1", at("09:00"))).toBe(false);
      expect((await repository.findById("r-1"))?.cancelledAt).toEqual(at("08:30"));
    });

    it("없는 예약이면 false를 돌려준다", async () => {
      expect(await repository.cancelIfActive("missing", at("09:00"))).toBe(false);
    });

    it("상태와 취소 시각 외의 열은 바꾸지 않는다", async () => {
      const reservation = booking({ remindedAt: at("08:55") });
      await repository.save(reservation);

      await repository.cancelIfActive("r-1", at("09:00"));

      expect(await repository.findById("r-1")).toEqual({
        ...reservation,
        status: "cancelled",
        cancelledAt: at("09:00"),
      });
    });

    it("취소한 예약의 시간대에는 새 예약을 저장할 수 있다", async () => {
      await repository.save(booking());
      await repository.cancelIfActive("r-1", at("09:00"));

      expect(await repository.saveIfAvailable(booking({ id: "r-2" }))).toBe(true);
    });
  });

  describe("rescheduleIfAvailable", () => {
    it("겹치는 예약이 없으면 시간대를 바꾸고 true를 돌려준다", async () => {
      await repository.save(booking());

      expect(await repository.rescheduleIfAvailable("r-1", at("14:00"), at("15:30"))).toBe(true);

      const found = await repository.findById("r-1");
      expect(found?.start).toEqual(at("14:00"));
      expect(found?.end).toEqual(at("15:30"));
    });

    it("자기 자신의 기존 시간대와 겹치는 시간대로는 바꿀 수 있다", async () => {
      await repository.save(booking());

      expect(await repository.rescheduleIfAvailable("r-1", at("10:30"), at("11:30"))).toBe(true);
      expect((await repository.findById("r-1"))?.start).toEqual(at("10:30"));
    });

    it("같은 회의실의 다른 예약과 겹치면 바꾸지 않고 false를 돌려준다", async () => {
      await repository.save(booking());
      await repository.save(booking({ id: "r-2", start: at("13:00"), end: at("14:00") }));

      expect(await repository.rescheduleIfAvailable("r-2", at("10:30"), at("11:30"))).toBe(false);

      const found = await repository.findById("r-2");
      expect(found?.start).toEqual(at("13:00"));
      expect(found?.end).toEqual(at("14:00"));
    });

    it("다른 예약과 끝과 시작이 맞닿기만 하면 바꾼다", async () => {
      await repository.save(booking());
      await repository.save(booking({ id: "r-2", start: at("13:00"), end: at("14:00") }));

      expect(await repository.rescheduleIfAvailable("r-2", at("11:00"), at("12:00"))).toBe(true);
      expect(await repository.rescheduleIfAvailable("r-2", at("09:00"), at("10:00"))).toBe(true);
    });

    it("다른 회의실이나 취소된 예약과 겹치는 것은 막지 않는다", async () => {
      await repository.save(booking({ id: "other-room", roomId: "room-501", start: at("14:00"), end: at("15:00") }));
      await repository.save(booking({ id: "cancelled", status: "cancelled", cancelledAt: at("09:00"), start: at("16:00"), end: at("17:00") }));
      await repository.save(booking());

      expect(await repository.rescheduleIfAvailable("r-1", at("14:00"), at("15:00"))).toBe(true);
      expect(await repository.rescheduleIfAvailable("r-1", at("16:00"), at("17:00"))).toBe(true);
    });

    it("취소된 예약이면 바꾸지 않고 false를 돌려준다", async () => {
      await repository.save(booking({ status: "cancelled", cancelledAt: at("09:00") }));

      expect(await repository.rescheduleIfAvailable("r-1", at("14:00"), at("15:00"))).toBe(false);
      expect((await repository.findById("r-1"))?.start).toEqual(at("10:00"));
    });

    it("없는 예약이면 false를 돌려준다", async () => {
      expect(await repository.rescheduleIfAvailable("missing", at("14:00"), at("15:00"))).toBe(false);
    });

    it("시간대를 바꾸면 리마인더 기록을 초기화하고 다른 열은 바꾸지 않는다", async () => {
      const reservation = booking({ remindedAt: at("09:55") });
      await repository.save(reservation);

      await repository.rescheduleIfAvailable("r-1", at("14:00"), at("15:00"));

      expect(await repository.findById("r-1")).toEqual({
        ...reservation,
        start: at("14:00"),
        end: at("15:00"),
        remindedAt: undefined,
      });
    });

    it("겹쳐서 바꾸지 못하면 리마인더 기록도 그대로 둔다", async () => {
      await repository.save(booking({ id: "blocker", start: at("14:00"), end: at("15:00") }));
      await repository.save(booking({ remindedAt: at("09:55") }));

      expect(await repository.rescheduleIfAvailable("r-1", at("14:00"), at("15:00"))).toBe(false);
      expect((await repository.findById("r-1"))?.remindedAt).toEqual(at("09:55"));
    });
  });

  describe("moveToRoomIfAvailable", () => {
    const attendees = ["lee@example.com", "park@example.com"];

    it("옮길 회의실의 같은 시간대가 비어 있으면 옮기고 true를 돌려준다", async () => {
      await repository.save(booking());

      expect(await repository.moveToRoomIfAvailable("r-1", "room-501", attendees)).toBe(true);
      expect((await repository.findById("r-1"))?.roomId).toBe("room-501");
      expect(await repository.findByRoom("room-302")).toEqual([]);
    });

    it("옮길 회의실에 겹치는 예약이 있으면 옮기지 않고 false를 돌려준다", async () => {
      await repository.save(booking());
      await repository.save(booking({ id: "blocker", roomId: "room-501", start: at("10:30"), end: at("11:30") }));

      expect(await repository.moveToRoomIfAvailable("r-1", "room-501", attendees)).toBe(false);
      expect((await repository.findById("r-1"))?.roomId).toBe("room-302");
    });

    it("옮길 회의실의 예약과 끝과 시작이 맞닿기만 하면 옮긴다", async () => {
      await repository.save(booking());
      await repository.save(booking({ id: "before", roomId: "room-501", start: at("09:00"), end: at("10:00") }));
      await repository.save(booking({ id: "after", roomId: "room-501", start: at("11:00"), end: at("12:00") }));

      expect(await repository.moveToRoomIfAvailable("r-1", "room-501", attendees)).toBe(true);
    });

    it("옮길 회의실의 겹치는 예약이 취소된 예약이면 옮긴다", async () => {
      await repository.save(booking());
      await repository.save(booking({ id: "cancelled", roomId: "room-501", status: "cancelled", cancelledAt: at("09:00") }));

      expect(await repository.moveToRoomIfAvailable("r-1", "room-501", attendees)).toBe(true);
    });

    it("원래 회의실의 다른 예약은 겹침 검사에 쓰지 않는다", async () => {
      await repository.save(booking());
      await repository.save(booking({ id: "neighbor", start: at("10:30"), end: at("11:30") }));

      expect(await repository.moveToRoomIfAvailable("r-1", "room-501", attendees)).toBe(true);
    });

    it("지금 있는 회의실로 옮기면 자기 자신과 겹침으로 보지 않고 true를 돌려준다", async () => {
      await repository.save(booking());

      expect(await repository.moveToRoomIfAvailable("r-1", "room-302", attendees)).toBe(true);
      expect((await repository.findById("r-1"))?.roomId).toBe("room-302");
    });

    it("참석자 목록이 바뀌었으면 옮기지 않고 false를 돌려준다", async () => {
      await repository.save(booking());

      expect(await repository.moveToRoomIfAvailable("r-1", "room-501", ["lee@example.com"])).toBe(false);
      expect(await repository.moveToRoomIfAvailable("r-1", "room-501", [...attendees, "choi@example.com"])).toBe(false);
      expect((await repository.findById("r-1"))?.roomId).toBe("room-302");
    });

    it("참석자 목록은 순서까지 같아야 옮긴다", async () => {
      await repository.save(booking());

      expect(await repository.moveToRoomIfAvailable("r-1", "room-501", [...attendees].reverse())).toBe(false);
    });

    it("취소된 예약이면 옮기지 않고 false를 돌려준다", async () => {
      await repository.save(booking({ status: "cancelled", cancelledAt: at("09:00") }));

      expect(await repository.moveToRoomIfAvailable("r-1", "room-501", attendees)).toBe(false);
      expect((await repository.findById("r-1"))?.roomId).toBe("room-302");
    });

    it("없는 예약이면 false를 돌려준다", async () => {
      expect(await repository.moveToRoomIfAvailable("missing", "room-501", attendees)).toBe(false);
    });

    it("회의실 외의 열은 바꾸지 않는다", async () => {
      const reservation = booking({ remindedAt: at("09:55") });
      await repository.save(reservation);

      await repository.moveToRoomIfAvailable("r-1", "room-501", attendees);

      expect(await repository.findById("r-1")).toEqual({ ...reservation, roomId: "room-501" });
    });
  });

  describe("updateAttendeesIfUnchanged", () => {
    const previous = ["lee@example.com", "park@example.com"];
    const next = ["lee@example.com", "choi@example.com", "jung@example.com"];

    it("회의실과 이전 참석자 목록이 그대로면 참석자를 바꾸고 true를 돌려준다", async () => {
      await repository.save(booking());

      expect(await repository.updateAttendeesIfUnchanged("r-1", "room-302", previous, next)).toBe(true);
      expect((await repository.findById("r-1"))?.attendees).toEqual(next);
    });

    it("그 사이에 회의실이 바뀌었으면 바꾸지 않고 false를 돌려준다", async () => {
      await repository.save(booking({ roomId: "room-501" }));

      expect(await repository.updateAttendeesIfUnchanged("r-1", "room-302", previous, next)).toBe(false);
      expect((await repository.findById("r-1"))?.attendees).toEqual(previous);
    });

    it("그 사이에 참석자가 바뀌었으면 바꾸지 않고 false를 돌려준다", async () => {
      await repository.save(booking({ attendees: ["lee@example.com"] }));

      expect(await repository.updateAttendeesIfUnchanged("r-1", "room-302", previous, next)).toBe(false);
      expect((await repository.findById("r-1"))?.attendees).toEqual(["lee@example.com"]);
    });

    it("같은 이전 목록으로 두 번 바꾸면 두 번째는 false를 돌려준다", async () => {
      await repository.save(booking());

      expect(await repository.updateAttendeesIfUnchanged("r-1", "room-302", previous, next)).toBe(true);
      expect(await repository.updateAttendeesIfUnchanged("r-1", "room-302", previous, ["x@example.com"])).toBe(false);
      expect((await repository.findById("r-1"))?.attendees).toEqual(next);
    });

    it("빈 참석자 목록에서 바꾸거나 빈 목록으로 바꿀 수 있다", async () => {
      await repository.save(booking({ attendees: [] }));

      expect(await repository.updateAttendeesIfUnchanged("r-1", "room-302", [], next)).toBe(true);
      expect(await repository.updateAttendeesIfUnchanged("r-1", "room-302", next, [])).toBe(true);
      expect((await repository.findById("r-1"))?.attendees).toEqual([]);
    });

    it("취소된 예약이면 바꾸지 않고 false를 돌려준다", async () => {
      await repository.save(booking({ status: "cancelled", cancelledAt: at("09:00") }));

      expect(await repository.updateAttendeesIfUnchanged("r-1", "room-302", previous, next)).toBe(false);
      expect((await repository.findById("r-1"))?.attendees).toEqual(previous);
    });

    it("없는 예약이면 false를 돌려준다", async () => {
      expect(await repository.updateAttendeesIfUnchanged("missing", "room-302", previous, next)).toBe(false);
    });

    it("참석자 외의 열은 바꾸지 않는다", async () => {
      const reservation = booking({ remindedAt: at("09:55") });
      await repository.save(reservation);

      await repository.updateAttendeesIfUnchanged("r-1", "room-302", previous, next);

      expect(await repository.findById("r-1")).toEqual({ ...reservation, attendees: next });
    });
  });
});
