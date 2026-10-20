import type { Room } from "../rooms/room.js";
import type { Reservation } from "../reservations/reservation.js";
import { WEEK_MS, type ReservationSeries } from "../reservations/series.js";

const timeFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "short",
});

const weekdayFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "long" });

const clockFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 한국 시간 기준 날짜를 "11월 3일(월)" 형식으로 표기한다. Intl은 요일 앞에 공백을 넣으므로 직접 조립한다. */
export function formatSeoulDate(date: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dateFormat.formatToParts(date).find((item) => item.type === type)?.value;
  return `${part("month")} ${part("day")}일(${part("weekday")})`;
}

/** "매주 월요일 10:00 ~ 11:00" 형식으로 반복 요일과 시각을 표기한다. */
function formatWeekly(series: ReservationSeries): string {
  return `매주 ${weekdayFormat.format(series.firstStart)} ${clockFormat.format(series.firstStart)} ~ ${clockFormat.format(series.firstEnd)}`;
}

function formatRange(reservation: Reservation): string {
  return `${timeFormat.format(reservation.start)} ~ ${timeFormat.format(reservation.end)}`;
}

export function confirmedMail(reservation: Reservation, room: Room) {
  return {
    subject: `[회의실 예약] ${reservation.title}`,
    body: [
      `${room.name}(${room.floor}층) 회의실 예약이 확정되었습니다.`,
      `일시: ${formatRange(reservation)}`,
      `주최: ${reservation.organizer}`,
    ].join("\n"),
  };
}

export function cancelledMail(reservation: Reservation, room: Room) {
  return {
    subject: `[회의실 예약 취소] ${reservation.title}`,
    body: [
      `${room.name}(${room.floor}층) 회의실 예약이 취소되었습니다.`,
      `일시: ${formatRange(reservation)}`,
    ].join("\n"),
  };
}

export function reminderMail(reservation: Reservation, room: Room) {
  return {
    subject: `[곧 시작] ${reservation.title}`,
    body: `${room.name}(${room.floor}층) 회의실에서 ${timeFormat.format(reservation.start)}에 회의가 시작됩니다.`,
  };
}

export function seriesConfirmedMail(series: ReservationSeries, room: Room) {
  const lastStart = new Date(series.firstStart.getTime() + (series.count - 1) * WEEK_MS);
  return {
    subject: `[회의실 반복 예약] ${series.title}`,
    body: [
      `${room.name}(${room.floor}층) 회의실 반복 예약이 확정되었습니다.`,
      `반복: ${formatWeekly(series)}`,
      `기간: ${formatSeoulDate(series.firstStart)} ~ ${formatSeoulDate(lastStart)} (${series.count}회)`,
      `주최: ${series.organizer}`,
    ].join("\n"),
  };
}

export function seriesCancelledMail(series: ReservationSeries, room: Room, cancelledCount: number) {
  return {
    subject: `[회의실 반복 예약 취소] ${series.title}`,
    body: [
      `${room.name}(${room.floor}층) 회의실 반복 예약이 취소되었습니다.`,
      `반복: ${formatWeekly(series)}`,
      `취소된 회차: ${cancelledCount}회`,
    ].join("\n"),
  };
}
