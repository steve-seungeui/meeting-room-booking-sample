import { Router } from "express";
import type { Equipment } from "../../rooms/room.js";
import type { RoomService } from "../../rooms/roomService.js";
import type { ReservationService } from "../../reservations/reservationService.js";
import { ValidationError } from "../../shared/errors.js";
import { toReservationResponse } from "./reservations.js";

const EQUIPMENT: Equipment[] = ["display", "video_conference", "whiteboard"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function roomRoutes(rooms: RoomService, reservations: ReservationService): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const minCapacity = req.query.minCapacity ? Number(req.query.minCapacity) : undefined;
    if (minCapacity !== undefined && !Number.isInteger(minCapacity)) {
      throw new ValidationError("minCapacity는 정수여야 합니다.");
    }
    const equipment = String(req.query.equipment ?? "")
      .split(",")
      .filter(Boolean) as Equipment[];
    const unknown = equipment.find((item) => !EQUIPMENT.includes(item));
    if (unknown) {
      throw new ValidationError(`알 수 없는 설비입니다: ${unknown}`);
    }
    res.json(await rooms.list({ minCapacity, equipment }));
  });

  router.get("/:roomId", async (req, res) => {
    res.json(await rooms.get(req.params.roomId));
  });

  // 날짜는 한국 시간 기준 YYYY-MM-DD로 받는다.
  router.get("/:roomId/schedule", async (req, res) => {
    const date = String(req.query.date ?? "");
    if (!DATE_PATTERN.test(date)) {
      throw new ValidationError("date는 YYYY-MM-DD 형식이어야 합니다.");
    }
    const day = new Date(`${date}T00:00:00+09:00`);
    const schedule = await reservations.scheduleOf(req.params.roomId, day);
    res.json(schedule.map(toReservationResponse));
  });

  return router;
}
