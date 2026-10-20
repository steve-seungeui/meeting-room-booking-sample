import { overlaps } from "./overlap.js";
import type { Reservation } from "./reservation.js";

export interface ReservationRepository {
  findById(id: string): Promise<Reservation | undefined>;
  findByRoom(roomId: string): Promise<Reservation[]>;
  findStartingBetween(from: Date, to: Date): Promise<Reservation[]>;
  save(reservation: Reservation): Promise<void>;
  /**
   * 같은 회의실에 시간이 겹치는 확정 예약이 없을 때만 저장한다. 취소된 예약은 충돌로 보지 않는다.
   * 검사와 저장은 하나의 원자적 연산이어야 한다.
   * 저장했으면 undefined를, 겹치는 예약이 있으면 저장하지 않고 그 예약을 돌려준다.
   * 데이터베이스 저장소는 제약조건이나 트랜잭션으로 같은 보장을 제공해야 한다.
   */
  createIfAvailable(reservation: Reservation): Promise<Reservation | undefined>;
  /**
   * 알림을 보낸 시각만 기록한다. 예약 전체를 덮어쓰지 않으므로 그 사이에 바뀐 상태(취소 등)를 유지한다.
   * 예약이 없으면 아무 일도 하지 않는다.
   */
  markReminded(id: string, remindedAt: Date): Promise<void>;
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

  async createIfAvailable(reservation: Reservation): Promise<Reservation | undefined> {
    // await 없이 검사와 저장을 끝내므로 다른 요청이 중간에 끼어들 수 없다.
    for (const existing of this.items.values()) {
      if (
        existing.roomId === reservation.roomId &&
        existing.status === "confirmed" &&
        overlaps(existing, reservation)
      ) {
        return clone(existing);
      }
    }
    this.items.set(reservation.id, clone(reservation));
    return undefined;
  }

  async markReminded(id: string, remindedAt: Date): Promise<void> {
    const found = this.items.get(id);
    if (found) {
      this.items.set(id, { ...found, remindedAt: new Date(remindedAt) });
    }
  }
}
