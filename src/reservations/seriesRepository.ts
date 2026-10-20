import type { ReservationSeries } from "./series.js";

export interface ReservationSeriesRepository {
  findById(id: string): Promise<ReservationSeries | undefined>;
  save(series: ReservationSeries): Promise<void>;
}

function clone(series: ReservationSeries): ReservationSeries {
  return {
    ...series,
    attendees: [...series.attendees],
    firstStart: new Date(series.firstStart),
    firstEnd: new Date(series.firstEnd),
    createdAt: new Date(series.createdAt),
    cancelledAt: series.cancelledAt && new Date(series.cancelledAt),
  };
}

/**
 * 메모리에 반복 예약 시리즈를 보관하는 저장소. 실제 데이터베이스처럼 모든 메서드가 비동기로 동작한다.
 */
export class InMemoryReservationSeriesRepository implements ReservationSeriesRepository {
  private readonly items = new Map<string, ReservationSeries>();

  async findById(id: string): Promise<ReservationSeries | undefined> {
    const found = this.items.get(id);
    return found ? clone(found) : undefined;
  }

  async save(series: ReservationSeries): Promise<void> {
    this.items.set(series.id, clone(series));
  }
}
