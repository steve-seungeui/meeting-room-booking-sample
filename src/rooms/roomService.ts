import { NotFoundError } from "../shared/errors.js";
import type { Equipment, Room } from "./room.js";
import type { RoomRepository } from "./roomRepository.js";

export interface RoomFilter {
  floor?: number;
  minCapacity?: number;
  equipment?: Equipment[];
}

export class RoomService {
  constructor(private readonly rooms: RoomRepository) {}

  async list(filter: RoomFilter = {}): Promise<Room[]> {
    const all = await this.rooms.findAll();
    return all
      .filter((room) => filter.floor === undefined || room.floor === filter.floor)
      .filter((room) => filter.minCapacity === undefined || room.capacity >= filter.minCapacity)
      .filter((room) => (filter.equipment ?? []).every((item) => room.equipment.includes(item)))
      .sort((a, b) => a.floor - b.floor || a.capacity - b.capacity);
  }

  async get(id: string): Promise<Room> {
    const room = await this.rooms.findById(id);
    if (!room) {
      throw new NotFoundError(`회의실을 찾을 수 없습니다: ${id}`);
    }
    return room;
  }
}
