import assert from "node:assert/strict";
import { test } from "node:test";
import { isArkivListingKey, toPublicArkivRoom } from "../lib/arkiv-listings.ts";

const record = (overrides = {}) => ({
  $key: `0x${"ab".repeat(32)}`,
  roomId: { value: "r1" },
  propertyId: { value: `0x${"cd".repeat(32)}` },
  propertyName: { value: "Bandra studio" },
  roomName: { value: "Room 1" },
  description: { value: "Bright room" },
  locality: { value: "Bandra East" },
  city: { value: "Mumbai" },
  price: { value: "850" },
  startAt: { value: 1806537600n },
  endAt: { value: 1814313599n },
  status: { value: "available" },
  ...overrides,
});

test("maps an Arkiv room to a stable entity-key marketplace URL", () => {
  const listing = toPublicArkivRoom(record(), 1);
  assert.equal(listing.id, `0x${"ab".repeat(32)}`);
  assert.equal(listing.tokenId, listing.id);
  assert.equal(listing.name, "Room 1");
  assert.equal(listing.price, 850);
  assert.equal(listing.state, "available");
  assert.equal(listing.arkivRecord, true);
  assert.equal(listing.propertyApproved, false);
  assert.equal(listing.tint, "var(--room-2)");
  assert.match(listing.periodLabel, /^2027-/);
});

test("does not present non-available Arkiv entities as available", () => {
  assert.equal(toPublicArkivRoom(record({ status: { value: "cancelled" } })).state, "cancelled");
});

test("validates entity keys and listing data before building public cards", () => {
  assert.equal(isArkivListingKey(`0x${"01".repeat(32)}`), true);
  assert.equal(isArkivListingKey("r1"), false);
  assert.throws(() => toPublicArkivRoom(record({ $key: "r1" })), /entity key/);
  assert.throws(() => toPublicArkivRoom(record({ price: { value: "0" } })), /price/);
});
