import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, prepareDatabaseFile } from "../src/db/database.js";

interface Row {
  id: string;
  title: string;
}

/** 스키마의 reservations 테이블에 넣을 최소한의 행 */
function insertReservation(id: string, title = "주간 회의") {
  return {
    sql: `INSERT INTO reservations (id, room_id, title, organizer, attendees, start_at, end_at, status, created_at)
          VALUES (?, 'room-302', ?, 'kim@example.com', '[]', '2026-11-02T01:00:00.000Z', '2026-11-02T02:00:00.000Z', 'confirmed', '2026-11-02T00:00:00.000Z')`,
    params: [id, title],
  };
}

describe("openDatabase (:memory:)", () => {
  it("run은 영향받은 행 수를 changes로 돌려준다", async () => {
    const db = openDatabase(":memory:");
    const a = insertReservation("r1");
    const b = insertReservation("r2");
    expect(await db.run(a.sql, a.params)).toEqual({ changes: 1 });
    expect(await db.run(b.sql, b.params)).toEqual({ changes: 1 });

    expect(await db.run("UPDATE reservations SET status = 'cancelled'")).toEqual({ changes: 2 });
    expect(await db.run("UPDATE reservations SET status = 'x' WHERE id = ?", ["없음"])).toEqual({ changes: 0 });
    expect(await db.run("DELETE FROM reservations WHERE id = ?", ["r1"])).toEqual({ changes: 1 });
  });

  it("get은 첫 행을, all은 모든 행을 돌려준다", async () => {
    const db = openDatabase(":memory:");
    for (const id of ["r1", "r2"]) {
      const insert = insertReservation(id, `회의 ${id}`);
      await db.run(insert.sql, insert.params);
    }

    expect(await db.get<Row>("SELECT id, title FROM reservations WHERE id = ?", ["r2"])).toEqual({
      id: "r2",
      title: "회의 r2",
    });
    expect(await db.all<Row>("SELECT id, title FROM reservations ORDER BY id")).toEqual([
      { id: "r1", title: "회의 r1" },
      { id: "r2", title: "회의 r2" },
    ]);
  });

  it("찾는 행이 없으면 get은 undefined를, all은 빈 배열을 돌려준다", async () => {
    const db = openDatabase(":memory:");

    expect(await db.get<Row>("SELECT id, title FROM reservations WHERE id = ?", ["없음"])).toBeUndefined();
    expect(await db.all<Row>("SELECT id, title FROM reservations")).toEqual([]);
  });

  it("SQL 오류가 나면 run/get/all의 promise가 reject된다", async () => {
    const db = openDatabase(":memory:");

    await expect(db.run("INSERT INTO no_such_table VALUES (1)")).rejects.toMatchObject({ code: "SQLITE_ERROR" });
    await expect(db.get("SELEC 1")).rejects.toMatchObject({ code: "SQLITE_ERROR" });
    await expect(db.all("SELECT * FROM no_such_table")).rejects.toMatchObject({ code: "SQLITE_ERROR" });
  });

  it("제약 조건을 어기면 run의 promise가 reject된다", async () => {
    const db = openDatabase(":memory:");
    const insert = insertReservation("r1");
    await db.run(insert.sql, insert.params);

    await expect(db.run(insert.sql, insert.params)).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT" });
  });

  it(":memory:로 열어도 테이블과 인덱스가 준비된다", async () => {
    const db = openDatabase(":memory:");

    const objects = await db.all<{ type: string; name: string }>(
      "SELECT type, name FROM sqlite_master WHERE tbl_name = 'reservations' AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    );
    expect(objects).toEqual([
      { type: "index", name: "reservations_room" },
      { type: "index", name: "reservations_room_end" },
      { type: "index", name: "reservations_start" },
      { type: "table", name: "reservations" },
    ]);
  });

  it(":memory:로 연 연결끼리는 데이터를 공유하지 않는다", async () => {
    const first = openDatabase(":memory:");
    const second = openDatabase(":memory:");
    const insert = insertReservation("r1");
    await first.run(insert.sql, insert.params);

    expect(await second.all("SELECT id FROM reservations")).toEqual([]);
  });
});

describe("openDatabase (파일)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "database-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("상위 디렉터리가 없으면 만들고 WAL 모드와 스키마를 준비한다", async () => {
    const databasePath = join(dir, "nested", "deeper", "reservations.db");
    const db = openDatabase(databasePath);

    expect(existsSync(join(dir, "nested", "deeper"))).toBe(true);
    expect(await db.get<{ journal_mode: string }>("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
    const indexes = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'reservations' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(indexes.map((i) => i.name)).toEqual(["reservations_room", "reservations_room_end", "reservations_start"]);
    expect(existsSync(databasePath)).toBe(true);
  });

  it("같은 파일을 다시 열면 저장한 데이터가 남아 있다", async () => {
    const databasePath = join(dir, "reservations.db");
    const writer = openDatabase(databasePath);
    const insert = insertReservation("r1", "남는 회의");
    await writer.run(insert.sql, insert.params);

    const reader = openDatabase(databasePath);
    expect(await reader.get<Row>("SELECT id, title FROM reservations")).toEqual({ id: "r1", title: "남는 회의" });
  });

  it("같은 새 파일에 여러 연결을 동시에 열어도 SQLITE_BUSY 없이 모두 준비된다", async () => {
    const databasePath = join(dir, "fresh", "reservations.db");
    const connections = Array.from({ length: 8 }, () => openDatabase(databasePath));

    const results = await Promise.allSettled(
      connections.map((db) => db.get<{ journal_mode: string }>("PRAGMA journal_mode")),
    );

    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    for (const result of results) {
      expect((result as PromiseFulfilledResult<{ journal_mode: string }>).value).toEqual({ journal_mode: "wal" });
    }

    // 준비가 끝난 연결들이 서로 쓴 내용을 볼 수 있어야 한다.
    await Promise.all(
      connections.map((db, i) => {
        const insert = insertReservation(`r${i}`);
        return db.run(insert.sql, insert.params);
      }),
    );
    expect(await connections[0].get<{ count: number }>("SELECT COUNT(*) AS count FROM reservations")).toEqual({
      count: 8,
    });
  });
});

describe("prepareDatabaseFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "database-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("상위 디렉터리와 파일을 만들고 WAL 모드와 스키마를 준비해 둔다", async () => {
    const databasePath = join(dir, "data", "reservations.db");

    await prepareDatabaseFile(databasePath);

    expect(existsSync(databasePath)).toBe(true);
    const db = openDatabase(databasePath);
    expect(await db.get<{ journal_mode: string }>("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
    expect(
      await db.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reservations'"),
    ).toEqual({ name: "reservations" });
  });

  it("이미 데이터가 있는 파일을 다시 준비해도 데이터가 유지된다", async () => {
    const databasePath = join(dir, "reservations.db");
    await prepareDatabaseFile(databasePath);
    const writer = openDatabase(databasePath);
    const insert = insertReservation("r1", "유지되는 회의");
    await writer.run(insert.sql, insert.params);

    await prepareDatabaseFile(databasePath);

    const reader = openDatabase(databasePath);
    expect(await reader.all<Row>("SELECT id, title FROM reservations")).toEqual([{ id: "r1", title: "유지되는 회의" }]);
  });

  it("준비한 파일에 여러 연결을 동시에 열어도 모두 쓰고 읽을 수 있다", async () => {
    const databasePath = join(dir, "reservations.db");
    await prepareDatabaseFile(databasePath);
    const connections = Array.from({ length: 4 }, () => openDatabase(databasePath));

    const results = await Promise.allSettled(
      connections.map((db, i) => {
        const insert = insertReservation(`r${i}`);
        return db.run(insert.sql, insert.params);
      }),
    );

    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(await connections[3].all<{ id: string }>("SELECT id FROM reservations ORDER BY id")).toEqual([
      { id: "r0" },
      { id: "r1" },
      { id: "r2" },
      { id: "r3" },
    ]);
  });
});
