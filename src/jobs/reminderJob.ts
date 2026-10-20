import { sendMail } from "../notifications/legacyMailer.js";
import { reminderMail } from "../notifications/templates.js";
import type { ReservationRepository } from "../reservations/reservationRepository.js";
import type { RoomService } from "../rooms/roomService.js";
import type { Clock } from "../shared/clock.js";

export const REMINDER_LEAD_MINUTES = 10;

/**
 * 곧 시작하는 회의의 참석자에게 알림을 보낸다. 서버가 1분마다 실행한다.
 * 이미 알림을 보낸 예약은 다시 보내지 않는다.
 */
export async function runReminderJob(
  reservations: ReservationRepository,
  rooms: RoomService,
  clock: Clock,
): Promise<number> {
  const now = clock.now();
  const until = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60_000);
  const upcoming = await reservations.findStartingBetween(now, until);

  let sent = 0;
  for (const reservation of upcoming) {
    if (reservation.status !== "confirmed" || reservation.remindedAt) {
      continue;
    }
    const room = await rooms.get(reservation.roomId);
    const mail = reminderMail(reservation, room);
    await sendMail({ to: [reservation.organizer, ...reservation.attendees], ...mail });
    await reservations.save({ ...reservation, remindedAt: now });
    sent += 1;
  }
  return sent;
}
