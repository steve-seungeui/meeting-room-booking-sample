import type { Database } from "../db/database.js";
import type { Reservation, ReservationStatus } from "./reservation.js";

export interface ReservationRepository {
  findById(id: string): Promise<Reservation | undefined>;
  findByRoom(roomId: string): Promise<Reservation[]>;
  findStartingBetween(from: Date, to: Date): Promise<Reservation[]>;
  save(reservation: Reservation): Promise<void>;
  /**
   * 같은 회의실에 시간이 겹치는 예약이 없을 때만 저장한다.
   * 검사와 저장이 한 문장으로 실행되므로 동시 요청 사이에서도 겹치는 예약이 둘 생기지 않는다.
   * 저장했으면 true, 겹치는 예약이 있어 저장하지 않았으면 false를 돌려준다.
   */
  saveIfAvailable(reservation: Reservation): Promise<boolean>;
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

function toParams(reservation: Reservation): unknown[] {
  return [
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
  ];
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
      toParams(reservation),
    );
  }

  async saveIfAvailable(reservation: Reservation): Promise<boolean> {
    // 시각은 항상 toISOString()(고정 길이 UTC)으로 저장하므로 문자열 비교가 시간 비교와 같다.
    // 겹침 조건은 overlap.ts와 같은 반열린 구간이다.
    const { changes } = await this.db.run(
      `INSERT INTO reservations
           (id, room_id, title, organizer, attendees, start_at, end_at, status, created_at, cancelled_at, reminded_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM reservations WHERE room_id = ? AND start_at < ? AND end_at > ?
         )`,
      [
        ...toParams(reservation),
        reservation.roomId,
        reservation.end.toISOString(),
        reservation.start.toISOString(),
      ],
    );
    return changes > 0;
  }
}
