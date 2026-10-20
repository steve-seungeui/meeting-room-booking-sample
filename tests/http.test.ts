import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { fixedClock } from "../src/shared/clock.js";

function app() {
  return createApp({ clock: fixedClock("2026-11-02T08:00:00+09:00") }).app;
}

const body = {
  roomId: "room-302",
  title: "스프린트 계획",
  organizer: "kim@example.com",
  attendees: ["lee@example.com"],
  start: "2026-11-02T14:00:00+09:00",
  end: "2026-11-02T15:00:00+09:00",
};

describe("HTTP API", () => {
  it("GET /rooms는 설비 조건으로 거른 목록을 돌려준다", async () => {
    const response = await request(app()).get("/rooms?equipment=video_conference");

    expect(response.status).toBe(200);
    expect(response.body.map((room: { id: string }) => room.id)).toEqual(["room-501", "room-502"]);
  });

  it("POST /reservations는 201과 예약 정보를 돌려준다", async () => {
    const response = await request(app()).post("/reservations").send(body);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("confirmed");
    expect(response.body.start).toBe("2026-11-02T05:00:00.000Z");
  });

  it("겹치는 예약은 409를 돌려준다", async () => {
    const server = app();
    await request(server).post("/reservations").send(body);
    const response = await request(server).post("/reservations").send(body);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("CONFLICT");
  });

  it("필수 값이 없으면 400을 돌려준다", async () => {
    const response = await request(app()).post("/reservations").send({ ...body, title: undefined });

    expect(response.status).toBe(400);
  });

  it("GET /rooms/:roomId/schedule은 그날의 예약을 돌려준다", async () => {
    const server = app();
    await request(server).post("/reservations").send(body);
    const response = await request(server).get("/rooms/room-302/schedule?date=2026-11-02");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it("POST /reservations/:id/cancel은 X-User-Email 헤더가 필요하다", async () => {
    const server = app();
    const created = await request(server).post("/reservations").send(body);
    const response = await request(server).post(`/reservations/${created.body.id}/cancel`);

    expect(response.status).toBe(400);
  });

  describe("반복 예약", () => {
    const seriesBody = {
      ...body,
      title: "주간 회의",
      start: "2026-11-02T10:00:00+09:00",
      end: "2026-11-02T11:00:00+09:00",
      recurrence: { frequency: "weekly", count: 3 },
    };

    it("POST /reservations/series는 201과 시리즈 정보를 돌려준다", async () => {
      const response = await request(app()).post("/reservations/series").send(seriesBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toMatch(/^srs_/);
      expect(response.body.recurrence).toEqual({ frequency: "weekly", count: 3 });
      expect(response.body.status).toBe("active");
      expect(response.body.occurrences).toHaveLength(3);
      expect(response.body.occurrences[0]).toMatchObject({
        start: "2026-11-02T01:00:00.000Z",
        status: "confirmed",
        seriesId: response.body.id,
      });
    });

    it("until로 만들어도 실제 회차 수를 count로 돌려준다", async () => {
      const response = await request(app())
        .post("/reservations/series")
        .send({ ...seriesBody, recurrence: { frequency: "weekly", until: "2026-11-16" } });

      expect(response.status).toBe(201);
      expect(response.body.recurrence).toEqual({ frequency: "weekly", count: 3 });
    });

    it("반복 규칙이 잘못되면 400을 돌려준다", async () => {
      const response = await request(app())
        .post("/reservations/series")
        .send({ ...seriesBody, recurrence: { frequency: "weekly" } });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_FAILED");
    });

    it("겹치는 회차가 있으면 409를 돌려준다", async () => {
      const server = app();
      await request(server)
        .post("/reservations")
        .send({ ...body, start: "2026-11-09T10:00:00+09:00", end: "2026-11-09T11:00:00+09:00" });
      const response = await request(server).post("/reservations/series").send(seriesBody);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        code: "CONFLICT",
        message: "백두 회의실은 다음 날짜에 이미 예약되어 있습니다: 11월 9일(월) 스프린트 계획",
      });
    });

    it("GET /reservations/series/:seriesId는 시리즈를 돌려주고 없으면 404다", async () => {
      const server = app();
      const created = await request(server).post("/reservations/series").send(seriesBody);
      const found = await request(server).get(`/reservations/series/${created.body.id}`);
      const missing = await request(server).get("/reservations/series/srs_missing");

      expect(found.status).toBe(200);
      expect(found.body).toEqual(created.body);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe("NOT_FOUND");
    });

    it("POST /reservations/series/:seriesId/cancel은 시리즈를 취소한다", async () => {
      const server = app();
      const created = await request(server).post("/reservations/series").send(seriesBody);
      const withoutHeader = await request(server).post(`/reservations/series/${created.body.id}/cancel`);
      const response = await request(server)
        .post(`/reservations/series/${created.body.id}/cancel`)
        .set("X-User-Email", "kim@example.com");

      expect(withoutHeader.status).toBe(400);
      expect(response.status).toBe(200);
      expect(response.body.status).toBe("cancelled");
      expect(response.body.occurrences.every((o: { status: string }) => o.status === "cancelled")).toBe(true);
    });

    it("회차는 하루 일정에 seriesId와 함께 나오고 단건 예약에는 seriesId가 없다", async () => {
      const server = app();
      const created = await request(server).post("/reservations/series").send(seriesBody);
      const single = await request(server)
        .post("/reservations")
        .send({ ...body, start: "2026-11-09T14:00:00+09:00", end: "2026-11-09T15:00:00+09:00" });
      const response = await request(server).get("/rooms/room-302/schedule?date=2026-11-09");

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].seriesId).toBe(created.body.id);
      expect(single.body).not.toHaveProperty("seriesId");
    });
  });
});
