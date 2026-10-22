// Global user state that any component can read with useUser().
// The session itself is managed by Amazon Cognito, so it survives page reloads;
// on startup we restore it and load the user's saved data from DynamoDB.

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { signOut as cognitoSignOut } from "aws-amplify/auth";
import { AuthUser, loadCurrentUser } from "@/lib/auth";
import { clearUserDataCache, loadUserData } from "@/lib/userData";

interface UserContextType {
  user: AuthUser | null;
  // True until we know whether a session exists, so the app doesn't flash the sign-in screen.
  isLoading: boolean;
  // Call after a successful Cognito sign-in to load the user and their data.
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
  isSignedIn: boolean;
}

// Default values are just placeholders. The real ones come from UserProvider below.
const UserContext = createContext<UserContextType>({
  user: null,
  isLoading: true,
  refreshUser: async () => {},
  signOut: async () => {},
  isSignedIn: false,
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function refreshUser() {
    const current = await loadCurrentUser();
    if (current) {
      await loadUserData();
    } else {
      clearUserDataCache();
    }
    setUser(current);
  }

  // When the app first loads, restore any existing Cognito session.
  useEffect(() => {
    refreshUser()
      .catch((error) => console.error("Failed to restore session:", error))
      .finally(() => setIsLoading(false));
  }, []);

  async function signOut() {
    try {
      await cognitoSignOut();
    } finally {
      clearUserDataCache();
      setUser(null); // clears React state, which triggers a redirect to sign-in
    }
  }

  return (
    <UserContext.Provider value={{ user, isLoading, refreshUser, signOut, isSignedIn: !!user }}>
      {children}
    </UserContext.Provider>
  );
}

// Shorthand hook. Import this instead of importing UserContext directly.
export function useUser() {
  return useContext(UserContext);
}

// Redirect helper: call this in any page that requires a signed-in user
export function useRequireAuth(redirectCallback: () => void) {
  const { isSignedIn } = useUser();
  useEffect(() => {
    if (!isSignedIn) {
      redirectCallback();
    }
  }, [isSignedIn]);
  return isSignedIn;
}
