import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";

export function useAuth() {
  const [isGuestMode, setIsGuestMode] = useState(false);

  useEffect(() => {
    const guestMode = localStorage.getItem('guestMode') === 'true';
    setIsGuestMode(guestMode);
  }, []);

  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    enabled: !isGuestMode, // Don't try to fetch user if in guest mode
  });

  const guestUser = isGuestMode ? {
    id: 'guest-user',
    email: 'guest@example.com',
    firstName: 'Guest',
    lastName: 'User',
    profileImageUrl: null,
  } : null;

  const isLoading = isGuestMode ? false : userLoading;
  const currentUser = isGuestMode ? guestUser : user;
  const isAuthenticated = !!currentUser;

  return {
    user: currentUser,
    isLoading,
    isAuthenticated,
    isGuestMode,
  };
}