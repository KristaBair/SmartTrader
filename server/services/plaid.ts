import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

export interface PlaidSetupStatus {
  configured: boolean;
  environment: "sandbox" | "production" | "invalid";
  products: string[];
  message?: string;
}

interface EncryptedTokenEnvelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

function readEncryptionKey(secret = process.env.PLAID_TOKEN_ENCRYPTION_KEY): Buffer | null {
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) return null;
  return Buffer.from(secret, "hex");
}

function getPlaidClientId() {
  return process.env.PLAID_CLIENT_ID || process.env.PlaidClientID;
}

function getPlaidSecret() {
  return process.env.PLAID_SECRET || process.env.PlaidSecret;
}

export function getPlaidSetupStatus(): PlaidSetupStatus {
  const environmentValue = (process.env.PLAID_ENV || "sandbox").trim().toLowerCase();
  const environment = environmentValue === "sandbox" || environmentValue === "production"
    ? environmentValue
    : "invalid";
  const products = (process.env.PLAID_PRODUCTS || "investments")
    .split(",")
    .map((product) => product.trim().toLowerCase())
    .filter(Boolean);
  const hasCredentials = Boolean(getPlaidClientId() && getPlaidSecret());
  const hasEncryptionKey = readEncryptionKey() !== null;
  const productionApproved = process.env.PLAID_PRODUCTION_APPROVED === "true";
  const supportedProducts = new Set(["investments", "transactions"]);
  const validProducts = products.length > 0
    && new Set(products).size === products.length
    && products.every((product) => supportedProducts.has(product));

  let message: string | undefined;
  if (!hasCredentials || !hasEncryptionKey) {
    message = "Plaid Sandbox setup is incomplete. Ask the site administrator to finish configuration.";
  } else if (environment === "invalid") {
    message = "Plaid environment must be sandbox or production.";
  } else if (environment === "production" && !productionApproved) {
    message = "Plaid Production is disabled until production access is explicitly approved.";
  } else if (!validProducts) {
    message = "Configured Plaid products are not supported by this release.";
  }

  return {
    configured: message === undefined,
    environment,
    products,
    ...(message ? { message } : {}),
  };
}

export function createPlaidClient(): PlaidApi {
  const status = getPlaidSetupStatus();
  if (!status.configured) {
    throw new Error(status.message || "Plaid is not configured.");
  }

  const basePath = status.environment === "production"
    ? PlaidEnvironments.production
    : PlaidEnvironments.sandbox;

  return new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": getPlaidClientId()!,
          "PLAID-SECRET": getPlaidSecret()!,
        },
      },
    })
  );
}

export function encryptPlaidAccessToken(
  accessToken: string,
  context: string,
  secret = process.env.PLAID_TOKEN_ENCRYPTION_KEY
): string {
  const key = readEncryptionKey(secret);
  if (!key) throw new Error("Plaid token encryption is not configured.");

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(accessToken, "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedTokenEnvelope = {
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: encrypted.toString("base64url"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

export function decryptPlaidAccessToken(
  encryptedValue: string,
  context: string,
  secret = process.env.PLAID_TOKEN_ENCRYPTION_KEY
): string {
  const key = readEncryptionKey(secret);
  if (!key) throw new Error("Plaid token encryption is not configured.");

  try {
    const envelope = JSON.parse(
      Buffer.from(encryptedValue, "base64url").toString("utf8")
    ) as EncryptedTokenEnvelope;
    if (
      envelope.version !== 1 ||
      !envelope.iv ||
      !envelope.tag ||
      !envelope.ciphertext
    ) {
      throw new Error("Invalid encrypted token.");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64url")
    );
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt the stored Plaid token.");
  }
}

export function getPlaidErrorDetails(error: unknown): {
  code?: string;
  requestId?: string;
} {
  const responseData = (error as {
    response?: { data?: { error_code?: unknown; request_id?: unknown } };
  })?.response?.data;
  return {
    ...(typeof responseData?.error_code === "string"
      ? { code: responseData.error_code }
      : {}),
    ...(typeof responseData?.request_id === "string"
      ? { requestId: responseData.request_id }
      : {}),
  };
}
