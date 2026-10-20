export type ReservationStatus = "confirmed" | "cancelled";

export interface Reservation {
  id: string;
  roomId: string;
  title: string;
  organizer: string;
  attendees: string[];
  start: Date;
  end: Date;
  status: ReservationStatus;
  createdAt: Date;
  cancelledAt?: Date;
  remindedAt?: Date;
  seriesId?: string; // 시리즈에 속한 회차만 가진다
}

export interface NewReservation {
  roomId: string;
  title: string;
  organizer: string;
  attendees: string[];
  start: Date;
  end: Date;
}
