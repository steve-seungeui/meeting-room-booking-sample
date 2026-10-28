import { ValidationError } from "../shared/errors.js";
import type { Room } from "../rooms/room.js";
import type { NewReservation } from "./reservation.js";

export const MAX_DURATION_MINUTES = 240;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNewReservation(input: NewReservation, room: Room, now: Date): void {
  if (!input.title.trim()) {
    throw new ValidationError("회의 제목을 입력해야 합니다.");
  }
  if (!EMAIL_PATTERN.test(input.organizer)) {
    throw new ValidationError(`주최자 이메일 형식이 올바르지 않습니다: ${input.organizer}`);
  }
  validateAttendeeEmails(input.attendees);
  validateTimeRange(input.start, input.end, now);
  validateHeadcount(input.organizer, input.attendees, room);
}

export function validateAttendeeEmails(attendees: string[]): void {
  const invalidAttendee = attendees.find((email) => !EMAIL_PATTERN.test(email));
  if (invalidAttendee) {
    throw new ValidationError(`참석자 이메일 형식이 올바르지 않습니다: ${invalidAttendee}`);
  }
}

/** 주최자를 포함한 참석 인원(중복 제외)이 회의실의 수용 인원을 넘으면 거절한다. */
export function validateHeadcount(organizer: string, attendees: string[], room: Room): void {
  const headcount = new Set([organizer, ...attendees]).size;
  if (headcount > room.capacity) {
    throw new ValidationError(
      `참석 인원 ${headcount}명이 ${room.name} 회의실의 수용 인원 ${room.capacity}명을 넘습니다.`,
    );
  }
}

export function validateTimeRange(start: Date, end: Date, now: Date): void {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError("시작 시각과 종료 시각은 ISO 8601 형식이어야 합니다.");
  }
  if (start >= end) {
    throw new ValidationError("종료 시각은 시작 시각보다 늦어야 합니다.");
  }
  if (start < now) {
    throw new ValidationError("이미 지난 시각으로는 예약할 수 없습니다.");
  }
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  if (minutes > MAX_DURATION_MINUTES) {
    throw new ValidationError(`한 번에 ${MAX_DURATION_MINUTES / 60}시간을 넘게 예약할 수 없습니다.`);
  }
}
