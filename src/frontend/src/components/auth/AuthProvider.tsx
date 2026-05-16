"use client"

import { PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent } from "react"
import { Amplify } from "aws-amplify"
import {
  confirmSignUp as amplifyConfirmSignUp,
  fetchAuthSession,
  getCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  signUp as amplifySignUp,
} from "aws-amplify/auth"
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createCognitoAuthConfig,
  cognitoAuthConfig,
  regionFromUserPoolId,
  userPoolIdFromAuthority,
  type AwsExportsConfig,
} from "@/lib/auth"

type AuthUser = {
  access_token?: string
  id_token?: string
  profile?: Record<string, unknown>
}

type AuthContextValue = {
  isAuthenticated: boolean
  user: AuthUser | null
  signIn: (input?: { email: string; password: string }) => Promise<void>
  signUp: (input: { email: string; password: string }) => Promise<void>
  confirmSignUp: (input: { email: string; code: string }) => Promise<void>
  signOut: () => Promise<void>
  isLoading: boolean
  error: Error | null
  token?: string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

function decodeJwtPayload(token?: string): Record<string, unknown> {
  if (!token) return {}
  try {
    const payload = token.split(".")[1]
    if (!payload) return {}
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    return JSON.parse(window.atob(padded)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function configureAmplify(config: AwsExportsConfig) {
  const userPoolId = userPoolIdFromAuthority(config.authority)
  const region = regionFromUserPoolId(userPoolId)
  if (!userPoolId || !config.client_id) {
    throw new Error("Cognito user pool configuration is incomplete")
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId: config.client_id,
        loginWith: {
          email: true,
        },
      },
    },
  })

  return { region, userPoolId }
}

async function readAuthUser(): Promise<AuthUser | null> {
  try {
    await getCurrentUser()
    const session = await fetchAuthSession()
    const accessToken = session.tokens?.accessToken?.toString()
    const idToken = session.tokens?.idToken?.toString()
    if (!accessToken || !idToken) return null
    return {
      access_token: accessToken,
      id_token: idToken,
      profile: decodeJwtPayload(idToken),
    }
  } catch {
    return null
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Authentication failed"
}

function AuthScreen({
  onSignIn,
  onSignUp,
  onConfirmSignUp,
  isLoading,
  error,
}: {
  onSignIn: AuthContextValue["signIn"]
  onSignUp: AuthContextValue["signUp"]
  onConfirmSignUp: AuthContextValue["confirmSignUp"]
  isLoading: boolean
  error: Error | null
}) {
  const [mode, setMode] = useState<"signin" | "signup" | "confirm">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const title = mode === "signup" ? "Create account" : mode === "confirm" ? "Confirm account" : "Sign in"
  const submitLabel = mode === "signup" ? "Create account" : mode === "confirm" ? "Confirm account" : "Sign in"
  const detail =
    mode === "signup"
      ? "Use your Cognito account email and a secure password."
      : mode === "confirm"
        ? "Enter the verification code sent to your email."
        : "Use your Cognito account to continue."

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLocalError(null)
    try {
      if (mode === "signup") {
        await onSignUp({ email, password })
        setMode("confirm")
        return
      }
      if (mode === "confirm") {
        await onConfirmSignUp({ email, code })
        setMode("signin")
        setPassword("")
        setCode("")
        return
      }
      await onSignIn({ email, password })
    } catch (err) {
      setLocalError(errorMessage(err))
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-[420px] rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">InfraQ</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
        </div>

        <form className="space-y-4" onSubmit={event => void handleSubmit(event)}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <span className="relative block">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                className="h-10 pl-9"
                required
              />
            </span>
          </label>

          {mode !== "confirm" && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <span className="relative block">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  className="h-10 pl-9 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(current => !current)}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>
          )}

          {mode === "confirm" && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Verification code</span>
              <Input
                value={code}
                onChange={event => setCode(event.target.value)}
                autoComplete="one-time-code"
                className="h-10"
                required
              />
            </label>
          )}

          {(localError || error) && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {localError || error?.message}
            </p>
          )}

          <Button type="submit" className="h-10 w-full" disabled={isLoading}>
            {isLoading ? "Working" : submitLabel}
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-2 text-sm text-slate-600">
          {mode === "signin" ? (
            <>
              <span>Need access?</span>
              <button type="button" className="font-medium text-slate-950 hover:underline" onClick={() => setMode("signup")}>
                Create account
              </button>
            </>
          ) : (
            <>
              <span>Already have an account?</span>
              <button type="button" className="font-medium text-slate-950 hover:underline" onClick={() => setMode("signin")}>
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

const AuthProvider = ({ children }: PropsWithChildren) => {
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadConfig() {
      try {
        const config = await createCognitoAuthConfig().catch(() => cognitoAuthConfig)
        configureAmplify(config)
        const currentUser = await readAuthUser()
        if (cancelled) return
        setUser(currentUser)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(errorMessage(err)))
      } finally {
        if (!cancelled) {
          setIsReady(true)
          setIsLoading(false)
        }
      }
    }

    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (input?: { email: string; password: string }) => {
    if (!input) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await amplifySignIn({ username: input.email.trim(), password: input.password })
      if (result.nextStep.signInStep === "CONFIRM_SIGN_UP") {
        throw new Error("Confirm your account before signing in.")
      }
      const currentUser = await readAuthUser()
      setUser(currentUser)
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error(errorMessage(err))
      setError(nextError)
      throw nextError
    } finally {
      setIsLoading(false)
    }
  }, [])

  const signUp = useCallback(async (input: { email: string; password: string }) => {
    setIsLoading(true)
    setError(null)
    try {
      await amplifySignUp({
        username: input.email.trim(),
        password: input.password,
        options: {
          userAttributes: {
            email: input.email.trim(),
          },
        },
      })
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error(errorMessage(err))
      setError(nextError)
      throw nextError
    } finally {
      setIsLoading(false)
    }
  }, [])

  const confirmSignUp = useCallback(async (input: { email: string; code: string }) => {
    setIsLoading(true)
    setError(null)
    try {
      await amplifyConfirmSignUp({
        username: input.email.trim(),
        confirmationCode: input.code.trim(),
      })
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error(errorMessage(err))
      setError(nextError)
      throw nextError
    } finally {
      setIsLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      await amplifySignOut()
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(user),
      user,
      signIn,
      signUp,
      confirmSignUp,
      signOut,
      isLoading,
      error,
      token: user?.id_token ?? null,
    }),
    [confirmSignUp, error, isLoading, signIn, signOut, signUp, user]
  )

  if (!isReady) {
    return <div className="flex min-h-screen items-center justify-center bg-white text-xl text-slate-700">Loading...</div>
  }

  return (
    <AuthContext.Provider value={value}>
      {user ? children : (
        <AuthScreen
          onSignIn={signIn}
          onSignUp={signUp}
          onConfirmSignUp={confirmSignUp}
          isLoading={isLoading}
          error={error}
        />
      )}
    </AuthContext.Provider>
  )
}

export function useAppAuth() {
  return useContext(AuthContext)
}

export { AuthProvider }
