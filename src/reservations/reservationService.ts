import { sendMail } from "../notifications/legacyMailer.js";
import { cancelledMail, confirmedMail, rescheduledMail } from "../notifications/templates.js";
import type { RoomService } from "../rooms/roomService.js";
import type { Clock } from "../shared/clock.js";
import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { newId } from "../shared/ids.js";
import { overlaps } from "./overlap.js";
import type { NewReservation, Reservation } from "./reservation.js";
import type { ReservationRepository } from "./reservationRepository.js";
import { validateNewReservation, validateTimeRange } from "./validation.js";

export class ReservationService {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly rooms: RoomService,
    private readonly clock: Clock,
  ) {}

  async create(input: NewReservation): Promise<Reservation> {
    const room = await this.rooms.get(input.roomId);
    const now = this.clock.now();
    validateNewReservation(input, room, now);

    const reservation: Reservation = {
      id: newId("rsv"),
      roomId: input.roomId,
      title: input.title.trim(),
      organizer: input.organizer,
      attendees: [...new Set(input.attendees)],
      start: input.start,
      end: input.end,
      status: "confirmed",
      createdAt: now,
    };
    if (!(await this.reservations.saveIfAvailable(reservation))) {
      // 메시지에 쓸 충돌 예약을 찾는 조회일 뿐, 겹침 여부는 위의 저장 시도가 이미 결정했다.
      const conflict = await this.reservations.findConflict(input.roomId, input.start, input.end);
      throw new ConflictError(
        `${room.name} 회의실은 해당 시간에 이미 예약되어 있습니다${conflict ? `: ${conflict.title}` : ""}`,
      );
    }

    const mail = confirmedMail(reservation, room);
    await sendMail({ to: [reservation.organizer, ...reservation.attendees], ...mail });
    return reservation;
  }

  async cancel(id: string, requestedBy: string): Promise<Reservation> {
    const reservation = await this.get(id);
    if (reservation.status === "cancelled") {
      return reservation;
    }
    if (reservation.organizer !== requestedBy) {
      throw new ValidationError("예약을 만든 사람만 취소할 수 있습니다.");
    }
    const cancelled: Reservation = {
      ...reservation,
      status: "cancelled",
      cancelledAt: this.clock.now(),
    };
    await this.reservations.save(cancelled);

    const room = await this.rooms.get(reservation.roomId);
    const mail = cancelledMail(cancelled, room);
    await sendMail({ to: [cancelled.organizer, ...cancelled.attendees], ...mail });
    return cancelled;
  }

  async reschedule(id: string, requestedBy: string, start: Date, end: Date): Promise<Reservation> {
    const reservation = await this.get(id);
    if (reservation.organizer !== requestedBy) {
      throw new ValidationError("예약을 만든 사람만 시간을 바꿀 수 있습니다.");
    }
    if (reservation.status === "cancelled") {
      throw new ValidationError("취소된 예약의 시간은 바꿀 수 없습니다.");
    }
    validateTimeRange(start, end, this.clock.now());

    const room = await this.rooms.get(reservation.roomId);
    if (!(await this.reservations.rescheduleIfAvailable(id, start, end))) {
      // 실패 원인을 가리는 조회다. 겹침 여부는 위의 변경 시도가 이미 결정했다.
      const current = await this.get(id);
      if (current.status === "cancelled") {
        throw new ValidationError("취소된 예약의 시간은 바꿀 수 없습니다.");
      }
      const conflict = await this.reservations.findConflict(reservation.roomId, start, end);
      const others = conflict && conflict.id !== id ? `: ${conflict.title}` : "";
      throw new ConflictError(`${room.name} 회의실은 해당 시간에 이미 예약되어 있습니다${others}`);
    }

    const rescheduled: Reservation = { ...reservation, start, end, remindedAt: undefined };
    const mail = rescheduledMail(rescheduled, room);
    await sendMail({ to: [rescheduled.organizer, ...rescheduled.attendees], ...mail });
    return rescheduled;
  }

  async get(id: string): Promise<Reservation> {
    const reservation = await this.reservations.findById(id);
    if (!reservation) {
      throw new NotFoundError(`예약을 찾을 수 없습니다: ${id}`);
    }
    return reservation;
  }

  /** 회의실의 하루 일정을 시작 시각 순으로 돌려준다. 취소된 예약은 보여 주지 않는다. */
  async scheduleOf(roomId: string, day: Date): Promise<Reservation[]> {
    await this.rooms.get(roomId);
    const dayStart = new Date(day);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const all = await this.reservations.findByRoom(roomId);
    return all
      .filter((reservation) => reservation.status === "confirmed")
      .filter((reservation) => overlaps(reservation, { start: dayStart, end: dayEnd }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }
}
