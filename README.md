# 회의실 예약 서비스

사내 회의실을 조회하고 예약하는 API 서버와 웹 화면입니다. 예약은 SQLite 데이터베이스에 저장합니다.

## 실행 방법

Node.js 22 이상이 필요합니다.

```bash
npm install
npm start        # http://localhost:3000
npm test         # 테스트 실행
npm run typecheck
```

## 구성

| 경로 | 내용 |
| --- | --- |
| `src/db/` | SQLite 연결과 테이블 정의 |
| `src/rooms/` | 회의실 목록과 조회 |
| `src/reservations/` | 예약 생성, 시간 변경, 취소, 겹침 판정, 하루 일정 조회 |
| `src/notifications/` | 예약 확정, 취소, 리마인더 메일 |
| `src/jobs/` | 회의 시작 전 리마인더 작업 |
| `src/http/` | HTTP 라우트와 오류 처리 |
| `public/` | 웹 화면 |
| `tests/` | Vitest 테스트 |

서버는 워커 프로세스 여러 개(기본 2개)로 요청을 나누어 처리하고, 모든 프로세스가 SQLite 파일 하나(기본 `data/booking.db`)를 함께 씁니다. 리마인더 작업은 주 프로세스에서 1분마다 실행합니다. 환경 변수로 설정을 바꿀 수 있습니다.

| 환경 변수 | 기본값 | 내용 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 포트 |
| `DB_PATH` | `data/booking.db` | SQLite 파일 경로 |
| `WORKERS` | `2` | 워커 프로세스 수 |
| `MAIL_RELAY_HOST` | (없음) | 메일 릴레이 호스트. 없으면 메일 내용을 콘솔에 출력 |
| `MAIL_SENDER` | `meeting-rooms@example.com` | 발신자 주소 |
| `MAIL_RELAY_TOKEN` | (없음) | 메일 릴레이 인증 토큰. `Authorization: Bearer <토큰>` 헤더로 보냄 |

`npm start`와 `npm run dev`는 프로젝트 루트의 `.env` 파일이 있으면 읽습니다(없으면 건너뜀). `.env`는 커밋하지 않습니다.

테스트는 파일 대신 SQLite 메모리 데이터베이스를 씁니다.

## API

예약을 바꾸거나 취소할 때는 요청한 사람을 `X-User-Email` 헤더로 보냅니다.

| 메서드와 경로 | 기능 |
| --- | --- |
| `GET /rooms` | 회의실 목록(`floor`, `minCapacity`, `equipment`로 거르기) |
| `GET /rooms/:roomId` | 회의실 조회 |
| `GET /rooms/:roomId/schedule?date=YYYY-MM-DD` | 회의실의 하루 일정 |
| `POST /reservations` | 예약 생성 |
| `GET /reservations/:id` | 예약 조회 |
| `PATCH /reservations/:id` | 예약의 시간(`start`, `end`), 회의실(`roomId`), 참석자(`attendees`) 변경 |
| `POST /reservations/:id/cancel` | 예약 취소 |

## 라이선스

MIT
