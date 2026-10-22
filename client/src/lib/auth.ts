// Amazon Cognito sign-in via Amplify Auth.
// The user pool settings come from the server (/api/auth/config) so they are
// configured in one place. Tokens are kept in cookies rather than localStorage.

import { Amplify } from "aws-amplify";
import {
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
} from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { CookieStorage } from "aws-amplify/utils";

export interface AuthUser {
  id: string; // Cognito `sub`
  email: string;
  firstName: string;
  lastName: string;
}

let configured: Promise<void> | null = null;

// Safe to call many times; configuration only happens once.
export function configureAuth(): Promise<void> {
  configured ??= (async () => {
    const res = await fetch("/api/auth/config");
    if (!res.ok) throw new Error("Could not load sign-in configuration");
    const { userPoolId, userPoolClientId } = await res.json();

    Amplify.configure({
      Auth: { Cognito: { userPoolId, userPoolClientId, loginWith: { email: true } } },
    });
    cognitoUserPoolsTokenProvider.setKeyValueStorage(
      new CookieStorage({ sameSite: "strict", secure: window.location.protocol === "https:" })
    );
  })().catch((error) => {
    configured = null; // allow a retry on the next call
    throw error;
  });
  return configured;
}

// Returns the signed-in user, or null when there is no valid session.
export async function loadCurrentUser(): Promise<AuthUser | null> {
  await configureAuth();
  try {
    const { userId } = await getCurrentUser();
    const attributes = await fetchUserAttributes();
    return {
      id: userId,
      email: attributes.email ?? "",
      firstName: attributes.given_name ?? "",
      lastName: attributes.family_name ?? "",
    };
  } catch {
    return null;
  }
}

// Access token for API calls. Amplify refreshes it automatically when it expires.
export async function getAccessToken(): Promise<string | undefined> {
  await configureAuth();
  try {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString();
  } catch {
    return undefined;
  }
}
