import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import sqlite3 from "sqlite3";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS reservations (
    id           TEXT PRIMARY KEY,
    room_id      TEXT NOT NULL,
    title        TEXT NOT NULL,
    organizer    TEXT NOT NULL,
    attendees    TEXT NOT NULL,
    start_at     TEXT NOT NULL,
    end_at       TEXT NOT NULL,
    status       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    cancelled_at TEXT,
    reminded_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS reservations_room ON reservations (room_id);
  CREATE INDEX IF NOT EXISTS reservations_start ON reservations (start_at);
`;

/** SQLite 연결을 감싼 비동기 인터페이스 */
export interface Database {
  run(sql: string, params?: unknown[]): Promise<void>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * SQLite 데이터베이스를 열고 테이블을 준비한다.
 * 운영에서는 파일 경로를, 테스트에서는 ":memory:"를 넘긴다.
 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new sqlite3.Database(path);
  // 여러 프로세스가 같은 파일을 쓰므로 다른 프로세스의 잠금이 풀리기를 5초까지 기다린다.
  db.configure("busyTimeout", 5000);
  const ready = prepare(db, path);

  return {
    async run(sql, params = []) {
      await ready;
      await new Promise<void>((resolve, reject) => {
        db.run(sql, params, (error) => (error ? reject(error) : resolve()));
      });
    },
    async get<T>(sql: string, params: unknown[] = []) {
      await ready;
      return new Promise<T | undefined>((resolve, reject) => {
        db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row as T | undefined)));
      });
    },
    async all<T>(sql: string, params: unknown[] = []) {
      await ready;
      return new Promise<T[]>((resolve, reject) => {
        db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows as T[])));
      });
    },
  };
}

/**
 * 서버를 시작할 때 주 프로세스가 워커를 띄우기 전에 DB 파일을 한 번 준비한다.
 * 이렇게 해 두면 워커들이 동시에 연결을 열어도 저널 모드 전환과 테이블 생성이 겹치지 않는다.
 */
export async function prepareDatabaseFile(path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const db = new sqlite3.Database(path);
  db.configure("busyTimeout", 5000);
  try {
    await prepare(db, path);
  } finally {
    await new Promise<void>((resolve) => db.close(() => resolve()));
  }
}

/** WAL 모드로 바꾸고 테이블을 준비한다. */
async function prepare(db: sqlite3.Database, path: string): Promise<void> {
  if (path !== ":memory:") {
    // 새 파일을 여러 연결이 동시에 열면 저널 모드 전환은 잠금을 기다리지 않고 SQLITE_BUSY로 바로 실패할 수 있다.
    await retryOnBusy(() => exec(db, "PRAGMA journal_mode = WAL;"));
  }
  await retryOnBusy(() => exec(db, SCHEMA));
}

function exec(db: sqlite3.Database, sql: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    db.exec(sql, (error) => (error ? reject(error) : resolve()));
  });
}

async function retryOnBusy(task: () => Promise<void>, attempts = 50): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await task();
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== "SQLITE_BUSY" || attempt >= attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}
