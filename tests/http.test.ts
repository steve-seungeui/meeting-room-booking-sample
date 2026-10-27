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

  it("GET /rooms는 floor 조건으로 거르고, 수용 인원과 함께 쓸 수 있다", async () => {
    const floor = await request(app()).get("/rooms?floor=5");
    const both = await request(app()).get("/rooms?floor=5&minCapacity=12");

    expect(floor.status).toBe(200);
    expect(floor.body.map((room: { id: string }) => room.id)).toEqual(["room-501", "room-502"]);
    expect(both.status).toBe(200);
    expect(both.body.every((room: { floor: number }) => room.floor === 5)).toBe(true);
  });

  it("GET /rooms는 floor가 정수가 아니면 400을 돌려준다", async () => {
    for (const floor of ["abc", "1.5"]) {
      const response = await request(app()).get(`/rooms?floor=${floor}`);

      expect(response.status).toBe(400);
    }
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

  it("PATCH /reservations/:id는 시간을 바꾸고, 겹치면 409, 다른 사람이면 400을 돌려준다", async () => {
    const server = app();
    const created = await request(server).post("/reservations").send(body);
    await request(server)
      .post("/reservations")
      .send({ ...body, start: "2026-11-02T16:00:00+09:00", end: "2026-11-02T17:00:00+09:00" });
    const url = `/reservations/${created.body.id}`;
    const next = { start: "2026-11-02T11:00:00+09:00", end: "2026-11-02T12:00:00+09:00" };

    const noHeader = await request(server).patch(url).send(next);
    const stranger = await request(server).patch(url).set("X-User-Email", "lee@example.com").send(next);
    const conflict = await request(server)
      .patch(url)
      .set("X-User-Email", "kim@example.com")
      .send({ start: "2026-11-02T16:30:00+09:00", end: "2026-11-02T17:30:00+09:00" });
    const ok = await request(server).patch(url).set("X-User-Email", "kim@example.com").send(next);

    expect(noHeader.status).toBe(400);
    expect(stranger.status).toBe(400);
    expect(conflict.status).toBe(409);
    expect(ok.status).toBe(200);
    expect(ok.body.start).toBe("2026-11-02T02:00:00.000Z");
  });

  it("PATCH /reservations/:id에 roomId만 보내면 회의실을 옮기고, 겹치면 409, 다른 사람이면 400을 돌려준다", async () => {
    const server = app();
    const created = await request(server).post("/reservations").send(body);
    await request(server).post("/reservations").send({ ...body, roomId: "room-501", attendees: [] });
    const url = `/reservations/${created.body.id}`;

    const stranger = await request(server).patch(url).set("X-User-Email", "lee@example.com").send({ roomId: "room-502" });
    const conflict = await request(server).patch(url).set("X-User-Email", "kim@example.com").send({ roomId: "room-501" });
    const both = await request(server)
      .patch(url)
      .set("X-User-Email", "kim@example.com")
      .send({ roomId: "room-502", start: body.start, end: body.end });
    const unknown = await request(server).patch(url).set("X-User-Email", "kim@example.com").send({ roomId: "room-999" });
    const ok = await request(server).patch(url).set("X-User-Email", "kim@example.com").send({ roomId: "room-502" });

    expect(stranger.status).toBe(400);
    expect(conflict.status).toBe(409);
    expect(both.status).toBe(400);
    expect(unknown.status).toBe(404);
    expect(ok.status).toBe(200);
    expect(ok.body.roomId).toBe("room-502");
    expect(ok.body.start).toBe(created.body.start);
  });
  it("PATCH /reservations/:id는 attendees로 참석자를 바꾼다", async () => {
    const server = app();
    const created = await request(server).post("/reservations").send(body);
    const response = await request(server)
      .patch(`/reservations/${created.body.id}`)
      .set("X-User-Email", "kim@example.com")
      .send({ attendees: ["park@example.com"] });

    expect(response.status).toBe(200);
    expect(response.body.attendees).toEqual(["park@example.com"]);
  });

  it("PATCH /reservations/:id의 attendees는 예약자만, 배열로, 정원 안에서, 다른 항목 없이 보낼 수 있다", async () => {
    const server = app();
    const created = await request(server).post("/reservations").send(body);
    const patch = () => request(server).patch(`/reservations/${created.body.id}`);

    expect((await patch().send({ attendees: [] })).status).toBe(400);
    expect((await patch().set("X-User-Email", "lee@example.com").send({ attendees: [] })).status).toBe(400);
    expect((await patch().set("X-User-Email", "kim@example.com").send({ attendees: "lee@example.com" })).status).toBe(400);
    const tooMany = Array.from({ length: 8 }, (_, i) => `p${i}@example.com`);
    expect((await patch().set("X-User-Email", "kim@example.com").send({ attendees: tooMany })).status).toBe(400);
    const mixed = await patch()
      .set("X-User-Email", "kim@example.com")
      .send({ attendees: [], roomId: "room-501" });
    expect(mixed.status).toBe(400);
    const missing = await request(server)
      .patch("/reservations/rsv-none")
      .set("X-User-Email", "kim@example.com")
      .send({ attendees: [] });
    expect(missing.status).toBe(404);
  });
});
