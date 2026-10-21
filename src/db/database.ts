import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import sqlite3 from "sqlite3";

const SCHEMA = `
  PRAGMA journal_mode = WAL;
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
  /** 문장을 실행하고 영향받은 행 수를 돌려준다. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
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
  const ready = new Promise<void>((resolve, reject) => {
    db.exec(SCHEMA, (error) => (error ? reject(error) : resolve()));
  });

  return {
    async run(sql, params = []) {
      await ready;
      return new Promise<{ changes: number }>((resolve, reject) => {
        db.run(sql, params, function (error) {
          if (error) {
            reject(error);
          } else {
            resolve({ changes: this.changes });
          }
        });
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
