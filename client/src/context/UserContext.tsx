import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import {
  UserProfile,
  getCurrentUser,
  setCurrentUserId,
  clearCurrentSession,
  updateUserLastLogin,
  getCurrentUserId,
} from "@/lib/localStore";

interface UserContextType {
  user: UserProfile | null;
  signIn: (user: UserProfile) => void;
  signOut: () => void;
  isSignedIn: boolean;
}

const UserContext = createContext<UserContextType>({
  user: null,
  signIn: () => {},
  signOut: () => {},
  isSignedIn: false,
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);

  // Restore session on mount
  useEffect(() => {
    const existing = getCurrentUser();
    if (existing) {
      setUser(existing);
    }
  }, []);

  function signIn(profile: UserProfile) {
    setCurrentUserId(profile.id);
    updateUserLastLogin(profile.id);
    setUser(profile);
  }

  function signOut() {
    clearCurrentSession();
    setUser(null);
  }

  return (
    <UserContext.Provider value={{ user, signIn, signOut, isSignedIn: !!user }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}

// Returns true if the current session is valid
export function useRequireAuth(redirectCallback: () => void) {
  const { isSignedIn } = useUser();
  useEffect(() => {
    if (!isSignedIn) {
      redirectCallback();
    }
  }, [isSignedIn]);
  return isSignedIn;
}
