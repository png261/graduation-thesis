"use client"

import { Github, KeyRound, Save } from "lucide-react"
import { FormEvent, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/useAuth"
import {
  AwsCredentialMetadata,
  listAwsCredentials,
  saveAwsCredential,
} from "@/services/resourcesService"
import { AgentCoreClient } from "@/lib/agentcore-client"

type AwsExports = {
  githubAppInstallUrl?: string | null
  agentRuntimeArn?: string | null
  awsRegion?: string | null
}

export default function SettingsPage() {
  const auth = useAuth()
  const [installUrl, setInstallUrl] = useState<string | null>(null)
  const [client, setClient] = useState<AgentCoreClient | null>(null)
  const [credentials, setCredentials] = useState<AwsCredentialMetadata[]>([])
  const [activeCredentialId, setActiveCredentialId] = useState("")
  const [isGithubInstalled, setIsGithubInstalled] = useState(false)
  const [credentialForm, setCredentialForm] = useState({
    credentialId: "",
    accessKeyId: "",
    secretAccessKey: "",
  })
  const [isSavingCredential, setIsSavingCredential] = useState(false)
  const [credentialMessage, setCredentialMessage] = useState<string | null>(null)
  const [credentialError, setCredentialError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/aws-exports.json")
      .then(response => (response.ok ? response.json() : Promise.reject(response.statusText)))
      .then((loaded: AwsExports) => {
        if (cancelled) return
        setInstallUrl(loaded.githubAppInstallUrl ?? null)
        if (loaded.agentRuntimeArn) {
          setClient(new AgentCoreClient({
            runtimeArn: loaded.agentRuntimeArn,
            region: loaded.awsRegion || "ap-southeast-1",
          }))
        }
      })
      .catch(() => {
        if (!cancelled) setInstallUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const idToken = auth.user?.id_token
    if (!idToken) return

    let cancelled = false
    listAwsCredentials(idToken)
      .then(loaded => {
        if (cancelled) return
        setCredentials(loaded.credentials)
        const activeId = loaded.activeCredentialId || loaded.credentials[0]?.credentialId || ""
        setActiveCredentialId(activeId)
      })
      .catch(error => {
        if (!cancelled) setCredentialError(error instanceof Error ? error.message : "Load failed")
      })
    return () => {
      cancelled = true
    }
  }, [auth.user?.id_token])

  useEffect(() => {
    const accessToken = auth.user?.access_token
    if (!client || !accessToken) return
    let cancelled = false
    client.githubAction("listInstalledRepositories", crypto.randomUUID(), accessToken, null)
      .then(response => {
        if (cancelled) return
        const repositories = ((response as any)?.repositories ?? []) as unknown[]
        const accounts = ((response as any)?.accounts ?? []) as unknown[]
        setIsGithubInstalled(repositories.length > 0 || accounts.length > 0)
      })
      .catch(() => {
        if (!cancelled) setIsGithubInstalled(false)
      })
    return () => {
      cancelled = true
    }
  }, [auth.user?.access_token, client])

  async function handleSaveCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const idToken = auth.user?.id_token
    if (!idToken) {
      setCredentialError("Sign in before saving AWS credentials")
      return
    }

    setIsSavingCredential(true)
    setCredentialError(null)
    setCredentialMessage(null)
    try {
      const saved = await saveAwsCredential(credentialForm, idToken)
      setCredentials(current => [saved, ...current.filter(item => item.credentialId !== saved.credentialId)])
      setActiveCredentialId(saved.credentialId ?? "")
      setCredentialForm({
        credentialId: "",
        accessKeyId: "",
        secretAccessKey: "",
      })
      setCredentialMessage("AWS credential saved")
    } catch (error) {
      setCredentialError(error instanceof Error ? error.message : "Failed to save credential")
    } finally {
      setIsSavingCredential(false)
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
        <h1 className="text-xl font-semibold text-slate-950">Settings</h1>
      </header>
      <section className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <form className="rounded-lg border border-slate-200 bg-white p-5" onSubmit={handleSaveCredential}>
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-slate-800" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">AWS Credentials</h2>
              <p className="text-sm text-slate-500">
                Store user-scoped AWS access keys and choose one when connecting a backend state.
              </p>
            </div>
          </div>
          {credentials.length > 0 && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <p className="font-medium">Saved credentials</p>
              <div className="mt-2 grid gap-2">
                {credentials.map(item => (
                  <div key={item.credentialId} className="rounded-md border border-emerald-200 bg-white p-2">
                    <p>
                      {item.name || item.accessKeyIdSuffix || "AWS credential"} {item.credentialId === activeCredentialId ? "(active)" : ""}
                    </p>
                    <p>
                      {[item.accountId, item.accessKeyIdSuffix].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Access key ID
              <Input
                value={credentialForm.accessKeyId}
                onChange={event =>
                  setCredentialForm(current => ({ ...current, accessKeyId: event.target.value }))
                }
                placeholder="AKIA..."
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Secret access key
              <Input
                type="password"
                value={credentialForm.secretAccessKey}
                onChange={event =>
                  setCredentialForm(current => ({
                    ...current,
                    secretAccessKey: event.target.value,
                  }))
                }
                placeholder="Secret key"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" disabled={isSavingCredential} className="gap-2">
              <Save className="h-4 w-4" />
              {isSavingCredential ? "Saving" : "Save Credential"}
            </Button>
            {credentialMessage && <p className="text-sm text-emerald-700">{credentialMessage}</p>}
            {credentialError && <p className="text-sm text-red-700">{credentialError}</p>}
          </div>
        </form>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <Github className="h-5 w-5 text-slate-800" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">GitHub App</h2>
              <p className="text-sm text-slate-500">
                Install the GitHub App on repositories that AgentCore can clone and open pull
                requests against.
              </p>
            </div>
          </div>
          <div className="mt-4">
            {isGithubInstalled ? (
              <Button asChild variant="destructive">
                <a href="https://github.com/settings/installations" rel="noreferrer" target="_blank">
                  Uninstall GitHub App
                </a>
              </Button>
            ) : installUrl ? (
              <Button asChild>
                <a href={installUrl} rel="noreferrer" target="_blank">
                  Install GitHub App
                </a>
              </Button>
            ) : (
              <p className="text-sm text-amber-700">
                GitHub App install URL is not configured. Set backend.github.app_slug in
                infra-cdk/config.yaml and redeploy.
              </p>
            )}
          </div>
        </div>

      </section>
    </main>
  )
}
