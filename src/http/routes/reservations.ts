import { Router } from "express";
import type { Reservation } from "../../reservations/reservation.js";
import type { ReservationService } from "../../reservations/reservationService.js";
import { seriesStatus } from "../../reservations/series.js";
import type { ReservationSeriesService, SeriesWithOccurrences } from "../../reservations/seriesService.js";
import { ValidationError } from "../../shared/errors.js";

export function toReservationResponse(reservation: Reservation) {
  return {
    id: reservation.id,
    roomId: reservation.roomId,
    title: reservation.title,
    organizer: reservation.organizer,
    attendees: reservation.attendees,
    start: reservation.start.toISOString(),
    end: reservation.end.toISOString(),
    status: reservation.status,
    ...(reservation.seriesId && { seriesId: reservation.seriesId }),
  };
}

export function toSeriesResponse({ series, occurrences }: SeriesWithOccurrences) {
  return {
    id: series.id,
    roomId: series.roomId,
    title: series.title,
    organizer: series.organizer,
    attendees: series.attendees,
    recurrence: { frequency: "weekly", count: series.count },
    status: seriesStatus(series),
    occurrences: occurrences.map(toReservationResponse),
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} 값이 필요합니다.`);
  }
  return value;
}

function parseNewReservation(body: Record<string, unknown>) {
  return {
    roomId: requireString(body.roomId, "roomId"),
    title: requireString(body.title, "title"),
    organizer: requireString(body.organizer, "organizer"),
    attendees: Array.isArray(body.attendees) ? body.attendees.map(String) : [],
    start: new Date(requireString(body.start, "start")),
    end: new Date(requireString(body.end, "end")),
  };
}

export function reservationRoutes(reservations: ReservationService, series: ReservationSeriesService): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const created = await reservations.create(parseNewReservation(req.body ?? {}));
    res.status(201).json(toReservationResponse(created));
  });

  // 반복 예약 경로는 /:id 경로보다 먼저 등록한다.
  router.post("/series", async (req, res) => {
    const body = req.body ?? {};
    const created = await series.create({ ...parseNewReservation(body), recurrence: body.recurrence });
    res.status(201).json(toSeriesResponse(created));
  });

  router.get("/series/:seriesId", async (req, res) => {
    res.json(toSeriesResponse(await series.get(req.params.seriesId)));
  });

  router.post("/series/:seriesId/cancel", async (req, res) => {
    const requestedBy = requireString(req.header("x-user-email"), "X-User-Email 헤더");
    res.json(toSeriesResponse(await series.cancel(req.params.seriesId, requestedBy)));
  });

  router.get("/:id", async (req, res) => {
    res.json(toReservationResponse(await reservations.get(req.params.id)));
  });

  // 요청한 사람은 X-User-Email 헤더로 받는다. 사내 게이트웨이가 로그인한 사용자의 이메일을 채워 준다.
  router.post("/:id/cancel", async (req, res) => {
    const requestedBy = requireString(req.header("x-user-email"), "X-User-Email 헤더");
    const cancelled = await reservations.cancel(req.params.id, requestedBy);
    res.json(toReservationResponse(cancelled));
  });

  return router;
}
