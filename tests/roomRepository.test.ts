import { describe, expect, it } from "vitest";
import type { Room } from "../src/rooms/room.js";
import { InMemoryRoomRepository, seedRooms } from "../src/rooms/roomRepository.js";

function sampleRooms(): Room[] {
  return [
    { id: "room-a", name: "가", floor: 1, capacity: 2, equipment: ["display"] },
    { id: "room-b", name: "나", floor: 2, capacity: 6, equipment: ["whiteboard"] },
  ];
}

describe("InMemoryRoomRepository", () => {
  it("findAll은 생성자에 넘긴 회의실을 모두 돌려준다", async () => {
    const repository = new InMemoryRoomRepository(sampleRooms());

    expect(await repository.findAll()).toEqual(sampleRooms());
  });

  it("findById는 id가 같은 회의실을 돌려준다", async () => {
    const repository = new InMemoryRoomRepository(sampleRooms());

    expect(await repository.findById("room-b")).toEqual(sampleRooms()[1]);
  });

  it("없는 id면 findById는 undefined를 돌려준다", async () => {
    const repository = new InMemoryRoomRepository(sampleRooms());

    expect(await repository.findById("room-999")).toBeUndefined();
  });

  it("빈 배열로 만들면 findAll은 빈 배열을 돌려준다", async () => {
    expect(await new InMemoryRoomRepository([]).findAll()).toEqual([]);
  });

  it("인자 없이 만들면 seedRooms를 담는다", async () => {
    const repository = new InMemoryRoomRepository();

    expect(await repository.findAll()).toEqual(seedRooms);
    expect(await repository.findById("room-502")).toEqual(seedRooms.find((room) => room.id === "room-502"));
  });

  it("findAll이 돌려준 회의실의 필드를 바꿔도 저장소에는 영향이 없다", async () => {
    const repository = new InMemoryRoomRepository(sampleRooms());

    const [room] = await repository.findAll();
    room.name = "바뀐 이름";
    room.capacity = 100;

    expect(await repository.findById("room-a")).toEqual(sampleRooms()[0]);
  });

  it("findAll이 돌려준 배열에 회의실을 넣거나 빼도 저장소에는 영향이 없다", async () => {
    const repository = new InMemoryRoomRepository(sampleRooms());

    const rooms = await repository.findAll();
    rooms.pop();
    rooms.push({ id: "room-x", name: "추가", floor: 9, capacity: 1, equipment: [] });

    expect(await repository.findAll()).toEqual(sampleRooms());
  });

  it("findById가 돌려준 회의실의 필드를 바꿔도 저장소에는 영향이 없다", async () => {
    const repository = new InMemoryRoomRepository(sampleRooms());

    const room = await repository.findById("room-a");
    room!.floor = 99;

    expect((await repository.findById("room-a"))!.floor).toBe(1);
  });

  // 기대: 반환된 회의실의 equipment 배열에 push해도 저장소 내부 상태는 그대로여야 한다.
  // 실제: findAll이 회의실 객체를 얕게만 복사해 equipment 배열을 저장소와 공유하므로 내부 상태가 바뀐다.
  it.fails("findAll이 돌려준 회의실의 equipment 배열을 바꿔도 저장소에는 영향이 없다", async () => {
    const repository = new InMemoryRoomRepository(sampleRooms());

    const [room] = await repository.findAll();
    room.equipment.push("video_conference");

    expect((await repository.findById("room-a"))!.equipment).toEqual(["display"]);
  });

  // 기대: 위와 같다(findById 경로).
  // 실제: findById도 얕은 복사라 equipment 배열을 저장소와 공유한다.
  it.fails("findById가 돌려준 회의실의 equipment 배열을 바꿔도 저장소에는 영향이 없다", async () => {
    const repository = new InMemoryRoomRepository(sampleRooms());

    const room = await repository.findById("room-a");
    room!.equipment.push("video_conference");

    expect((await repository.findById("room-a"))!.equipment).toEqual(["display"]);
  });

  it("생성자에 넘긴 배열에 회의실을 넣거나 빼도 저장소에는 영향이 없다", async () => {
    const rooms = sampleRooms();
    const repository = new InMemoryRoomRepository(rooms);

    rooms.pop();
    rooms.push({ id: "room-x", name: "추가", floor: 9, capacity: 1, equipment: [] });

    expect(await repository.findAll()).toEqual(sampleRooms());
  });

  it("생성자에 넘긴 회의실 객체의 필드를 나중에 바꿔도 저장소에는 영향이 없다", async () => {
    const rooms = sampleRooms();
    const repository = new InMemoryRoomRepository(rooms);

    rooms[0].name = "바뀐 이름";
    rooms[0].capacity = 100;

    expect(await repository.findById("room-a")).toEqual(sampleRooms()[0]);
  });

  // 기대: 생성자에 넘긴 회의실의 equipment 배열을 나중에 바꿔도 저장소 내부 상태는 그대로여야 한다.
  // 실제: 생성자가 회의실 객체를 얕게 복사해 equipment 배열을 호출자와 공유하므로 저장소 내용이 함께 바뀐다.
  it.fails("생성자에 넘긴 회의실의 equipment 배열을 나중에 바꿔도 저장소에는 영향이 없다", async () => {
    const rooms = sampleRooms();
    const repository = new InMemoryRoomRepository(rooms);

    rooms[0].equipment.push("video_conference");

    expect((await repository.findById("room-a"))!.equipment).toEqual(["display"]);
  });

  // 기대: 기본 저장소 하나에서 꺼낸 회의실의 equipment를 바꿔도 다른 기본 저장소에는 영향이 없어야 한다.
  // 실제: 인자 없이 만든 저장소는 모두 seedRooms의 equipment 배열을 공유해, 다른 인스턴스(다른 createApp 앱)와
  //       seedRooms 자체까지 바뀐다.
  it.fails("기본 저장소 하나의 equipment를 바꿔도 다른 기본 저장소에는 영향이 없다", async () => {
    const first = new InMemoryRoomRepository();
    const second = new InMemoryRoomRepository();
    const room = (await first.findById("room-301"))!;

    room.equipment.push("whiteboard");
    try {
      expect((await second.findById("room-301"))!.equipment).toEqual(["display"]);
    } finally {
      // 버그 때문에 공유된 seedRooms가 오염되므로, 같은 파일의 다른 테스트에 영향을 주지 않게 되돌린다.
      room.equipment.pop();
    }
  });
});
