"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchActiveRoomListings } from "@/lib/arkiv";
import { toPublicArkivRoom } from "@/lib/arkiv-listings";
import { RoomCard, type RoomCardData } from "./room-card";

export function MarketplaceClient({ rooms }: { rooms: RoomCardData[] }) {
  const [arkivRooms, setArkivRooms] = useState<RoomCardData[]>([]);
  const [arkivStatus, setArkivStatus] = useState<"loading" | "ready" | "offline">("loading");
  const [query, setQuery] = useState("");
  const [price, setPrice] = useState("any");
  const [availability, setAvailability] = useState("all");

  useEffect(() => {
    let active = true;
    fetchActiveRoomListings()
      .then((entities) => {
        if (!active) return;
        const fetchedRooms: RoomCardData[] = entities.map((entity, index) =>
          toPublicArkivRoom(entity, index),
        );
        setArkivRooms(fetchedRooms);
        setArkivStatus("ready");
      })
      .catch(() => {
        if (active) setArkivStatus("offline");
      });

    return () => {
      active = false;
    };
  }, []);

  const allRooms = useMemo(() => {
    const byId = new Map(rooms.map((room) => [room.id, room]));
    for (const room of arkivRooms) byId.set(room.id, room);
    return [...byId.values()];
  }, [arkivRooms, rooms]);

  const filtered = useMemo(() => {
    return allRooms.filter((room) => {
      const haystack =
        `${room.name} ${room.propertyName} ${room.locality} ${room.city} ${room.note}`.toLowerCase();
      const matchesQuery = haystack.includes(query.toLowerCase());
      const matchesPrice =
        price === "any" ||
        (price === "under900" && room.price < 900) ||
        (price === "900plus" && room.price >= 900);
      const matchesAvailability =
        availability === "all" ||
        (availability === "available" && room.state === "available") ||
        (availability === "held" && room.state === "held");
      return matchesQuery && matchesPrice && matchesAvailability;
    });
  }, [allRooms, availability, price, query]);

  return (
    <>
      <div className="filter-bar">
        <div className="field field--search">
          <label htmlFor="room-search">Search rooms</label>
          <input
            id="room-search"
            type="search"
            placeholder="Locality, property or room"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="room-price">Price</label>
          <select
            id="room-price"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          >
            <option value="any">Any price</option>
            <option value="under900">Under 900 USDC</option>
            <option value="900plus">900 USDC and above</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="room-state">Availability</label>
          <select
            id="room-state"
            value={availability}
            onChange={(event) => setAvailability(event.target.value)}
          >
            <option value="all">All rooms</option>
            <option value="available">Available</option>
            <option value="held">Held</option>
          </select>
        </div>
        <span className="small dim" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "room" : "rooms"}
        </span>
      </div>

      {arkivStatus === "offline" && (
        <p className="small dim" role="status" style={{ marginTop: 14 }}>
          Arkiv is unavailable right now; showing the sample listings.
        </p>
      )}
      {arkivStatus === "ready" && arkivRooms.length > 0 && (
        <p className="small dim" role="status" style={{ marginTop: 14 }}>
          Arkiv results are public records. Confirm property approval and current room rights on Hedera.
        </p>
      )}

      {filtered.length > 0 ? (
        <div className="room-grid">
          {filtered.map((room) => {
            const index = allRooms.findIndex((entry) => entry.id === room.id);
            return <RoomCard key={room.id} room={room} index={index} />;
          })}
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 26 }}>
          <h3>No rooms match these filters.</h3>
          <p>
            Try a different locality, raise the price, or clear the availability
            filter. Only rooms with a future, non-overlapping period appear here.
          </p>
        </div>
      )}
    </>
  );
}
