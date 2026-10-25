import type { Room } from "../rooms/room.js";
import type { Reservation } from "../reservations/reservation.js";

const timeFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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

export function rescheduledMail(reservation: Reservation, room: Room) {
  return {
    subject: `[회의실 예약 변경] ${reservation.title}`,
    body: [
      `${room.name}(${room.floor}층) 회의실 예약 시간이 변경되었습니다.`,
      `변경된 일시: ${formatRange(reservation)}`,
    ].join("\n"),
  };
}

export function roomChangedMail(reservation: Reservation, room: Room) {
  return {
    subject: `[회의실 예약 변경] ${reservation.title}`,
    body: [
      `회의실이 ${room.name}(${room.floor}층)으로 변경되었습니다.`,
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
