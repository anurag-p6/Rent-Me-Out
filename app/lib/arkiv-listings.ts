import type { RoomState } from "@/lib/data";

export interface PublicArkivRoom {
  $key: string;
  roomId: { value: string };
  propertyId: { value: string };
  propertyName: { value: string };
  roomName: { value: string };
  description: { value: string };
  locality: { value: string };
  city: { value: string };
  price: { value: string | number | bigint };
  startAt: { value: bigint | number | string };
  endAt: { value: bigint | number | string };
  status: { value: string };
}

export interface PublicArkivRoomCard {
  id: string;
  tokenId: string;
  name: string;
  note: string;
  price: number;
  state: RoomState;
  validFrom: string;
  validUntil: string;
  tint: string;
  propertyId: string;
  propertyName: string;
  locality: string;
  city: string;
  periodLabel: string;
  propertyApproved: false;
  arkivRecord: true;
}

const dateFromSeconds = (value: bigint | number | string) => {
  const date = new Date(Number(value) * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error("Arkiv listing has an invalid date.");
  return date.toISOString().slice(0, 10);
};

/** Convert one public Arkiv entity to the marketplace shape without treating it as a Hedera token. */
export function toPublicArkivRoom(entity: PublicArkivRoom, index = 0): PublicArkivRoomCard {
  const validFrom = dateFromSeconds(entity.startAt.value);
  const validUntil = dateFromSeconds(entity.endAt.value);
  const roomKey = entity.$key.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(roomKey)) {
    throw new Error("Arkiv returned an invalid listing entity key.");
  }
  const price = Number(entity.price.value);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Arkiv listing has an invalid price.");
  }

  return {
    // The entity key is the stable public URL. roomId can repeat across periods.
    id: roomKey,
    tokenId: roomKey,
    name: entity.roomName.value,
    note: entity.description.value,
    price,
    state: entity.status.value === "available" ? "available" : "cancelled",
    validFrom,
    validUntil,
    tint: `var(--room-${(index % 3) + 1})`,
    propertyId: entity.propertyId.value,
    propertyName: entity.propertyName.value,
    locality: entity.locality.value,
    city: entity.city.value,
    periodLabel: `${validFrom} – ${validUntil}`,
    propertyApproved: false,
    arkivRecord: true,
  };
}

export function isArkivListingKey(value: string): boolean {
  return /^0x[0-9a-f]{64}$/i.test(value);
}
