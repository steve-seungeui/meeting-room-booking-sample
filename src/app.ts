import { fileURLToPath } from "node:url";
import express from "express";
import { errorHandler } from "./http/errorHandler.js";
import { reservationRoutes } from "./http/routes/reservations.js";
import { roomRoutes } from "./http/routes/rooms.js";
import { InMemoryReservationRepository, type ReservationRepository } from "./reservations/reservationRepository.js";
import { ReservationService } from "./reservations/reservationService.js";
import { InMemoryReservationSeriesRepository, type ReservationSeriesRepository } from "./reservations/seriesRepository.js";
import { ReservationSeriesService } from "./reservations/seriesService.js";
import { InMemoryRoomRepository, type RoomRepository } from "./rooms/roomRepository.js";
import { RoomService } from "./rooms/roomService.js";
import { systemClock, type Clock } from "./shared/clock.js";

export interface AppDependencies {
  roomRepository?: RoomRepository;
  reservationRepository?: ReservationRepository;
  seriesRepository?: ReservationSeriesRepository;
  clock?: Clock;
}

export function createServices(deps: AppDependencies = {}) {
  const roomRepository = deps.roomRepository ?? new InMemoryRoomRepository();
  const reservationRepository = deps.reservationRepository ?? new InMemoryReservationRepository();
  const seriesRepository = deps.seriesRepository ?? new InMemoryReservationSeriesRepository();
  const clock = deps.clock ?? systemClock;
  const roomService = new RoomService(roomRepository);
  const reservationService = new ReservationService(reservationRepository, roomService, clock);
  const seriesService = new ReservationSeriesService(
    seriesRepository,
    reservationRepository,
    reservationService,
    roomService,
    clock,
  );
  return { roomService, reservationService, seriesService, reservationRepository, seriesRepository, clock };
}

export function createApp(deps: AppDependencies = {}) {
  const services = createServices(deps);
  const app = express();
  app.use(express.json());
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/rooms", roomRoutes(services.roomService, services.reservationService));
  app.use("/reservations", reservationRoutes(services.reservationService, services.seriesService));
  app.use(errorHandler);
  return { app, services };
}
