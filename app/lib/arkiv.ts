import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
} from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import {
  addr,
  dec,
  defineSchema,
  str,
  u64,
} from "@arkiv-network/sdk/schema";
import { and, eq, gt } from "@arkiv-network/sdk/query";
import { custom, http, type Address, type Chain } from "viem";

const accessKey = process.env.NEXT_PUBLIC_ARKIV_ACCESS_KEY ?? "";

export const arkivChain = rabdi({ accessKey });
const walletChain = rabdi({ accessKey: "" });

export const arkivPublicClient = createPublicClient({
  chain: arkivChain,
  transport: http(),
});

export const RoomListingSchema = defineSchema("rent-me-out.room-listing.v1", {
  listingId: str().indexed(),
  propertyId: str().indexed(),
  owner: addr().indexed(),
  roomId: str().indexed(),
  propertyName: str(),
  roomName: str(),
  description: str(),
  locality: str().indexed(),
  city: str().indexed(),
  price: dec().indexed(),
  currency: str(),
  startAt: u64().indexed(),
  endAt: u64().indexed(),
  status: str().indexed(),
});

export type RoomListingValues = {
  listingId: string;
  propertyId: string;
  owner: ReturnType<typeof addr>;
  roomId: string;
  propertyName: string;
  roomName: string;
  description: string;
  locality: string;
  city: string;
  price: ReturnType<typeof dec>;
  currency: string;
  startAt: ReturnType<typeof u64>;
  endAt: ReturnType<typeof u64>;
  status: string;
};

export type ArkivWalletClient = ReturnType<typeof createWalletClient>;

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

function getProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No injected wallet found. Install or open MetaMask to continue.");
  }
  return window.ethereum;
}

async function ensureRabdi(provider: Eip1193Provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${arkivChain.id.toString(16)}` }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${arkivChain.id.toString(16)}`,
          chainName: arkivChain.name,
          nativeCurrency: arkivChain.nativeCurrency,
          rpcUrls: [walletChain.rpcUrls.default.http[0]],
          blockExplorerUrls: [arkivChain.blockExplorers.default.url],
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${arkivChain.id.toString(16)}` }],
    });
  }

  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || Number.parseInt(chainId, 16) !== arkivChain.id) {
    throw new Error("Switch your wallet to Arkiv Rabdi to continue.");
  }
}

export async function connectArkivWallet() {
  const provider = getProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("The wallet did not return an account.");
  }

  await ensureRabdi(provider);
  const account = accounts[0] as Address;
  const walletClient = createWalletClient({
    chain: walletChain as Chain,
    transport: custom(provider),
    account,
  });

  return { account, walletClient };
}

export async function createRoomListing(
  walletClient: ArkivWalletClient,
  values: RoomListingValues,
  retentionDays: number,
) {
  const result = await walletClient.createEntity(
    RoomListingSchema,
    values,
    { expiration: ExpirationTime.fromDays(retentionDays) },
  );

  return result;
}

export async function fetchActiveRoomListings() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const { entities } = await arkivPublicClient
    .select()
    .from(RoomListingSchema)
    .where(and(eq("status", "available"), gt("endAt", u64(now))))
    .fetch();

  return entities;
}

export async function fetchRoomListing(entityKey: string) {
  if (!/^0x[0-9a-f]{64}$/i.test(entityKey)) return null;
  try {
    const entity = await arkivPublicClient.getEntity(
      entityKey as `0x${string}`,
      RoomListingSchema,
    );
    if (entity.status.value !== "available") return null;
    if (Number(entity.endAt.value) <= Math.floor(Date.now() / 1000)) return null;
    return entity;
  } catch {
    return null;
  }
}
