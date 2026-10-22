import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptPlaidAccessToken,
  encryptPlaidAccessToken,
} from "./plaid";

const testKey = "a".repeat(64);

test("Plaid access tokens are encrypted and bound to their user and item", () => {
  const token = "sandbox-access-token";
  const encrypted = encryptPlaidAccessToken(token, "user-1:item-1", testKey);

  assert.notEqual(encrypted, token);
  assert.equal(decryptPlaidAccessToken(encrypted, "user-1:item-1", testKey), token);
  assert.throws(
    () => decryptPlaidAccessToken(encrypted, "user-2:item-1", testKey),
    /Could not decrypt/
  );
});

test("tampered Plaid token ciphertext is rejected", () => {
  const encrypted = encryptPlaidAccessToken("sandbox-access-token", "user:item", testKey);
  const tampered = `${encrypted.slice(0, -2)}AA`;

  assert.throws(
    () => decryptPlaidAccessToken(tampered, "user:item", testKey),
    /Could not decrypt/
  );
});
