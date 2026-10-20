import type { Reservation } from "./reservation.js";

export interface ReservationRepository {
  findById(id: string): Promise<Reservation | undefined>;
  findByRoom(roomId: string): Promise<Reservation[]>;
  findStartingBetween(from: Date, to: Date): Promise<Reservation[]>;
  save(reservation: Reservation): Promise<void>;
}

function clone(reservation: Reservation): Reservation {
  return {
    ...reservation,
    attendees: [...reservation.attendees],
    start: new Date(reservation.start),
    end: new Date(reservation.end),
    createdAt: new Date(reservation.createdAt),
    cancelledAt: reservation.cancelledAt && new Date(reservation.cancelledAt),
    remindedAt: reservation.remindedAt && new Date(reservation.remindedAt),
  };
}

/**
 * 메모리에 예약을 보관하는 저장소. 실제 데이터베이스처럼 모든 메서드가 비동기로 동작한다.
 */
export class InMemoryReservationRepository implements ReservationRepository {
  private readonly items = new Map<string, Reservation>();

  async findById(id: string): Promise<Reservation | undefined> {
    const found = this.items.get(id);
    return found ? clone(found) : undefined;
  }

  async findByRoom(roomId: string): Promise<Reservation[]> {
    return [...this.items.values()]
      .filter((reservation) => reservation.roomId === roomId)
      .map(clone);
  }

  async findStartingBetween(from: Date, to: Date): Promise<Reservation[]> {
    return [...this.items.values()]
      .filter((reservation) => reservation.start >= from && reservation.start < to)
      .map(clone);
  }

  async save(reservation: Reservation): Promise<void> {
    this.items.set(reservation.id, clone(reservation));
  }
}
