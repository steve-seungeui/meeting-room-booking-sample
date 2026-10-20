export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * 두 시간 구간이 겹치는지 판단한다. 한 구간이 끝나는 시각에 다른 구간이 시작하면 겹치지 않는다.
 */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}
