# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

사내 회의실 예약 API 예제(Express 5 + SQLite, TypeScript ESM, Node >= 22). 책 「개발 조직을 위한 Claude Code 도입·운영 가이드」의 실습용 저장소이며, 장별 브랜치로 작업 결과를 남긴다. `main`은 책의 작업 시작 시점 상태라 의도적으로 버그가 들어 있을 수 있다.

## 명령어

```bash
npm install
npm start                        # tsx src/server.ts, http://localhost:3000
npm run dev                      # tsx watch
npm test                         # vitest run (전체)
npx vitest run tests/overlap.test.ts          # 파일 하나
npx vitest run -t "테스트 이름 일부"            # 이름으로 필터
npm run typecheck                # tsc --noEmit
```

린터는 없다. 환경 변수: `PORT`(3000), `DB_PATH`(`data/booking.db`), `WORKERS`(2), `MAIL_RELAY_HOST`, `MAIL_SENDER`.

## 아키텍처

- **프로세스 구조** (`src/server.ts`): `node:cluster`로 주 프로세스가 워커 `WORKERS`개를 띄우고, 워커마다 `createApp()`으로 Express 앱을 만든다. 모든 프로세스가 SQLite 파일 하나를 공유한다(WAL, busyTimeout 5초). 리마인더 작업(`src/jobs/reminderJob.ts`)은 주 프로세스에서만 1분마다 돈다.
- **의존성 조립** (`src/app.ts`): `createServices()`가 저장소·서비스·`Clock`을 조립한다. 테스트는 `databasePath`를 생략하면 `:memory:` DB를 쓰고, `Clock`을 `fixedClock()`으로 주입한다. 시간에 의존하는 코드는 `new Date()` 대신 반드시 `Clock`을 거친다.
- **계층**: `http/routes` → `*Service` → `*Repository`. 회의실은 `InMemoryRoomRepository`(고정 데이터), 예약은 `SqliteReservationRepository`. `src/db/database.ts`는 sqlite3 콜백 API를 Promise로 감싼 얇은 `Database` 인터페이스다.
- **동시 예약 방지**: 겹침 검사와 저장은 `saveIfAvailable()`의 `INSERT ... WHERE NOT EXISTS` 한 문장으로 원자적으로 수행한다. 서비스 계층에서 "조회 후 저장"으로 바꾸면 다중 워커에서 중복 예약이 생긴다(`tests/doubleBooking.test.ts`가 이를 검증). 겹침 조건은 반열린 구간이며 `src/reservations/overlap.ts`와 SQL이 같은 의미를 유지해야 한다.
- **시각 저장 형식**: 시각은 항상 `toISOString()`(고정 길이 UTC) 문자열로 저장하고 SQL에서 문자열 비교로 시간 비교를 한다. 다른 형식으로 저장하면 비교가 깨진다.
- **알림**: `ReservationService`와 리마인더 작업이 `notifications/legacyMailer.ts`의 `sendMail`을 직접 호출한다(주입 아님). 릴레이 호스트가 없으면 콘솔 출력 + 메모리 로그에 쌓이며, 테스트에서는 `clearSentMails()`로 초기화한다.
- **오류**: `src/shared/errors.ts`의 `ConflictError`/`NotFoundError`/`ValidationError`를 던지면 `http/errorHandler.ts`가 HTTP 상태로 변환한다.
- `public/`은 Express가 정적으로 서빙하는 바닐라 JS 웹 화면이다.
