import { ValidationError } from "../shared/errors.js";
import type { TimeRange } from "./overlap.js";
import type { NewReservation } from "./reservation.js";

export const MIN_SERIES_OCCURRENCES = 2;
export const MAX_SERIES_OCCURRENCES = 26;
// Asia/Seoul에는 일광 절약 시간제가 없으므로 7 × 24시간을 더하면 같은 요일·시각이 된다.
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type Recurrence =
  | { frequency: "weekly"; count: number; until?: undefined }
  | { frequency: "weekly"; until: string; count?: undefined };

export type SeriesStatus = "active" | "cancelled";

export interface ReservationSeries {
  id: string;
  roomId: string;
  title: string;
  organizer: string;
  attendees: string[];
  firstStart: Date;
  firstEnd: Date;
  count: number; // 실제로 만든 회차 수 (until로 요청해도 계산 결과를 저장)
  createdAt: Date;
  cancelledAt?: Date;
}

export interface NewReservationSeries extends NewReservation {
  recurrence: unknown;
}

export function seriesStatus(series: ReservationSeries): SeriesStatus {
  return series.cancelledAt ? "cancelled" : "active";
}

/**
 * 첫 회차에서 7일씩 더해 모든 회차의 시간 구간을 계산한다.
 * until은 Asia/Seoul 날짜이며 그날 시작하는 회차까지 포함한다.
 */
export function computeOccurrences(first: TimeRange, recurrence: Recurrence): TimeRange[] {
  const shift = (index: number): TimeRange => ({
    start: new Date(first.start.getTime() + index * WEEK_MS),
    end: new Date(first.end.getTime() + index * WEEK_MS),
  });

  const occurrences: TimeRange[] = [];
  if (recurrence.count !== undefined) {
    for (let index = 0; index < recurrence.count; index += 1) {
      occurrences.push(shift(index));
    }
  } else {
    const untilEnd = new Date(new Date(`${recurrence.until}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000);
    // 상한을 넘었는지만 알면 되므로 상한 + 1개까지만 만든다.
    while (occurrences.length <= MAX_SERIES_OCCURRENCES) {
      const next = shift(occurrences.length);
      if (next.start >= untilEnd) {
        break;
      }
      occurrences.push(next);
    }
  }

  if (occurrences.length < MIN_SERIES_OCCURRENCES || occurrences.length > MAX_SERIES_OCCURRENCES) {
    throw new ValidationError(
      `반복 예약은 ${MIN_SERIES_OCCURRENCES}회 이상 ${MAX_SERIES_OCCURRENCES}회 이하로만 만들 수 있습니다.`,
    );
  }
  return occurrences;
}
