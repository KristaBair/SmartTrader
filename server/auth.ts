// Amazon Cognito authentication for API routes.
// The browser signs in with Cognito (Amplify Auth) and sends its access token as
// `Authorization: Bearer <token>`. We verify the signature, issuer, client ID, and
// expiry against the user pool's JWKS, then expose the user's `sub` as their ID.

import type { RequestHandler, Response } from "express";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { awsConfig } from "./aws";

const verifier = CognitoJwtVerifier.create({
  userPoolId: awsConfig.userPoolId,
  clientId: awsConfig.userPoolClientId,
  tokenUse: "access",
});

// Fetch the signing keys at startup so the first request isn't slowed down.
verifier.hydrate().catch((error) => console.error("Failed to load Cognito JWKS:", error));

export interface AuthLocals {
  userId: string;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const payload = await verifier.verify(token);
    (res.locals as AuthLocals).userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
  }
};

export function getUserId(res: Response): string {
  return (res.locals as AuthLocals).userId;
}

// Public values the browser needs to configure Amplify Auth. None of these are secrets.
export function getAuthClientConfig() {
  return {
    region: awsConfig.region,
    userPoolId: awsConfig.userPoolId,
    userPoolClientId: awsConfig.userPoolClientId,
  };
}
