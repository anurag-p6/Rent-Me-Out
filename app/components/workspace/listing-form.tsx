"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { addr, dec, u64 } from "@arkiv-network/sdk/schema";
import { VerifyBadge } from "@/components/ui/verify-badge";
import { WorldIdButton } from "@/components/ui/world-id-button";
import {
  connectArkivWallet,
  createRoomListing,
  type ArkivWalletClient,
} from "@/lib/arkiv";
import {
  fetchApprovedPropertyApplication,
  type PropertyApplicationRecord,
} from "@/lib/property-applications";
import {
  formatDate,
  formatUsdc,
  rooms,
  siteHost,
} from "@/lib/data";

type Phase = "idle" | "connecting" | "issuing" | "issued";

const retentionForEndDate = (date: string) =>
  Math.max(
    1,
    Math.ceil(
      (new Date(`${date}T23:59:59.999Z`).getTime() - Date.now()) /
        (24 * 60 * 60 * 1000),
    ),
  );

const overlapsActive = (start: string, end: string) =>
  new Date(start) <= new Date("2027-03-31") &&
  new Date(end) >= new Date("2027-01-01");

export function ListingForm() {
  const [wallet, setWallet] = useState<ArkivWalletClient | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [approvedApplication, setApprovedApplication] =
    useState<PropertyApplicationRecord | null>(null);
  const [verified, setVerified] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({
    r1: true,
    r2: true,
    r3: true,
  });
  const [prices, setPrices] = useState<Record<string, string>>({
    r1: "850",
    r2: "980",
    r3: "820",
  });
  const [start, setStart] = useState("2027-04-01");
  const [end, setEnd] = useState("2027-06-30");
  const [retentionDays, setRetentionDays] = useState(() =>
    retentionForEndDate("2027-06-30"),
  );
  const [retentionTouched, setRetentionTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [walletError, setWalletError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [createdRecords, setCreatedRecords] = useState<
    { roomId: string; entityKey: string; txHash: string }[]
  >([]);

  const availableRooms = approvedApplication
    ? rooms.slice(0, Math.min(approvedApplication.roomCount, rooms.length))
    : [];
  const chosen = availableRooms.filter((room) => selected[room.id]);
  const overlap = overlapsActive(start, end) && chosen.length > 0;
  const invalidDates = new Date(end) <= new Date(start);
  const minimumRetentionDays = retentionForEndDate(end);
  const invalidRetention =
    !Number.isInteger(retentionDays) ||
    retentionDays < minimumRetentionDays ||
    retentionDays > 36500;
  const total = chosen.reduce(
    (sum, room) => sum + Number(prices[room.id] || 0),
    0,
  );
  const ready =
    Boolean(wallet && walletAddress) &&
    Boolean(approvedApplication) &&
    verified &&
    chosen.length > 0 &&
    !overlap &&
    !invalidDates &&
    !invalidRetention &&
    chosen.every((room) => Number(prices[room.id]) > 0);

  const dateLabel = useMemo(() => {
    try {
      return `${formatDate(start)} – ${formatDate(end)}`;
    } catch {
      return "Choose a valid period";
    }
  }, [end, start]);

  const connectWallet = async () => {
    setPhase("connecting");
    setWalletError("");
    setWriteError("");
    try {
      const connectedWallet = await connectArkivWallet();
      setWallet(connectedWallet.walletClient);
      setWalletAddress(connectedWallet.account);
      const approved = await fetchApprovedPropertyApplication(connectedWallet.account);
      setApprovedApplication(approved);
      setSelected(
        Object.fromEntries(
          rooms.map((room, index) => [room.id, index < (approved?.roomCount ?? 0)]),
        ),
      );
      if (!approved) {
        setWriteError("No registrar-approved Arkiv property was found for this wallet.");
      }
    } catch (error) {
      setWalletError(
        error instanceof Error ? error.message : "Could not connect to Arkiv.",
      );
    } finally {
      setPhase("idle");
    }
  };

  const issue = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setPhase("issuing");
    setWriteError("");

    const records: typeof createdRecords = [...createdRecords];
    try {
      for (const room of chosen) {
        if (records.some((record) => record.roomId === room.id)) continue;
        const { entityKey, txHash } = await createRoomListing(
          wallet!,
          {
            listingId: `${approvedApplication!.key}:${room.id}`,
            propertyId: approvedApplication!.key,
            owner: addr(walletAddress as `0x${string}`),
            roomId: room.id,
            propertyName: approvedApplication!.propertyName,
            roomName: `Room ${availableRooms.findIndex((entry) => entry.id === room.id) + 1}`,
            description: "",
            locality: approvedApplication!.locality,
            city: approvedApplication!.city,
            price: dec(prices[room.id]),
            currency: "USDC",
            startAt: u64(
              BigInt(Math.floor(new Date(`${start}T00:00:00.000Z`).getTime() / 1000)),
            ),
            endAt: u64(
              BigInt(Math.floor(new Date(`${end}T23:59:59.999Z`).getTime() / 1000)),
            ),
            status: "available",
          },
          retentionDays,
        );
        records.push({ roomId: room.id, entityKey, txHash });
        setCreatedRecords([...records]);
      }
      setPhase("issued");
    } catch (error) {
      setWriteError(
        `${error instanceof Error ? error.message : "Arkiv write failed."}${records.length ? ` ${records.length} of ${chosen.length} listing(s) were created; see their entity keys below.` : ""}`,
      );
    } finally {
      setPhase((current) => (current === "issued" ? current : "idle"));
    }
  };

  if (phase === "issued") {
    return (
      <div className="content-grid">
        <section className="panel">
          <div className="panel__head">
            <h2>Listing created</h2>
            <span className="badge badge--verified">
              <span className="badge__check" aria-hidden="true">
                ✓
              </span>
              Written to Arkiv Rabdi
            </span>
          </div>
          <div className="panel__body">
            <div className="notice notice--verified">
              <span className="notice__icon" aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>
                  {createdRecords.length} of {chosen.length} Arkiv listing
                  {chosen.length === 1 ? "" : "s"} created · {dateLabel}
                </strong>
                <p>
                  Each public-safe room record will remain queryable for {retentionDays}{" "}
                  days, then expire from Arkiv queries. Hedera token issuance is a
                  separate step and is not performed by this form yet.
                </p>
              </div>
            </div>

            <div className="detail-meta" style={{ marginTop: 22 }}>
              <div>
                <span className="micro">Total one-time value</span>
                <strong>{formatUsdc(total)} USDC</strong>
              </div>
              <div>
                <span className="micro">Arkiv entities</span>
                <strong>{createdRecords.length}</strong>
              </div>
              <div>
                <span className="micro">Connected owner</span>
                <strong className="mono" style={{ fontSize: 10 }}>
                  {walletAddress?.slice(0, 6)}…{walletAddress?.slice(-4)}
                </strong>
              </div>
              <div>
                <span className="micro">Database lifetime</span>
                <strong>{retentionDays} days on Arkiv</strong>
              </div>
            </div>

            <div className="stack-16" style={{ marginTop: 22 }}>
              {chosen.map((room) => (
                <div className="between panel panel--pad" key={room.id}>
                  <div>
                    <strong>{room.name}</strong>
                    <p className="small dim" style={{ marginTop: 4 }}>
                      {formatUsdc(Number(prices[room.id]))} USDC · {dateLabel}
                    </p>
                    <p className="mono" style={{ marginTop: 6, fontSize: 9 }}>
                      Entity {createdRecords.find((record) => record.roomId === room.id)?.entityKey ?? "pending"}
                      {" · "}
                      Tx {createdRecords.find((record) => record.roomId === room.id)?.txHash ?? "pending"}
                    </p>
                  </div>
                    <Link
                    href={`/marketplace/${createdRecords.find((record) => record.roomId === room.id)?.entityKey ?? room.id}`}
                    className="text-link"
                    style={{ fontSize: 11.5 }}
                  >
                    Public listing
                  </Link>
                </div>
              ))}
            </div>

            <div className="form-actions">
              <Link href="/owner" className="btn">
                Back to dashboard
              </Link>
              <Link href="/verify/rmo-3b-andheri?room=r2" className="btn btn--ghost">
                Open verification page
              </Link>
            </div>
          </div>
        </section>

        <aside className="panel panel--pad">
          <p className="eyebrow">QR + verification</p>
          <p className="small" style={{ marginTop: 10, color: "rgba(22,35,59,.68)" }}>
            Every room gets a public link. Property approval and the rental-right
            token still need Hedera confirmation; this form does not perform that mint.
          </p>
          <p className="mono" style={{ marginTop: 14, fontSize: 10.5, wordBreak: "break-all" }}>
            {siteHost}/verify/rmo-3b-andheri?room=r2
          </p>
        </aside>
      </div>
    );
  }

  return (
    <form onSubmit={issue}>
      <div className="content-grid">
        <div className="stack-24">
          <section className="panel">
            <div className="panel__head">
              <h2>Property and period</h2>
              <span className="badge badge--verified">
                <span className="badge__check" aria-hidden="true">
                  ✓
                </span>
                Approved
              </span>
            </div>
            <div className="panel__body">
              <div className="form-grid">
                <div className="field field--wide">
                  <label htmlFor="property">Approved property</label>
                  <input
                    id="property"
                    value={approvedApplication ? `${approvedApplication.propertyName} · ${approvedApplication.locality}` : "Connect the owner wallet to check approval"}
                    readOnly
                  />
                  <span className="field__hint">
                    Only an Arkiv application with an allowlisted registrar approval can be listed.
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="start">Start date</label>
                  <input
                    id="start"
                    type="date"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="end">End date</label>
                  <input
                    id="end"
                    type="date"
                    value={end}
                    onChange={(event) => {
                      setEnd(event.target.value);
                      if (!retentionTouched) {
                        setRetentionDays(retentionForEndDate(event.target.value));
                      }
                    }}
                  />
                </div>
                <div className="field field--wide">
                  <label htmlFor="retention-days">Keep public Arkiv listing for</label>
                  <div className="between wrap">
                    <input
                      id="retention-days"
                      type="number"
                      min={minimumRetentionDays}
                      max="36500"
                      step="1"
                      value={retentionDays}
                      onChange={(event) => {
                        setRetentionTouched(true);
                        setRetentionDays(Number(event.target.value));
                      }}
                    />
                    <span className="small dim">days from the write transaction</span>
                  </div>
                  <span className="field__hint">
                    Must cover the full rental period. Minimum for these dates: {minimumRetentionDays} days.
                    Arkiv removes expired records from queries; never put deeds, exact addresses, tenant
                    identity, Swarm keys, or ZK witnesses in this public record.
                  </span>
                </div>
              </div>

              {overlap && (
                <div className="notice notice--alert" style={{ marginTop: 16 }}>
                  <span className="notice__icon" aria-hidden="true">
                    !
                  </span>
                  <div>
                    <strong>Rooms already listed for part of this period.</strong>
                    <p>
                      Room 2 is sold for Jan – Mar 2027 and the other rooms have
                      an active listing. Pick a non-overlapping period, such as
                      1 Apr – 30 Jun 2027.
                    </p>
                  </div>
                </div>
              )}
              {invalidDates && (
                <div className="notice notice--alert" style={{ marginTop: 16 }}>
                  <span className="notice__icon" aria-hidden="true">
                    !
                  </span>
                  <div>
                    <strong>The end date must be after the start date.</strong>
                    <p>The registry rejects zero-length and reversed periods.</p>
                  </div>
                </div>
              )}
              {invalidRetention && (
                <div className="notice notice--alert" style={{ marginTop: 16 }}>
                  <span className="notice__icon" aria-hidden="true">!</span>
                  <div>
                    <strong>Choose a valid Arkiv retention period.</strong>
                    <p>
                      Enter a whole number from {minimumRetentionDays} to 36500 days so the listing
                      remains searchable through the rental end date.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <h2>Rooms and one-time price</h2>
              <span className="badge badge--quiet">1 token per room</span>
            </div>
            <div className="panel__body">
              <div className="stack-16">
                {rooms.map((room, index) => (
                  <div
                    className="between wrap"
                    key={room.id}
                    style={{
                      paddingBottom: 14,
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <label className="choice">
                      <input
                        type="checkbox"
                        checked={Boolean(selected[room.id])}
                        disabled={index >= (approvedApplication?.roomCount ?? 0)}
                        onChange={(event) =>
                          setSelected({
                            ...selected,
                            [room.id]: event.target.checked,
                          })
                        }
                      />
                      Room {index + 1} · {room.name.split("·")[1]?.trim()}
                    </label>
                    <div className="field" style={{ width: 150 }}>
                      <label htmlFor={`price-${room.id}`}>Price · USDC</label>
                      <input
                        id={`price-${room.id}`}
                        type="number"
                        min="1"
                        value={prices[room.id]}
                        onChange={(event) =>
                          setPrices({ ...prices, [room.id]: event.target.value })
                        }
                        disabled={!selected[room.id]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <h2>Confirm issuance</h2>
              <span className="badge badge--quiet">Arkiv Rabdi wallet required</span>
            </div>
            <div className="panel__body">
              {!wallet ? (
                <div className="notice notice--brass">
                  <span className="notice__icon" aria-hidden="true">
                    1
                  </span>
                  <div style={{ flex: 1 }}>
                    <strong>Connect the owner wallet.</strong>
                    <p>The owner wallet signs the Arkiv entity writes on Rabdi.</p>
                    <button
                      type="button"
                      className="btn btn--small"
                      style={{ marginTop: 12 }}
                      onClick={() => void connectWallet()}
                      disabled={phase === "connecting"}
                    >
                      {phase === "connecting" ? "Connecting…" : "Connect Rabdi wallet"}
                    </button>
                    {walletError && <p className="small" role="alert" style={{ marginTop: 10 }}>{walletError}</p>}
                  </div>
                </div>
              ) : !verified ? (
                <div className="notice notice--brass">
                  <span className="notice__icon" aria-hidden="true">
                    2
                  </span>
                  <div style={{ flex: 1 }}>
                    <strong>Verify the owner identity.</strong>
                    <p>
                      The demo owner verification gate is required before listing.
                      Hedera allowlist and token issuance still need contract integration.
                    </p>
                    <div style={{ marginTop: 12 }}>
                      <WorldIdButton
                        action="owner-verify"
                        label="Verify with World ID"
                        onVerified={() => setVerified(true)}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="notice notice--verified">
                  <span className="notice__icon" aria-hidden="true">
                    ✓
                  </span>
                  <div>
                    <strong>Owner verified and allowlisted.</strong>
                    <p>
                      Each selected room will be written as a public-safe Arkiv entity.
                      This demo verification badge does not submit a Hedera token mint.
                    </p>
                  </div>
                </div>
              )}

              <div className="form-actions">
                <div>
                  <button
                    type="submit"
                    className="btn"
                    disabled={!ready || phase === "issuing"}
                  >
                    {phase === "issuing"
                      ? `Writing ${createdRecords.length + 1} of ${chosen.length}…`
                      : `Create ${chosen.length} Arkiv ${chosen.length === 1 ? "listing" : "listings"}`}
                  </button>
                  {writeError && <p className="small" role="alert" style={{ marginTop: 10 }}>{writeError}</p>}
                  {!ready && phase === "idle" && (
                    <p className="form-lock" style={{ marginTop: 10 }}>
                      <span aria-hidden="true">●</span>
                      {!wallet
                        ? "Connect a wallet on Arkiv Rabdi to continue."
                        : !approvedApplication
                          ? "Submit a property and wait for registrar approval before listing."
                        : !verified
                          ? "Verify your identity to issue tokens."
                          : chosen.length === 0
                            ? "Select at least one room."
                            : overlap
                              ? "Choose a non-overlapping period."
                              : invalidRetention
                                ? "Set a valid Arkiv retention period."
                                : "Complete the price and date fields."}
                    </p>
                  )}
                </div>
                <p className="form-actions__note">
                  Confirmation appears after each Arkiv transaction is included. Each room is a
                  separate write; if one fails, successful entity keys remain visible above.
                </p>
              </div>
            </div>
          </section>
        </div>

        <aside className="stack-16">
          <section className="panel panel--pad">
            <p className="eyebrow">Preview</p>
            <h2 className="subtitle" style={{ marginTop: 10 }}>
              {approvedApplication?.propertyName ?? "No approved property"}
            </h2>
            <p className="small dim" style={{ marginTop: 4 }}>
              {dateLabel}
            </p>

            <div className="buy-panel__list" style={{ marginTop: 16 }}>
              {chosen.map((room) => (
                <div key={room.id}>
                  <span>Room {rooms.findIndex((entry) => entry.id === room.id) + 1}</span>
                  <span className="mono">
                    {formatUsdc(Number(prices[room.id] || 0))} USDC
                  </span>
                </div>
              ))}
              <div>
                <span>Total</span>
                <span className="mono">{formatUsdc(total)} USDC</span>
              </div>
            </div>

            {verified && <VerifyBadge label="Owner verified" />}

            <p className="buy-panel__note">
              The broker pays this amount once for the full period. Tenant rent
              and deposit are arranged separately with the broker.
            </p>
          </section>

          <section className="panel panel--pad">
            <p className="eyebrow">Contract checks</p>
            <div className="timeline" style={{ marginTop: 12 }}>
              <div className="timeline__item" data-done="true">
                <span className="timeline__dot" />
                <div>
                  <strong>Property approved</strong>
                  <span>{approvedApplication ? "Registrar approval found on Arkiv" : "Registrar approval required"}</span>
                </div>
              </div>
              <div className="timeline__item" data-done={!overlap}>
                <span className="timeline__dot" />
                <div>
                  <strong>No overlap</strong>
                  <span>Same room cannot have two active periods</span>
                </div>
              </div>
              <div className="timeline__item" data-done={Boolean(ready)}>
                <span className="timeline__dot" />
                <div>
                  <strong>Owner allowlisted</strong>
                  <span>Hedera allowlist check is not connected to this form yet</span>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </form>
  );
}
