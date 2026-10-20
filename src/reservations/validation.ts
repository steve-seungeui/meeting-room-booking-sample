import { ValidationError } from "../shared/errors.js";
import type { Room } from "../rooms/room.js";
import type { NewReservation } from "./reservation.js";
import { MAX_SERIES_OCCURRENCES, MIN_SERIES_OCCURRENCES, type Recurrence } from "./series.js";

export const MAX_DURATION_MINUTES = 240;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNewReservation(input: NewReservation, room: Room, now: Date): void {
  if (!input.title.trim()) {
    throw new ValidationError("회의 제목을 입력해야 합니다.");
  }
  if (!EMAIL_PATTERN.test(input.organizer)) {
    throw new ValidationError(`주최자 이메일 형식이 올바르지 않습니다: ${input.organizer}`);
  }
  const invalidAttendee = input.attendees.find((email) => !EMAIL_PATTERN.test(email));
  if (invalidAttendee) {
    throw new ValidationError(`참석자 이메일 형식이 올바르지 않습니다: ${invalidAttendee}`);
  }
  if (Number.isNaN(input.start.getTime()) || Number.isNaN(input.end.getTime())) {
    throw new ValidationError("시작 시각과 종료 시각은 ISO 8601 형식이어야 합니다.");
  }
  if (input.start >= input.end) {
    throw new ValidationError("종료 시각은 시작 시각보다 늦어야 합니다.");
  }
  if (input.start < now) {
    throw new ValidationError("이미 지난 시각으로는 예약할 수 없습니다.");
  }
  const minutes = (input.end.getTime() - input.start.getTime()) / 60_000;
  if (minutes > MAX_DURATION_MINUTES) {
    throw new ValidationError(`한 번에 ${MAX_DURATION_MINUTES / 60}시간을 넘게 예약할 수 없습니다.`);
  }
  const headcount = new Set([input.organizer, ...input.attendees]).size;
  if (headcount > room.capacity) {
    throw new ValidationError(
      `참석 인원 ${headcount}명이 ${room.name} 회의실의 수용 인원 ${room.capacity}명을 넘습니다.`,
    );
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 2026-02-31처럼 다음 달로 넘어가는 날짜를 거른다. */
function isCalendarDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** 요청의 recurrence 값을 검증해 반복 규칙으로 돌려준다. */
export function validateRecurrence(raw: unknown): Recurrence {
  if (typeof raw !== "object" || raw === null) {
    throw new ValidationError("recurrence 값이 필요합니다.");
  }
  const { frequency, count, until } = raw as Record<string, unknown>;
  if (frequency !== "weekly") {
    throw new ValidationError("반복 주기는 weekly만 지원합니다.");
  }
  if ((count === undefined) === (until === undefined)) {
    throw new ValidationError("count와 until 중 정확히 하나를 지정해야 합니다.");
  }
  if (count !== undefined) {
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < MIN_SERIES_OCCURRENCES ||
      count > MAX_SERIES_OCCURRENCES
    ) {
      throw new ValidationError(
        `count는 ${MIN_SERIES_OCCURRENCES} 이상 ${MAX_SERIES_OCCURRENCES} 이하의 정수여야 합니다.`,
      );
    }
    return { frequency, count };
  }
  if (
    typeof until !== "string" ||
    !DATE_PATTERN.test(until) ||
    !isCalendarDate(until)
  ) {
    throw new ValidationError("until은 YYYY-MM-DD 형식이어야 합니다.");
  }
  return { frequency, until };
}
