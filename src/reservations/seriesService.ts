import { sendMail } from "../notifications/legacyMailer.js";
import { formatSeoulDate, seriesCancelledMail, seriesConfirmedMail } from "../notifications/templates.js";
import type { RoomService } from "../rooms/roomService.js";
import type { Clock } from "../shared/clock.js";
import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { newId } from "../shared/ids.js";
import type { Reservation } from "./reservation.js";
import type { ReservationRepository } from "./reservationRepository.js";
import type { ReservationService } from "./reservationService.js";
import { computeOccurrences, type NewReservationSeries, type ReservationSeries } from "./series.js";
import type { ReservationSeriesRepository } from "./seriesRepository.js";
import { validateNewReservation, validateRecurrence } from "./validation.js";

export interface SeriesWithOccurrences {
  series: ReservationSeries;
  occurrences: Reservation[];
}

export class ReservationSeriesService {
  constructor(
    private readonly seriesRepository: ReservationSeriesRepository,
    private readonly reservations: ReservationRepository,
    private readonly reservationService: ReservationService,
    private readonly rooms: RoomService,
    private readonly clock: Clock,
  ) {}

  /** 모든 회차를 검증하고, 하나라도 겹치면 아무것도 저장하지 않고 거부한다. */
  async create(input: NewReservationSeries): Promise<SeriesWithOccurrences> {
    const room = await this.rooms.get(input.roomId);
    const now = this.clock.now();
    const recurrence = validateRecurrence(input.recurrence);
    validateNewReservation(input, room, now);

    const ranges = computeOccurrences(input, recurrence);
    for (const range of ranges) {
      validateNewReservation({ ...input, ...range }, room, now);
    }

    const conflicts = await this.reservationService.findConflicts(input.roomId, ranges);
    if (conflicts.length > 0) {
      const dates = conflicts.map(({ range, existing }) => `${formatSeoulDate(range.start)} ${existing.title}`);
      throw new ConflictError(`${room.name} 회의실은 다음 날짜에 이미 예약되어 있습니다: ${dates.join(", ")}`);
    }

    const series: ReservationSeries = {
      id: newId("srs"),
      roomId: input.roomId,
      title: input.title.trim(),
      organizer: input.organizer,
      attendees: [...new Set(input.attendees)],
      firstStart: input.start,
      firstEnd: input.end,
      count: ranges.length,
      createdAt: now,
    };
    const occurrences: Reservation[] = ranges.map((range) => ({
      id: newId("rsv"),
      roomId: series.roomId,
      title: series.title,
      organizer: series.organizer,
      attendees: [...series.attendees],
      start: range.start,
      end: range.end,
      status: "confirmed",
      createdAt: now,
      seriesId: series.id,
    }));
    await this.seriesRepository.save(series);
    for (const occurrence of occurrences) {
      await this.reservations.save(occurrence);
    }

    // 회차별 확정 메일 대신 시리즈 확정 메일 한 통만 보낸다.
    const mail = seriesConfirmedMail(series, room);
    await sendMail({ to: [series.organizer, ...series.attendees], ...mail });
    return { series, occurrences };
  }

  /** 아직 시작하지 않은 회차만 취소한다. 이미 시작했거나 끝난 회차는 기록으로 남긴다. */
  async cancel(seriesId: string, requestedBy: string): Promise<SeriesWithOccurrences> {
    const current = await this.get(seriesId);
    const { series, occurrences } = current;
    if (series.cancelledAt) {
      return current;
    }
    if (series.organizer !== requestedBy) {
      throw new ValidationError("예약을 만든 사람만 취소할 수 있습니다.");
    }

    const now = this.clock.now();
    let cancelledCount = 0;
    const updated: Reservation[] = [];
    for (const occurrence of occurrences) {
      if (occurrence.status === "confirmed" && occurrence.start > now) {
        const cancelled: Reservation = { ...occurrence, status: "cancelled", cancelledAt: now };
        await this.reservations.save(cancelled);
        updated.push(cancelled);
        cancelledCount += 1;
      } else {
        updated.push(occurrence);
      }
    }
    const cancelledSeries: ReservationSeries = { ...series, cancelledAt: now };
    await this.seriesRepository.save(cancelledSeries);

    if (cancelledCount > 0) {
      const room = await this.rooms.get(series.roomId);
      const mail = seriesCancelledMail(cancelledSeries, room, cancelledCount);
      await sendMail({ to: [series.organizer, ...series.attendees], ...mail });
    }
    return { series: cancelledSeries, occurrences: updated };
  }

  /** 시리즈와 취소된 회차를 포함한 모든 회차를 시작 시각 순으로 돌려준다. */
  async get(seriesId: string): Promise<SeriesWithOccurrences> {
    const series = await this.seriesRepository.findById(seriesId);
    if (!series) {
      throw new NotFoundError(`반복 예약을 찾을 수 없습니다: ${seriesId}`);
    }
    return { series, occurrences: await this.reservations.findBySeries(seriesId) };
  }
}
