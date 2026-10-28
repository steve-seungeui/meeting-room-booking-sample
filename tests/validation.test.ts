import { describe, expect, it } from "vitest";
import type { NewReservation } from "../src/reservations/reservation.js";
import {
  MAX_DURATION_MINUTES,
  validateAttendeeEmails,
  validateHeadcount,
  validateNewReservation,
  validateTimeRange,
} from "../src/reservations/validation.js";
import type { Room } from "../src/rooms/room.js";
import { seedRooms } from "../src/rooms/roomRepository.js";
import { fixedClock } from "../src/shared/clock.js";
import { ValidationError } from "../src/shared/errors.js";

const at = (time: string) => new Date(`2026-11-02T${time}:00+09:00`);
const clock = fixedClock("2026-11-02T08:00:00+09:00");

// 한라: 수용 인원 4명
const halla = seedRooms.find((room) => room.id === "room-301")!;
const roomWithCapacity = (capacity: number): Room => ({
  id: "room-test",
  name: "테스트",
  floor: 1,
  capacity,
  equipment: [],
});

const newReservation = (overrides: Partial<NewReservation> = {}): NewReservation => ({
  roomId: halla.id,
  title: "주간 회의",
  organizer: "kim@example.com",
  attendees: ["lee@example.com", "park@example.com"],
  start: at("10:00"),
  end: at("11:00"),
  ...overrides,
});

describe("validateNewReservation", () => {
  it("올바른 예약이면 통과한다", () => {
    expect(() => validateNewReservation(newReservation(), halla, clock.now())).not.toThrow();
  });

  it("참석자가 없어도 통과한다", () => {
    expect(() => validateNewReservation(newReservation({ attendees: [] }), halla, clock.now())).not.toThrow();
  });

  it("제목이 비어 있으면 거절한다", () => {
    expect(() => validateNewReservation(newReservation({ title: "" }), halla, clock.now())).toThrow(
      ValidationError,
    );
  });

  it("제목이 공백 문자로만 되어 있으면 거절한다", () => {
    for (const title of ["   ", "\t", "\n ", "　"]) {
      expect(() => validateNewReservation(newReservation({ title }), halla, clock.now())).toThrow(
        "회의 제목을 입력해야 합니다.",
      );
    }
  });

  it("제목 앞뒤에 공백이 있어도 내용이 있으면 통과한다", () => {
    expect(() =>
      validateNewReservation(newReservation({ title: "  주간 회의  " }), halla, clock.now()),
    ).not.toThrow();
  });

  it("주최자 이메일 형식이 올바르지 않으면 거절한다", () => {
    for (const organizer of ["", "kim", "kim@example", "@example.com", "kim @example.com", "kim@@example.com"]) {
      expect(() => validateNewReservation(newReservation({ organizer }), halla, clock.now())).toThrow(
        ValidationError,
      );
    }
  });

  it("주최자 이메일이 잘못되면 오류 메시지에 그 값을 담는다", () => {
    expect(() => validateNewReservation(newReservation({ organizer: "kim" }), halla, clock.now())).toThrow(
      "주최자 이메일 형식이 올바르지 않습니다: kim",
    );
  });

  it("참석자 이메일 형식이 올바르지 않으면 거절한다", () => {
    expect(() =>
      validateNewReservation(newReservation({ attendees: ["lee@example.com", "park"] }), halla, clock.now()),
    ).toThrow("참석자 이메일 형식이 올바르지 않습니다: park");
  });

  // 버그: 기대 동작은 참석자에 빈 문자열이 있으면 ValidationError로 거절하는 것이다.
  // 실제로는 validateAttendeeEmails가 ""를 통과시켜 예약이 그대로 검증을 통과한다.
  it.fails("참석자에 빈 문자열이 있으면 거절한다", () => {
    expect(() =>
      validateNewReservation(newReservation({ attendees: ["lee@example.com", ""] }), halla, clock.now()),
    ).toThrow(ValidationError);
  });

  it("시간 범위가 올바르지 않으면 거절한다", () => {
    expect(() =>
      validateNewReservation(newReservation({ start: at("11:00"), end: at("10:00") }), halla, clock.now()),
    ).toThrow("종료 시각은 시작 시각보다 늦어야 합니다.");
  });

  it("참석 인원이 회의실 수용 인원을 넘으면 거절한다", () => {
    const attendees = ["a@example.com", "b@example.com", "c@example.com", "d@example.com"];
    expect(() => validateNewReservation(newReservation({ attendees }), halla, clock.now())).toThrow(
      "참석 인원 5명이 한라 회의실의 수용 인원 4명을 넘습니다.",
    );
  });

  it("여러 항목이 잘못되면 제목 오류를 먼저 알린다", () => {
    const input = newReservation({ title: " ", organizer: "kim", start: at("11:00"), end: at("10:00") });
    expect(() => validateNewReservation(input, halla, clock.now())).toThrow("회의 제목을 입력해야 합니다.");
  });

  it("시간과 인원이 모두 잘못되면 시간 오류를 먼저 알린다", () => {
    const attendees = ["a@example.com", "b@example.com", "c@example.com", "d@example.com"];
    const input = newReservation({ attendees, start: at("07:00"), end: at("08:00") });
    expect(() => validateNewReservation(input, halla, clock.now())).toThrow(
      "이미 지난 시각으로는 예약할 수 없습니다.",
    );
  });
});

describe("validateAttendeeEmails", () => {
  it("빈 목록이면 통과한다", () => {
    expect(() => validateAttendeeEmails([])).not.toThrow();
  });

  it("모든 이메일이 올바르면 통과한다", () => {
    expect(() => validateAttendeeEmails(["lee@example.com", "park.j+team@corp.example.co.kr"])).not.toThrow();
  });

  it("형식이 잘못된 이메일이 있으면 거절한다", () => {
    for (const email of ["lee", "lee@example", "lee@", "@example.com", "le e@example.com", "lee@exa mple.com"]) {
      expect(() => validateAttendeeEmails(["park@example.com", email])).toThrow(ValidationError);
    }
  });

  it("잘못된 이메일이 여럿이면 첫 번째 값을 오류 메시지에 담는다", () => {
    expect(() => validateAttendeeEmails(["lee@example.com", "first", "second"])).toThrow(
      "참석자 이메일 형식이 올바르지 않습니다: first",
    );
  });

  // 버그: 기대 동작은 빈 문자열 참석자 이메일을 형식 오류로 거절하는 것이다.
  // 실제로는 find()가 돌려준 ""가 falsy라서 if (invalidAttendee) 분기를 건너뛰고 통과한다.
  it.fails("빈 문자열 이메일도 거절한다", () => {
    let error: unknown;
    try {
      validateAttendeeEmails(["lee@example.com", ""]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("참석자 이메일 형식이 올바르지 않습니다: ");
  });
});

describe("validateHeadcount", () => {
  it("주최자를 포함한 인원이 수용 인원과 같으면 통과한다", () => {
    expect(() =>
      validateHeadcount("kim@example.com", ["a@example.com", "b@example.com", "c@example.com"], halla),
    ).not.toThrow();
  });

  it("주최자를 포함한 인원이 수용 인원보다 하나 많으면 거절한다", () => {
    expect(() =>
      validateHeadcount(
        "kim@example.com",
        ["a@example.com", "b@example.com", "c@example.com", "d@example.com"],
        halla,
      ),
    ).toThrow(ValidationError);
  });

  it("참석자 없이 주최자만 있으면 1명으로 센다", () => {
    expect(() => validateHeadcount("kim@example.com", [], roomWithCapacity(1))).not.toThrow();
    expect(() => validateHeadcount("kim@example.com", [], roomWithCapacity(0))).toThrow(
      "참석 인원 1명이 테스트 회의실의 수용 인원 0명을 넘습니다.",
    );
  });

  it("주최자가 참석자 목록에도 있으면 한 번만 센다", () => {
    const attendees = ["kim@example.com", "a@example.com", "b@example.com", "c@example.com"];
    expect(() => validateHeadcount("kim@example.com", attendees, halla)).not.toThrow();
  });

  it("참석자 목록에 같은 이메일이 반복되면 한 번만 센다", () => {
    const attendees = ["a@example.com", "a@example.com", "b@example.com", "b@example.com", "c@example.com"];
    expect(() => validateHeadcount("kim@example.com", attendees, halla)).not.toThrow();
  });

  it("거절할 때 중복을 뺀 인원과 회의실 정보를 메시지에 담는다", () => {
    const attendees = ["kim@example.com", "a@example.com", "b@example.com", "c@example.com", "d@example.com"];
    expect(() => validateHeadcount("kim@example.com", attendees, halla)).toThrow(
      "참석 인원 5명이 한라 회의실의 수용 인원 4명을 넘습니다.",
    );
  });

  // 확인 필요: 이메일 대소문자만 다른 경우 같은 사람으로 보지 않고 따로 센다(현재 동작).
  it("대소문자만 다른 이메일은 서로 다른 사람으로 센다", () => {
    expect(() => validateHeadcount("kim@example.com", ["KIM@example.com"], roomWithCapacity(1))).toThrow(
      ValidationError,
    );
  });
});

describe("validateTimeRange", () => {
  const now = clock.now();

  it("올바른 시간 범위면 통과한다", () => {
    expect(() => validateTimeRange(at("10:00"), at("11:00"), now)).not.toThrow();
  });

  it("시작 시각이 현재 시각과 같으면 통과한다", () => {
    expect(() => validateTimeRange(at("08:00"), at("09:00"), now)).not.toThrow();
  });

  it("시작 시각이 현재보다 1밀리초라도 이르면 거절한다", () => {
    const start = new Date(now.getTime() - 1);
    expect(() => validateTimeRange(start, at("09:00"), now)).toThrow("이미 지난 시각으로는 예약할 수 없습니다.");
  });

  it("정확히 240분이면 통과한다", () => {
    expect(MAX_DURATION_MINUTES).toBe(240);
    expect(() => validateTimeRange(at("10:00"), at("14:00"), now)).not.toThrow();
  });

  it("240분을 1분이라도 넘으면 거절한다", () => {
    expect(() => validateTimeRange(at("10:00"), at("14:01"), now)).toThrow(
      "한 번에 4시간을 넘게 예약할 수 없습니다.",
    );
  });

  it("240분을 1밀리초라도 넘으면 거절한다", () => {
    const end = new Date(at("14:00").getTime() + 1);
    expect(() => validateTimeRange(at("10:00"), end, now)).toThrow(ValidationError);
  });

  it("시작과 종료가 같으면 거절한다", () => {
    expect(() => validateTimeRange(at("10:00"), at("10:00"), now)).toThrow(
      "종료 시각은 시작 시각보다 늦어야 합니다.",
    );
  });

  it("종료가 시작보다 이르면 거절한다", () => {
    expect(() => validateTimeRange(at("11:00"), at("10:00"), now)).toThrow(
      "종료 시각은 시작 시각보다 늦어야 합니다.",
    );
  });

  it("시작 시각이 날짜가 아니면 거절한다", () => {
    expect(() => validateTimeRange(new Date("not-a-date"), at("10:00"), now)).toThrow(
      "시작 시각과 종료 시각은 ISO 8601 형식이어야 합니다.",
    );
  });

  it("종료 시각이 날짜가 아니면 거절한다", () => {
    expect(() => validateTimeRange(at("10:00"), new Date(Number.NaN), now)).toThrow(
      "시작 시각과 종료 시각은 ISO 8601 형식이어야 합니다.",
    );
  });

  it("지난 시각이면서 순서도 거꾸로면 순서 오류를 먼저 알린다", () => {
    expect(() => validateTimeRange(at("07:00"), at("06:00"), now)).toThrow(
      "종료 시각은 시작 시각보다 늦어야 합니다.",
    );
  });

  it("거절할 때 ValidationError의 코드와 상태는 400이다", () => {
    let error: unknown;
    try {
      validateTimeRange(at("10:00"), at("10:00"), now);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });
});
