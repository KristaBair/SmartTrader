// Global user state that any component can read with useUser().
// Keeps track of who's signed in and persists the session across page reloads.

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import {
  UserProfile,
  getCurrentUser,
  setCurrentUserId,
  clearCurrentSession,
  updateUserLastLogin,
} from "@/lib/localStore";

interface UserContextType {
  user: UserProfile | null;
  signIn: (user: UserProfile) => void;
  signOut: () => void;
  isSignedIn: boolean;
}

// Default values are just placeholders. The real ones come from UserProvider below.
const UserContext = createContext<UserContextType>({
  user: null,
  signIn: () => {},
  signOut: () => {},
  isSignedIn: false,
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);

  // When the app first loads, check if there's already a session saved.
  // This is what keeps you signed in after a page refresh.
  useEffect(() => {
    const existing = getCurrentUser();
    if (existing) {
      setUser(existing);
    }
  }, []);

  function signIn(profile: UserProfile) {
    setCurrentUserId(profile.id);   // save to localStorage so reload restores it
    updateUserLastLogin(profile.id); // update the "last login" timestamp on the profile card
    setUser(profile);
  }

  function signOut() {
    clearCurrentSession(); // removes the stored user ID
    setUser(null);         // clears React state, which triggers a redirect to sign-in
  }

  return (
    <UserContext.Provider value={{ user, signIn, signOut, isSignedIn: !!user }}>
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
