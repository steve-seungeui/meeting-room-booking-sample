import { describe, expect, it } from "vitest";
import { formatSeoulDate } from "../src/notifications/templates.js";
import { computeOccurrences, WEEK_MS } from "../src/reservations/series.js";
import { validateRecurrence } from "../src/reservations/validation.js";
import { ValidationError } from "../src/shared/errors.js";

const first = {
  start: new Date("2026-11-02T10:00:00+09:00"),
  end: new Date("2026-11-02T11:00:00+09:00"),
};

describe("computeOccurrences", () => {
  it("count만큼 7일 간격으로 회차를 만든다", () => {
    const occurrences = computeOccurrences(first, { frequency: "weekly", count: 3 });

    expect(occurrences.map((range) => range.start.toISOString())).toEqual([
      "2026-11-02T01:00:00.000Z",
      "2026-11-09T01:00:00.000Z",
      "2026-11-16T01:00:00.000Z",
    ]);
    expect(occurrences[2].end.getTime() - occurrences[2].start.getTime()).toBe(60 * 60 * 1000);
  });

  it("until은 그날 시작하는 회차를 포함한다", () => {
    const occurrences = computeOccurrences(first, { frequency: "weekly", until: "2026-11-16" });

    expect(occurrences).toHaveLength(3);
  });

  it("until 전날까지면 그날 회차는 포함하지 않는다", () => {
    const occurrences = computeOccurrences(first, { frequency: "weekly", until: "2026-11-15" });

    expect(occurrences).toHaveLength(2);
  });

  it("요일은 UTC가 아니라 한국 시간 기준이다", () => {
    // 월요일 08:00 KST는 UTC로 일요일 23:00이다.
    const early = {
      start: new Date("2026-11-09T08:00:00+09:00"),
      end: new Date("2026-11-09T09:00:00+09:00"),
    };
    const occurrences = computeOccurrences(early, { frequency: "weekly", until: "2026-11-23" });

    expect(early.start.getUTCDay()).toBe(0);
    expect(occurrences.map((range) => formatSeoulDate(range.start))).toEqual([
      "11월 9일(월)",
      "11월 16일(월)",
      "11월 23일(월)",
    ]);
  });

  it("until로 계산한 회차가 2개 미만이면 거부한다", () => {
    expect(() => computeOccurrences(first, { frequency: "weekly", until: "2026-11-08" })).toThrow(
      ValidationError,
    );
  });

  it("until로 계산한 회차가 26개를 넘으면 거부한다", () => {
    const lastAllowed = new Date(first.start.getTime() + 25 * WEEK_MS).toISOString().slice(0, 10);
    expect(computeOccurrences(first, { frequency: "weekly", until: lastAllowed })).toHaveLength(26);
    expect(() => computeOccurrences(first, { frequency: "weekly", until: "2027-12-31" })).toThrow(
      ValidationError,
    );
  });
});

describe("validateRecurrence", () => {
  it("count나 until 중 하나만 있으면 통과한다", () => {
    expect(validateRecurrence({ frequency: "weekly", count: 12 })).toEqual({ frequency: "weekly", count: 12 });
    expect(validateRecurrence({ frequency: "weekly", until: "2027-01-11" })).toEqual({
      frequency: "weekly",
      until: "2027-01-11",
    });
  });

  it.each([
    ["둘 다 있음", { frequency: "weekly", count: 3, until: "2027-01-11" }],
    ["둘 다 없음", { frequency: "weekly" }],
    ["count 1", { frequency: "weekly", count: 1 }],
    ["count 27", { frequency: "weekly", count: 27 }],
    ["count 소수", { frequency: "weekly", count: 2.5 }],
    ["count 문자열", { frequency: "weekly", count: "3" }],
    ["until 형식 오류", { frequency: "weekly", until: "2027/01/11" }],
    ["없는 날짜", { frequency: "weekly", until: "2027-02-31" }],
    ["weekly가 아님", { frequency: "daily", count: 3 }],
    ["recurrence 없음", undefined],
  ])("%s이면 거부한다", (_name, recurrence) => {
    expect(() => validateRecurrence(recurrence)).toThrow(ValidationError);
  });
});
