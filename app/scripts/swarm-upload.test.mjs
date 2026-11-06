import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import { decryptDeedInBrowser, encryptAndUploadDeed } from "../lib/swarm-upload.ts";

const config = {
  beeUrl: "https://bee.example.test",
  postageBatchId: "ab".repeat(32),
};
const reference = "cd".repeat(32);

test("encrypts a PDF in the browser before uploading and returns a decryptable key file", async () => {
  const plaintext = new TextEncoder().encode("%PDF-1.7 private deed fixture");
  const file = new File([plaintext], "deed.pdf", { type: "application/pdf" });
  let request;
  const fetcher = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ reference }), { status: 201 });
  };

  const result = await encryptAndUploadDeed(file, config, fetcher, webcrypto);

  assert.equal(request.url, "https://bee.example.test/bytes");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["Swarm-Postage-Batch-Id"], config.postageBatchId);
  assert.notDeepEqual(new Uint8Array(request.init.body), plaintext);
  assert.equal(result.reference, reference);

  const key = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(result.keyFile.key, "base64"),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const decrypted = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(result.keyFile.iv, "base64") },
    key,
    request.init.body,
  );
  assert.deepEqual(new Uint8Array(decrypted), plaintext);
  assert.equal(result.keyFile.fileName, "deed.pdf");
  const decryptedDeed = await decryptDeedInBrowser(
    result.keyFile,
    { beeUrl: config.beeUrl },
    async (url, init) => {
      assert.equal(String(url), `${config.beeUrl}/bytes/${reference}`);
      assert.equal(init.cache, "no-store");
      return new Response(request.init.body, { status: 200 });
    },
    webcrypto,
  );
  assert.deepEqual(new Uint8Array(await decryptedDeed.arrayBuffer()), plaintext);
});

test("rejects non-PDF files and missing Swarm configuration before upload", async () => {
  const fetcher = async () => {
    assert.fail("fetch must not be called for invalid input");
  };
  await assert.rejects(
    encryptAndUploadDeed(new File(["image"], "image.png", { type: "image/png" }), config, fetcher, webcrypto),
    /Choose a PDF/,
  );
  await assert.rejects(
    encryptAndUploadDeed(
      new File(["%PDF"], "deed.pdf", { type: "application/pdf" }),
      { beeUrl: "", postageBatchId: "" },
      fetcher,
      webcrypto,
    ),
    /not configured/,
  );
  await assert.rejects(
    encryptAndUploadDeed(
      new File(["%PDF"], "deed.pdf", { type: "application/pdf" }),
      { beeUrl: config.beeUrl, postageBatchId: "" },
      fetcher,
      webcrypto,
    ),
    /postage batch ID/,
  );
});

test("rejects malformed references and reports unavailable Swarm downloads", async () => {
  const keyFile = {
    version: 1,
    algorithm: "AES-GCM",
    reference,
    key: "AA==",
    iv: "AA==",
    fileName: "deed.pdf",
    contentType: "application/pdf",
  };
  await assert.rejects(
    decryptDeedInBrowser({ ...keyFile, reference: "bad" }, { beeUrl: config.beeUrl }, async () => {
      assert.fail("fetch must not run for an invalid reference");
    }, webcrypto),
    /invalid Swarm reference/,
  );
  await assert.rejects(
    decryptDeedInBrowser(keyFile, { beeUrl: config.beeUrl }, async () => new Response("", { status: 404 }), webcrypto),
    /Swarm \(404\)/,
  );
});

test("reports Bee errors without returning a key file", async () => {
  const file = new File(["%PDF"], "deed.pdf", { type: "application/pdf" });
  await assert.rejects(
    encryptAndUploadDeed(
      file,
      config,
      async () => new Response("", { status: 402 }),
      webcrypto,
    ),
    /Swarm upload failed \(402\)/,
  );
});
