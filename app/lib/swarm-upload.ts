const MAX_DEED_BYTES = 25 * 1024 * 1024;

export type DeedKeyFile = {
  version: 1;
  algorithm: "AES-GCM";
  applicationKey?: string;
  reference: string;
  key: string;
  iv: string;
  fileName: string;
  contentType: string;
};

const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function encryptAndUploadDeed(
  file: File,
  {
    beeUrl = process.env.NEXT_PUBLIC_SWARM_BEE_URL || "https://api.gateway.ethswarm.org",
    postageBatchId = process.env.NEXT_PUBLIC_SWARM_POSTAGE_BATCH_ID ?? "",
  }: { beeUrl?: string; postageBatchId?: string } = {},
  fetcher: typeof fetch = fetch,
  cryptoApi: Crypto = crypto,
) {
  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Choose a PDF deed file.");
  }
  if (file.size === 0 || file.size > MAX_DEED_BYTES) {
    throw new Error("The PDF must be between 1 byte and 25 MB.");
  }
  if (!beeUrl) {
    throw new Error("Swarm upload is not configured. Set the Bee URL.");
  }
  if (!/^[0-9a-f]{64}$/i.test(postageBatchId)) {
    throw new Error("Swarm uploads require a 64-character postage batch ID. Configure NEXT_PUBLIC_SWARM_POSTAGE_BATCH_ID.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(beeUrl);
  } catch {
    throw new Error("The configured Swarm Bee URL is invalid.");
  }
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
    throw new Error("Use HTTPS for the Swarm Bee endpoint outside local development.");
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/bytes`;
  endpoint.search = "";
  endpoint.hash = "";

  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await cryptoApi.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const [rawKey, ciphertext] = await Promise.all([
    cryptoApi.subtle.exportKey("raw", key),
    cryptoApi.subtle.encrypt({ name: "AES-GCM", iv }, key, await file.arrayBuffer()),
  ]);

  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
  };
  headers["Swarm-Postage-Batch-Id"] = postageBatchId;

  const response = await fetcher(endpoint, {
    method: "POST",
    headers,
    body: ciphertext,
  });
  if (!response.ok) {
    throw new Error(`Swarm upload failed (${response.status}). Check the Bee endpoint, CORS, and postage batch.`);
  }

  const payload: unknown = await response.json();
  const reference =
    typeof payload === "object" && payload !== null && "reference" in payload
      ? (payload as { reference?: unknown }).reference
      : undefined;
  if (typeof reference !== "string" || !/^[0-9a-f]{64}$/i.test(reference)) {
    throw new Error("Swarm returned an invalid content reference.");
  }

  const keyFile: DeedKeyFile = {
    version: 1,
    algorithm: "AES-GCM",
    reference,
    key: toBase64(new Uint8Array(rawKey)),
    iv: toBase64(iv),
    fileName: file.name,
    contentType: file.type || "application/pdf",
  };

  return { reference, keyFile };
}

export function downloadDeedKeyFile(keyFile: DeedKeyFile) {
  const blob = new Blob([JSON.stringify(keyFile, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "rent-me-out-deed-key.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function decryptDeedInBrowser(
  keyFile: DeedKeyFile,
  {
    beeUrl = process.env.NEXT_PUBLIC_SWARM_BEE_URL || "https://api.gateway.ethswarm.org",
  }: { beeUrl?: string } = {},
  fetcher: typeof fetch = fetch,
  cryptoApi: Crypto = crypto,
) {
  if (keyFile.version !== 1 || keyFile.algorithm !== "AES-GCM") {
    throw new Error("This deed key file version is not supported.");
  }
  if (!/^[0-9a-f]{64}$/i.test(keyFile.reference)) {
    throw new Error("The key file has an invalid Swarm reference.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(beeUrl);
  } catch {
    throw new Error("The configured Swarm Bee URL is invalid.");
  }
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
    throw new Error("Use HTTPS for the Swarm Bee endpoint outside local development.");
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/bytes/${keyFile.reference}`;
  endpoint.search = "";
  endpoint.hash = "";

  const response = await fetcher(endpoint, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not retrieve the deed from Swarm (${response.status}).`);
  }

  try {
    const key = await cryptoApi.subtle.importKey(
      "raw",
      fromBase64(keyFile.key),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(keyFile.iv) },
      key,
      await response.arrayBuffer(),
    );
    return new Blob([plaintext], { type: "application/pdf" });
  } catch {
    throw new Error("Decryption failed. Check that this key file matches the application.");
  }
}
