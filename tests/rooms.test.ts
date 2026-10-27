import { describe, expect, it } from "vitest";
import { InMemoryRoomRepository } from "../src/rooms/roomRepository.js";
import { RoomService } from "../src/rooms/roomService.js";
import { NotFoundError } from "../src/shared/errors.js";

describe("RoomService", () => {
  const service = new RoomService(new InMemoryRoomRepository());

  it("층과 수용 인원 순으로 정렬해 돌려준다", async () => {
    const rooms = await service.list();
    expect(rooms.map((room) => room.id)).toEqual(["room-301", "room-302", "room-501", "room-502"]);
  });

  it("최소 수용 인원으로 거른다", async () => {
    const rooms = await service.list({ minCapacity: 10 });
    expect(rooms.map((room) => room.id)).toEqual(["room-501", "room-502"]);
  });

  it("필요한 설비를 모두 갖춘 회의실만 돌려준다", async () => {
    const rooms = await service.list({ equipment: ["video_conference", "whiteboard"] });
    expect(rooms.map((room) => room.id)).toEqual(["room-502"]);
  });

  it("층으로 거른다", async () => {
    const rooms = await service.list({ floor: 5 });
    expect(rooms.map((room) => room.id)).toEqual(["room-501", "room-502"]);
  });

  it("없는 회의실을 조회하면 NotFoundError를 던진다", async () => {
    await expect(service.get("room-999")).rejects.toBeInstanceOf(NotFoundError);
  });
});
