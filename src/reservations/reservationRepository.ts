import type { Database } from "../db/database.js";
import type { Reservation, ReservationStatus } from "./reservation.js";

export interface ReservationRepository {
  findById(id: string): Promise<Reservation | undefined>;
  findByRoom(roomId: string): Promise<Reservation[]>;
  findStartingBetween(from: Date, to: Date): Promise<Reservation[]>;
  save(reservation: Reservation): Promise<void>;
}

interface ReservationRow {
  id: string;
  room_id: string;
  title: string;
  organizer: string;
  attendees: string;
  start_at: string;
  end_at: string;
  status: string;
  created_at: string;
  cancelled_at: string | null;
  reminded_at: string | null;
}

function toReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    roomId: row.room_id,
    title: row.title,
    organizer: row.organizer,
    attendees: JSON.parse(row.attendees) as string[],
    start: new Date(row.start_at),
    end: new Date(row.end_at),
    status: row.status as ReservationStatus,
    createdAt: new Date(row.created_at),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : undefined,
    remindedAt: row.reminded_at ? new Date(row.reminded_at) : undefined,
  };
}

/**
 * SQLite에 예약을 저장하는 저장소.
 */
export class SqliteReservationRepository implements ReservationRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<Reservation | undefined> {
    const row = await this.db.get<ReservationRow>("SELECT * FROM reservations WHERE id = ?", [id]);
    return row ? toReservation(row) : undefined;
  }

  async findByRoom(roomId: string): Promise<Reservation[]> {
    const rows = await this.db.all<ReservationRow>(
      "SELECT * FROM reservations WHERE room_id = ? ORDER BY start_at",
      [roomId],
    );
    return rows.map(toReservation);
  }

  async findStartingBetween(from: Date, to: Date): Promise<Reservation[]> {
    const rows = await this.db.all<ReservationRow>(
      "SELECT * FROM reservations WHERE start_at >= ? AND start_at < ? ORDER BY start_at",
      [from.toISOString(), to.toISOString()],
    );
    return rows.map(toReservation);
  }

  async save(reservation: Reservation): Promise<void> {
    await this.db.run(
      `INSERT INTO reservations
           (id, room_id, title, organizer, attendees, start_at, end_at, status, created_at, cancelled_at, reminded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           room_id = excluded.room_id, title = excluded.title, organizer = excluded.organizer,
           attendees = excluded.attendees, start_at = excluded.start_at, end_at = excluded.end_at,
           status = excluded.status, created_at = excluded.created_at,
           cancelled_at = excluded.cancelled_at, reminded_at = excluded.reminded_at`,
      [
        reservation.id,
        reservation.roomId,
        reservation.title,
        reservation.organizer,
        JSON.stringify(reservation.attendees),
        reservation.start.toISOString(),
        reservation.end.toISOString(),
        reservation.status,
        reservation.createdAt.toISOString(),
        reservation.cancelledAt?.toISOString() ?? null,
        reservation.remindedAt?.toISOString() ?? null,
      ],
    );
  }
}
