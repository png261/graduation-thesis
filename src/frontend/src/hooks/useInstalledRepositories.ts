"use client"

import { useCallback, useEffect, useState } from "react"
import { AgentCoreClient } from "@/lib/agentcore-client"
import type { SelectedRepository } from "@/lib/agentcore-client/types"

type InstalledRepositoriesState = {
  repositories: SelectedRepository[]
  isLoading: boolean
  error: string | null
  reload: () => Promise<void>
}

export function useInstalledRepositories(accessToken?: string | null): InstalledRepositoriesState {
  const [repositories, setRepositories] = useState<SelectedRepository[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!accessToken) {
      setRepositories([])
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch("/aws-exports.json")
      if (!response.ok) throw new Error("Failed to load frontend configuration")
      const config = await response.json()
      if (!config.agentRuntimeArn) throw new Error("Agent Runtime ARN not found in configuration")
      const client = new AgentCoreClient({
        runtimeArn: config.agentRuntimeArn,
        region: config.awsRegion || "us-east-1",
      })
      const result = await client.githubAction(
        "listInstalledRepositories",
        crypto.randomUUID(),
        accessToken,
        null
      )
      setRepositories(((result as any)?.repositories ?? []) as SelectedRepository[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load installed repositories")
    } finally {
      setIsLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void reload()
  }, [reload])

  return { repositories, isLoading, error, reload }
}
