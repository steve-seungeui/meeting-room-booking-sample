import { describe, expect, it } from "vitest";
import {
  attendeeInvitedMail,
  attendeeRemovedMail,
  cancelledMail,
  confirmedMail,
  reminderMail,
  rescheduledMail,
  roomChangedMail,
} from "../src/notifications/templates.js";
import type { Reservation } from "../src/reservations/reservation.js";
import { seedRooms } from "../src/rooms/roomRepository.js";

const at = (time: string) => new Date(`2026-11-02T${time}:00+09:00`);

// 백두(3층)
const room = seedRooms[1];

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: "res-1",
    roomId: room.id,
    title: "주간 회의",
    organizer: "kim@example.com",
    attendees: ["lee@example.com"],
    start: at("10:00"),
    end: at("11:00"),
    status: "confirmed",
    createdAt: at("08:00"),
    ...overrides,
  };
}

// Intl 출력의 공백 문자는 Node/ICU 버전에 따라 다를 수 있으므로 공백은 \s*로 느슨하게 비교한다.
const kst = (month: number, day: number, weekday: string, time: string) =>
  new RegExp(`${month}월\\s*${day}일\\s*\\(${weekday}\\)\\s*${time}`);
const range = (from: RegExp, to: RegExp) => new RegExp(`${from.source}\\s*~\\s*${to.source}`);

const tenToEleven = range(kst(11, 2, "월", "10:00"), kst(11, 2, "월", "11:00"));

describe("confirmedMail", () => {
  it("제목에 예약 제목을 넣는다", () => {
    expect(confirmedMail(reservation(), room).subject).toBe("[회의실 예약] 주간 회의");
  });

  it("본문에 회의실 이름과 층, 확정 안내, 일시, 주최자를 넣는다", () => {
    const lines = confirmedMail(reservation(), room).body.split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("백두(3층) 회의실 예약이 확정되었습니다.");
    expect(lines[1]).toMatch(/^일시: /);
    expect(lines[1]).toMatch(tenToEleven);
    expect(lines[2]).toBe("주최: kim@example.com");
  });
});

describe("cancelledMail", () => {
  it("제목에 취소 표시와 예약 제목을 넣는다", () => {
    expect(cancelledMail(reservation(), room).subject).toBe("[회의실 예약 취소] 주간 회의");
  });

  it("본문에 회의실 이름과 층, 취소 안내, 일시를 넣는다", () => {
    const lines = cancelledMail(reservation(), room).body.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("백두(3층) 회의실 예약이 취소되었습니다.");
    expect(lines[1]).toMatch(/^일시: /);
    expect(lines[1]).toMatch(tenToEleven);
  });
});

describe("rescheduledMail", () => {
  it("제목에 변경 표시와 예약 제목을 넣는다", () => {
    expect(rescheduledMail(reservation(), room).subject).toBe("[회의실 예약 변경] 주간 회의");
  });

  it("본문에 회의실 이름과 층, 시간 변경 안내, 변경된 일시를 넣는다", () => {
    const lines = rescheduledMail(reservation({ start: at("14:00"), end: at("15:30") }), room).body.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("백두(3층) 회의실 예약 시간이 변경되었습니다.");
    expect(lines[1]).toMatch(/^변경된 일시: /);
    expect(lines[1]).toMatch(range(kst(11, 2, "월", "14:00"), kst(11, 2, "월", "15:30")));
  });
});

describe("roomChangedMail", () => {
  it("제목에 변경 표시와 예약 제목을 넣는다", () => {
    expect(roomChangedMail(reservation(), room).subject).toBe("[회의실 예약 변경] 주간 회의");
  });

  it("본문에 새 회의실 이름과 층, 일시를 넣는다", () => {
    const newRoom = seedRooms[2]; // 지리(5층)
    const lines = roomChangedMail(reservation({ roomId: newRoom.id }), newRoom).body.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("회의실이 지리(5층)으로 변경되었습니다.");
    expect(lines[1]).toMatch(/^일시: /);
    expect(lines[1]).toMatch(tenToEleven);
  });
});

describe("attendeeInvitedMail", () => {
  it("제목에 초대 표시와 예약 제목을 넣는다", () => {
    expect(attendeeInvitedMail(reservation(), room).subject).toBe("[회의 초대] 주간 회의");
  });

  it("본문에 회의실 이름과 층, 초대 안내, 일시, 주최자를 넣는다", () => {
    const lines = attendeeInvitedMail(reservation(), room).body.split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("백두(3층) 회의실에서 열리는 회의에 초대되었습니다.");
    expect(lines[1]).toMatch(/^일시: /);
    expect(lines[1]).toMatch(tenToEleven);
    expect(lines[2]).toBe("주최: kim@example.com");
  });
});

describe("attendeeRemovedMail", () => {
  it("제목에 참석 취소 표시와 예약 제목을 넣는다", () => {
    expect(attendeeRemovedMail(reservation(), room).subject).toBe("[회의 참석 취소] 주간 회의");
  });

  it("본문에 회의실 이름과 층, 제외 안내, 일시를 넣는다", () => {
    const lines = attendeeRemovedMail(reservation(), room).body.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("백두(3층) 회의실에서 열리는 회의의 참석자에서 제외되었습니다.");
    expect(lines[1]).toMatch(/^일시: /);
    expect(lines[1]).toMatch(tenToEleven);
  });
});

describe("reminderMail", () => {
  it("제목에 곧 시작 표시와 예약 제목을 넣는다", () => {
    expect(reminderMail(reservation(), room).subject).toBe("[곧 시작] 주간 회의");
  });

  it("본문에 회의실 이름과 층, 시작 시각만 넣고 종료 시각은 넣지 않는다", () => {
    const body = reminderMail(reservation(), room).body;

    expect(body).toMatch(/^백두\(3층\) 회의실에서 /);
    expect(body).toMatch(new RegExp(`${kst(11, 2, "월", "10:00").source}에 회의가 시작됩니다\\.$`));
    expect(body).not.toContain("11:00");
    expect(body).not.toContain("\n");
  });
});

describe("시각 표기", () => {
  it("월, 일, 요일, 두 자리 시:분 순서로 표기한다", () => {
    const body = confirmedMail(reservation({ start: at("09:05"), end: at("09:30") }), room).body;

    expect(body).toMatch(range(kst(11, 2, "월", "09:05"), kst(11, 2, "월", "09:30")));
  });

  it("오전/오후 대신 24시간제로 표기한다", () => {
    const body = confirmedMail(reservation({ start: at("13:00"), end: at("18:45") }), room).body;

    expect(body).toMatch(range(kst(11, 2, "월", "13:00"), kst(11, 2, "월", "18:45")));
    expect(body).not.toMatch(/오전|오후|AM|PM/);
  });

  it("UTC로는 전날인 KST 이른 아침도 KST 날짜와 요일로 표기한다", () => {
    // 2026-11-02 07:30 KST = 2026-11-01 22:30 UTC (일요일)
    const body = confirmedMail(reservation({ start: at("07:30"), end: at("08:30") }), room).body;

    expect(body).toMatch(range(kst(11, 2, "월", "07:30"), kst(11, 2, "월", "08:30")));
    expect(body).not.toContain("1일");
    expect(body).not.toContain("(일)");
  });

  it("KST 자정은 24:00이 아니라 다음 날 00:00으로 표기한다", () => {
    const body = confirmedMail(
      reservation({ start: at("23:00"), end: new Date("2026-11-03T00:00:00+09:00") }),
      room,
    ).body;

    expect(body).toMatch(range(kst(11, 2, "월", "23:00"), kst(11, 3, "화", "00:00")));
    expect(body).not.toContain("24:");
  });

  it("KST 자정 직후 시작하는 예약은 00시로 표기한다", () => {
    const body = reminderMail(reservation({ start: at("00:30"), end: at("01:00") }), room).body;

    expect(body).toMatch(kst(11, 2, "월", "00:30"));
    expect(body).not.toContain("24:");
  });

  it("월말을 넘기는 날짜도 KST 기준으로 표기한다", () => {
    // 2026-12-01 08:00 KST = 2026-11-30 23:00 UTC
    const body = reminderMail(
      reservation({ start: new Date("2026-12-01T08:00:00+09:00"), end: new Date("2026-12-01T09:00:00+09:00") }),
      room,
    ).body;

    expect(body).toMatch(kst(12, 1, "화", "08:00"));
  });

  it("같은 날 안의 예약도 시작과 끝 모두에 날짜를 붙인다", () => {
    const body = confirmedMail(reservation(), room).body;

    expect(body.match(/11월\s*2일\s*\(월\)/g)).toHaveLength(2);
  });
});
