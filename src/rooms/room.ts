export type Equipment = "display" | "video_conference" | "whiteboard";

export interface Room {
  id: string;
  name: string;
  floor: number;
  capacity: number;
  equipment: Equipment[];
}
