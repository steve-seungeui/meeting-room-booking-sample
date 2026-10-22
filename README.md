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
| `src/reservations/` | 예약 생성, 취소, 겹침 판정, 하루 일정 조회 |
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

테스트는 파일 대신 SQLite 메모리 데이터베이스를 씁니다.

## 라이선스

MIT
