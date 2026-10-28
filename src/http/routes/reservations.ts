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

  router.patch("/:id", async (req, res) => {
    const requestedBy = requireString(req.header("x-user-email"), "X-User-Email 헤더");
    const body = req.body ?? {};
    // 본문에 attendees만 있으면 참석자를 그 목록으로 바꾸고, roomId만 있으면 같은 시간대의 다른 회의실로 옮기고,
    // start/end만 있으면 시간을 바꾼다. 한 번에 한 가지 항목만 바꿀 수 있다.
    if (body.attendees !== undefined) {
      if (body.roomId !== undefined || body.start !== undefined || body.end !== undefined) {
        throw new ValidationError("참석자는 회의실이나 시간과 한 번에 함께 바꿀 수 없습니다.");
      }
      if (!Array.isArray(body.attendees) || !body.attendees.every((email: unknown) => typeof email === "string")) {
        throw new ValidationError("attendees는 이메일 문자열의 배열이어야 합니다.");
      }
      const updated = await reservations.updateAttendees(req.params.id, requestedBy, body.attendees);
      res.json(toReservationResponse(updated));
      return;
    }
    if (body.roomId !== undefined) {
      if (body.start !== undefined || body.end !== undefined) {
        throw new ValidationError("회의실과 시간은 한 번에 함께 바꿀 수 없습니다.");
      }
      const moved = await reservations.changeRoom(req.params.id, requestedBy, requireString(body.roomId, "roomId"));
      res.json(toReservationResponse(moved));
      return;
    }
    const updated = await reservations.reschedule(
      req.params.id,
      requestedBy,
      new Date(requireString(body.start, "start")),
      new Date(requireString(body.end, "end")),
    );
    res.json(toReservationResponse(updated));
  });

  return router;
}
