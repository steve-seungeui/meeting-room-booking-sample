import type { Room } from "./room.js";

export interface RoomRepository {
  findAll(): Promise<Room[]>;
  findById(id: string): Promise<Room | undefined>;
}

export const seedRooms: Room[] = [
  { id: "room-301", name: "한라", floor: 3, capacity: 4, equipment: ["display"] },
  { id: "room-302", name: "백두", floor: 3, capacity: 8, equipment: ["display", "whiteboard"] },
  { id: "room-501", name: "지리", floor: 5, capacity: 12, equipment: ["display", "video_conference"] },
  { id: "room-502", name: "설악", floor: 5, capacity: 20, equipment: ["display", "video_conference", "whiteboard"] },
];

export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms: Map<string, Room>;

  constructor(rooms: Room[] = seedRooms) {
    this.rooms = new Map(rooms.map((room) => [room.id, { ...room }]));
  }

  async findAll(): Promise<Room[]> {
    return [...this.rooms.values()].map((room) => ({ ...room }));
  }

  async findById(id: string): Promise<Room | undefined> {
    const room = this.rooms.get(id);
    return room ? { ...room } : undefined;
  }
}
