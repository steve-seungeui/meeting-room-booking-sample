# 회의실 반복 예약 기능 명세

## 배경

매주 월요일 10시에 백두 회의실을 주간 회의로 잡는 것처럼, 같은 시간대를 정기적으로 쓰는 회의가 많다. 지금은 회차마다 예약을 따로 만들어야 하므로, 한 번의 요청으로 매주 반복되는 예약을 만들고 취소할 수 있게 한다.

## 범위

### 포함

- 매주 같은 요일, 같은 시각에 반복되는 예약(이하 "시리즈") 생성
- 시리즈 조회
- 회차 하나 취소, 시리즈 전체 취소
- 시리즈 생성·취소 알림 메일

### 제외

- 매일, 격주, 매월 반복과 한 주에 여러 요일 반복
- 종료 조건 없는 반복
- 회차 수정(시간, 제목, 참석자 변경). 단건 예약에도 아직 수정 기능이 없다.
- "이 회차부터 이후 모두" 취소
- 공휴일 자동 건너뛰기. 필요하면 해당 회차만 취소한다.
- `Asia/Seoul` 외 시간대
- 웹 화면(`public/`) 변경. 다음 작업에서 다룬다.
- 취소된 예약도 겹침으로 판정하는 기존 버그. `ch03/bugfix-cancelled` 브랜치에서 따로 고친다.

## 용어

| 용어 | 뜻 |
| --- | --- |
| 시리즈 | 하나의 반복 규칙으로 만든 예약 묶음 (`ReservationSeries`) |
| 회차 | 시리즈에 속한 개별 예약. 일반 `Reservation`과 같은 객체이며 `seriesId`를 가진다. |

## 반복 규칙

- 반복 주기는 매주 한 가지뿐이다.
- 요청에는 첫 회차의 `start`와 `end`를 받는다. 반복 요일과 시각은 첫 회차의 `Asia/Seoul` 기준 요일·시각에서 정한다. 요일 필드는 따로 받지 않는다.
- 이후 회차는 첫 회차의 `start`와 `end`에 7일씩 더해 만든다. `Asia/Seoul`에는 일광 절약 시간제가 없으므로 7 × 24시간을 더하면 된다.
- 종료 조건으로 `count`(회차 수)와 `until`(마지막 날짜) 중 **정확히 하나**를 받는다.
  - `count`는 2 이상 26 이하의 정수다.
  - `until`은 `YYYY-MM-DD` 형식의 `Asia/Seoul` 날짜다. 그날 시작하는 회차까지 포함한다.
  - `until`로 계산한 회차가 2개 미만이거나 26개를 넘으면 거부한다.
- 상한 26회는 약 6개월이다. `MAX_SERIES_OCCURRENCES = 26` 상수로 둔다.

## 저장 방식

만들 때 모든 회차를 일반 `Reservation`으로 펼쳐 저장하고 `seriesId`로 묶는다. 그래서 겹침 판정, 하루 일정 조회(`scheduleOf`), 리마인더(`reminderJob`), 단건 조회·취소가 회차에도 그대로 동작한다.

### 데이터 모델

```ts
// src/reservations/reservation.ts
export interface Reservation {
  // 기존 필드 그대로
  seriesId?: string; // 시리즈에 속한 회차만 가진다
}

// src/reservations/series.ts (신규)
export interface ReservationSeries {
  id: string;            // newId("srs")
  roomId: string;
  title: string;
  organizer: string;
  attendees: string[];
  firstStart: Date;      // 첫 회차 시작
  firstEnd: Date;        // 첫 회차 종료
  count: number;         // 실제로 만든 회차 수 (until로 요청해도 계산 결과를 저장)
  createdAt: Date;
  cancelledAt?: Date;    // 시리즈 전체 취소 시각
}
```

### 저장소

- `ReservationSeriesRepository` 인터페이스와 `InMemoryReservationSeriesRepository`를 새로 만든다. 메서드는 `findById`, `save`.
- `ReservationRepository`에 `findBySeries(seriesId)`를 추가한다. 시작 시각 순으로 돌려준다.
- 메모리 저장소이므로 서버를 다시 시작하면 사라진다. 기존 예약과 같다.

## 검증과 겹침 처리

1. 요청 형식과 종료 조건을 검증한다.
2. 모든 회차를 계산한다.
3. 회차마다 기존 `validateNewReservation`을 적용한다. 제목, 이메일, 시간 순서, 지난 시각, 최대 4시간, 수용 인원 규칙이 그대로 적용된다.
4. 회차마다 기존 단건 예약과 같은 규칙으로 겹침을 판정한다.
5. **하나라도 겹치면 시리즈 전체를 거부한다.** 아무 회차도 저장하지 않는다.
   - `409 CONFLICT`를 돌려준다.
   - 겹치는 회차의 날짜(`Asia/Seoul`)와 기존 예약 제목을 모두 메시지에 담는다. 첫 번째만 담지 않는다.
   - 예: `백두 회의실은 다음 날짜에 이미 예약되어 있습니다: 11월 3일(월) 팀 회의, 11월 17일(월) 채용 면접`
   - 응답 형식은 기존 오류 형식 `{ code, message }`를 그대로 쓴다.
6. 모두 통과하면 시리즈와 모든 회차를 저장한다.

한 시리즈 안의 회차끼리는 최대 4시간짜리이고 7일 간격이므로 서로 겹치지 않는다.

## API

기존 `/reservations` 라우터에 추가한다. `/series` 경로가 `/:id`보다 먼저 매칭되도록 등록 순서에 주의한다.

### `POST /reservations/series` — 시리즈 생성

요청:

```json
{
  "roomId": "room-302",
  "title": "주간 회의",
  "organizer": "lead@example.com",
  "attendees": ["a@example.com", "b@example.com"],
  "start": "2026-10-26T01:00:00.000Z",
  "end": "2026-10-26T02:00:00.000Z",
  "recurrence": { "frequency": "weekly", "count": 12 }
}
```

- `recurrence.frequency`는 `"weekly"`만 허용한다. 나중에 확장할 여지를 남기려고 필드를 둔다.
- `recurrence`에는 `count`와 `until` 중 정확히 하나만 넣는다. `until` 예: `"until": "2027-01-11"`.

응답 `201`:

```json
{
  "id": "srs_1a2b3c4d",
  "roomId": "room-302",
  "title": "주간 회의",
  "organizer": "lead@example.com",
  "attendees": ["a@example.com", "b@example.com"],
  "recurrence": { "frequency": "weekly", "count": 12 },
  "status": "active",
  "occurrences": [
    { "id": "rsv_...", "start": "...", "end": "...", "status": "confirmed", "seriesId": "srs_1a2b3c4d", "...": "기존 예약 응답 필드" }
  ]
}
```

- 시리즈의 `status`는 저장하지 않고 계산한다. `cancelledAt`이 있으면 `"cancelled"`, 없으면 `"active"`다.
- `recurrence`는 항상 실제로 만든 `count`로 돌려준다.

### `GET /reservations/series/:seriesId` — 시리즈 조회

위 응답과 같은 형식으로 돌려준다. `occurrences`에는 취소된 회차도 포함하고, 시작 시각 순으로 정렬한다. 시리즈가 없으면 `404 NOT_FOUND`.

### `POST /reservations/series/:seriesId/cancel` — 시리즈 전체 취소

- 요청한 사람은 기존과 같이 `X-User-Email` 헤더로 받는다.
- 주최자만 취소할 수 있다. 아니면 `400 VALIDATION_FAILED`. 기존 단건 취소와 같다.
- **아직 시작하지 않은**(`start > now`) `confirmed` 회차만 취소한다. 이미 시작했거나 끝난 회차는 기록으로 남긴다.
- 시리즈에 `cancelledAt`을 기록한다.
- 이미 취소된 시리즈면 아무것도 바꾸지 않고 현재 상태를 돌려준다. 메일도 보내지 않는다. 기존 단건 취소와 같다.
- 응답 `200`: 시리즈 조회와 같은 형식.

### 회차 하나 취소

새 엔드포인트를 만들지 않는다. 기존 `POST /reservations/:id/cancel`을 회차 ID로 호출한다. 동작과 메일은 단건 취소와 같다.

### 기존 응답 변경

`toReservationResponse`에 `seriesId`를 추가한다. 시리즈에 속하지 않으면 필드를 생략한다.

## 메일 알림

| 상황 | 메일 | 받는 사람 |
| --- | --- | --- |
| 시리즈 생성 | 시리즈 확정 메일 1통. 회의실, 반복 요일·시각, 첫 회차와 마지막 회차 날짜, 회차 수 | 주최자와 참석자 |
| 시리즈 전체 취소 | 시리즈 취소 메일 1통. 회의실, 반복 요일·시각, 취소된 회차 수 | 주최자와 참석자 |
| 회차 하나 취소 | 기존 단건 취소 메일 | 주최자와 참석자 |
| 회차 시작 전 | 기존 리마인더. 회차마다 보낸다. | 주최자와 참석자 |

- 시리즈 생성 때 회차별 확정 메일은 보내지 않는다.
- 새 템플릿 `seriesConfirmedMail`, `seriesCancelledMail`을 `src/notifications/templates.ts`에 추가한다. 시각 표기는 기존 `timeFormat`(`Asia/Seoul`)을 따른다.
- 시리즈 전체 취소 때 취소할 미래 회차가 하나도 없어도 시리즈는 취소 상태가 되고, 메일은 보내지 않는다.

## 코드 배치

| 위치 | 변경 |
| --- | --- |
| `src/reservations/reservation.ts` | `seriesId` 필드 추가 |
| `src/reservations/series.ts` | `ReservationSeries`, 반복 규칙 타입, 회차 계산 함수 |
| `src/reservations/seriesRepository.ts` | 시리즈 저장소 |
| `src/reservations/reservationRepository.ts` | `findBySeries` 추가, `clone`에서 `seriesId` 유지 |
| `src/reservations/seriesService.ts` | 시리즈 생성·조회·전체 취소 |
| `src/reservations/validation.ts` | 반복 규칙 검증 추가 |
| `src/notifications/templates.ts` | 시리즈 메일 템플릿 |
| `src/http/routes/reservations.ts` | 시리즈 엔드포인트, `seriesId` 응답 |
| `src/app.ts` | 시리즈 저장소·서비스 연결 |

## 테스트 기준

`tests/`에 Vitest로 작성한다. 시각은 `fixedClock`으로 고정한다.

회차 계산:
- `count: 3`이면 7일 간격으로 3개를 만든다.
- `until`은 그날 시작하는 회차를 포함한다.
- 요일은 UTC가 아니라 `Asia/Seoul` 기준이다. 예: 월요일 08:00 KST는 UTC로 일요일이다.

검증:
- `count`와 `until`을 둘 다 주거나 둘 다 빼면 거부한다.
- 회차가 2개 미만이거나 26개를 넘으면 거부한다.
- `frequency`가 `weekly`가 아니면 거부한다.
- 첫 회차가 지난 시각이면 거부한다.
- 기존 단건 검증(4시간 초과, 수용 인원 초과 등)이 시리즈에도 적용된다.

겹침:
- 한 회차라도 겹치면 409를 돌려주고, 어떤 예약도 저장하지 않는다.
- 메시지에 겹치는 날짜가 모두 들어간다.

취소:
- 회차 하나를 취소하면 그 회차만 취소되고 시리즈는 `active`로 남는다.
- 시리즈 전체 취소는 미래 회차만 취소하고, 지난 회차는 `confirmed`로 남는다.
- 주최자가 아니면 취소할 수 없다.
- 두 번 취소해도 같은 결과이고, 메일은 한 번만 보낸다.

연동:
- 시리즈 회차가 하루 일정 조회(`GET /rooms/:roomId/schedule`)에 나온다.
- 리마인더 작업이 회차마다 알림을 보낸다.
- 시리즈 생성 때 메일은 1통만 보낸다.
