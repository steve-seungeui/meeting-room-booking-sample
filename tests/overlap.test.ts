import { describe, expect, it } from "vitest";
import { overlaps } from "../src/reservations/overlap.js";

const at = (time: string) => new Date(`2026-11-02T${time}:00+09:00`);
const range = (start: string, end: string) => ({ start: at(start), end: at(end) });

describe("overlaps", () => {
  it("일부가 겹치면 겹친다", () => {
    expect(overlaps(range("10:00", "11:00"), range("10:30", "11:30"))).toBe(true);
  });

  it("한쪽이 다른 쪽을 포함하면 겹친다", () => {
    expect(overlaps(range("10:00", "12:00"), range("10:30", "11:00"))).toBe(true);
  });

  it("끝나는 시각에 시작하면 겹치지 않는다", () => {
    expect(overlaps(range("10:00", "11:00"), range("11:00", "12:00"))).toBe(false);
  });

  it("떨어져 있으면 겹치지 않는다", () => {
    expect(overlaps(range("09:00", "10:00"), range("13:00", "14:00"))).toBe(false);
  });
});
