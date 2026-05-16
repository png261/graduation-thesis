"use client"

import { useAppAuth } from "@/components/auth/AuthProvider"

export function useAuth() {
  const auth = useAppAuth()

  if (!auth) {
    return {
      isAuthenticated: true,
      user: null,
      signIn: async () => {},
      signUp: async () => {},
      confirmSignUp: async () => {},
      signOut: async () => {},
      isLoading: false,
      error: null,
      token: null,
    }
  }

  return auth
}
