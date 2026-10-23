# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 원칙

- 예약 겹침 검사와 저장은 하나의 SQL 문으로 처리한다. 겹침을 먼저 조회한 뒤 따로 저장하면 동시 요청에서 같은 회의실, 같은 시간대의 예약이 둘 생긴다.

## 명령어

Node.js 22 이상이 필요하다.

```bash
npm install
npm run dev          # tsx watch로 src/server.ts 실행
npm start            # http://localhost:3000
npm test             # vitest run (전체)
npm run typecheck    # tsc --noEmit
npx vitest run tests/overlap.test.ts            # 테스트 파일 하나
npx vitest run tests/overlap.test.ts -t "이름"   # 테스트 이름으로 하나
```

린터는 없다. 환경 변수: `PORT`(3000), `DB_PATH`(`data/booking.db`), `WORKERS`(2).

## 아키텍처

Express 5 + SQLite(`sqlite3`) API 서버이며, `public/`의 정적 웹 화면도 함께 서빙한다. 계층은 라우트(`src/http`) → 서비스 → 저장소(인터페이스 + 구현)이다.

- **조립**: `src/app.ts`의 `createServices`/`createApp`이 의존성을 엮는다. `databasePath`를 생략하면 `:memory:` DB를 쓰므로 테스트는 이 방식으로 서비스를 만든다. 시간은 `Clock`(`src/shared/clock.ts`)으로 주입하고, 테스트에서는 `fixedClock`을 쓴다.
- **다중 프로세스**: `src/server.ts`는 `cluster`로 주 프로세스 1개와 워커 N개를 띄우고, 모든 프로세스가 SQLite 파일 하나를 공유한다. 주 프로세스가 워커를 띄우기 전에 `prepareDatabaseFile`로 WAL 전환과 스키마 생성을 한 번 끝낸다(동시 연결이 `SQLITE_BUSY`로 실패하는 것을 막기 위함). 연결에는 `busyTimeout` 5초가 걸려 있다. 리마인더 작업(`src/jobs/reminderJob.ts`)은 주 프로세스에서만 1분마다 돈다.
- **예약 생성 흐름** (`ReservationService.create`): 검증 → `saveIfAvailable`(겹침 검사와 INSERT를 `INSERT ... SELECT ... WHERE NOT EXISTS` 한 문장으로 실행) → 실패하면 `findConflict`로 오류 메시지에 쓸 충돌 예약만 조회해 `ConflictError`를 던진다. `findConflict`는 메시지용일 뿐 겹침 판정의 근거가 아니다.
- **예약 시간 변경** (`PATCH /reservations/:id`, `ReservationService.reschedule`): `X-User-Email`이 주최자와 같을 때만 허용한다. `rescheduleIfAvailable`가 겹침 검사(자기 자신 제외)와 UPDATE를 한 문장으로 실행하며, 시간이 바뀌면 `reminded_at`을 비운다.
- **겹침 규칙**: 반열린 구간이다(끝 시각과 다른 예약의 시작 시각이 같으면 겹치지 않음). 취소된 예약(`status = 'cancelled'`)은 시간대를 점유하지 않는다. SQL 조건과 `src/reservations/overlap.ts`의 `overlaps`가 같은 규칙을 따라야 한다.
- **시각 저장**: 항상 `toISOString()`(고정 길이 UTC) 문자열로 저장하므로 SQL의 문자열 비교가 시간 비교와 같다. 이 형식을 바꾸면 겹침 쿼리가 깨진다.
- **인덱스**: `reservations_room_end (room_id, end_at, start_at)`는 겹침 검사가 해당 시간대 근처만 읽도록 하는 것이다. 겹침 쿼리의 조건을 바꿀 때 이 인덱스와 맞는지 확인한다.
- **회의실**: `RoomRepository`는 현재 `InMemoryRoomRepository`뿐이며 DB에 저장하지 않는다.
- **알림**: `src/notifications/`의 `legacyMailer`와 `templates`가 메일을 만들고 보낸다. 테스트는 `clearSentMails`로 발송 기록을 초기화한다.

## 테스트

`tests/doubleBooking.test.ts`는 임시 디렉터리의 DB 파일을 여러 서비스/프로세스가 함께 쓰는 동시 예약 시나리오를 검증한다. 예약 저장 로직을 바꾸면 이 테스트를 반드시 돌린다.
