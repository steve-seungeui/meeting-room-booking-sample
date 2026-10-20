import { Router } from "express";
import type { Reservation } from "../../reservations/reservation.js";
import type { ReservationService } from "../../reservations/reservationService.js";
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
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} 값이 필요합니다.`);
  }
  return value;
}

export function reservationRoutes(reservations: ReservationService): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const body = req.body ?? {};
    const attendees = Array.isArray(body.attendees) ? body.attendees.map(String) : [];
    const created = await reservations.create({
      roomId: requireString(body.roomId, "roomId"),
      title: requireString(body.title, "title"),
      organizer: requireString(body.organizer, "organizer"),
      attendees,
      start: new Date(requireString(body.start, "start")),
      end: new Date(requireString(body.end, "end")),
    });
    res.status(201).json(toReservationResponse(created));
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
