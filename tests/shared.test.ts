import { describe, expect, it } from "vitest";
import { fixedClock, systemClock } from "../src/shared/clock.js";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "../src/shared/errors.js";
import { newId } from "../src/shared/ids.js";

describe("DomainError 하위 오류", () => {
  const cases = [
    { name: "ValidationError", create: (message: string) => new ValidationError(message), code: "VALIDATION_FAILED", status: 400 },
    { name: "NotFoundError", create: (message: string) => new NotFoundError(message), code: "NOT_FOUND", status: 404 },
    { name: "ConflictError", create: (message: string) => new ConflictError(message), code: "CONFLICT", status: 409 },
  ];

  for (const { name, create, code, status } of cases) {
    it(`${name}는 ${code} 코드와 ${status} 상태를 가진다`, () => {
      const error = create("오류");

      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
    });

    it(`${name}는 name이 클래스 이름이고 넘긴 메시지를 그대로 가진다`, () => {
      const error = create("이미 예약된 시간입니다");

      expect(error.name).toBe(name);
      expect(error.message).toBe("이미 예약된 시간입니다");
      expect(String(error)).toBe(`${name}: 이미 예약된 시간입니다`);
    });

    it(`${name}는 DomainError이자 Error다`, () => {
      const error = create("오류");

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(Error);
    });
  }

  it("서로 다른 하위 오류끼리는 instanceof로 구분된다", () => {
    expect(new ValidationError("x")).not.toBeInstanceOf(NotFoundError);
    expect(new NotFoundError("x")).not.toBeInstanceOf(ConflictError);
    expect(new ConflictError("x")).not.toBeInstanceOf(ValidationError);
  });

  it("DomainError를 직접 만들면 넘긴 코드와 상태를 가지고 name은 DomainError다", () => {
    const error = new DomainError("직접 만든 오류", "CUSTOM", 418);

    expect(error.code).toBe("CUSTOM");
    expect(error.status).toBe(418);
    expect(error.name).toBe("DomainError");
  });
});

describe("fixedClock", () => {
  it("매번 같은 시각을 돌려준다", () => {
    const clock = fixedClock("2026-11-02T08:00:00+09:00");

    expect(clock.now().toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(clock.now().getTime()).toBe(clock.now().getTime());
  });

  it("호출할 때마다 새 Date 객체를 돌려준다", () => {
    const clock = fixedClock("2026-11-02T08:00:00+09:00");

    expect(clock.now()).not.toBe(clock.now());
  });

  it("돌려받은 Date를 바꿔도 다음 호출에는 영향이 없다", () => {
    const clock = fixedClock("2026-11-02T08:00:00+09:00");

    const first = clock.now();
    first.setFullYear(2000);
    first.setHours(first.getHours() + 5);

    expect(clock.now().toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });
});

describe("systemClock", () => {
  it("현재 시각을 돌려준다", () => {
    const before = Date.now();
    const now = systemClock.now();
    const after = Date.now();

    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it("호출할 때마다 새 Date 객체를 돌려준다", () => {
    expect(systemClock.now()).not.toBe(systemClock.now());
  });
});

describe("newId", () => {
  it("접두사_와 8자리 16진수로 이루어진다", () => {
    expect(newId("res")).toMatch(/^res_[0-9a-f]{8}$/);
    expect(newId("room")).toMatch(/^room_[0-9a-f]{8}$/);
  });

  it("여러 번 호출하면 서로 다른 id를 돌려준다", () => {
    // 8자리 16진수(32비트)라 표본이 크면 우연한 충돌로 가끔 실패할 수 있어 100개만 확인한다.
    const ids = Array.from({ length: 100 }, () => newId("res"));

    expect(new Set(ids).size).toBe(ids.length);
  });
});
