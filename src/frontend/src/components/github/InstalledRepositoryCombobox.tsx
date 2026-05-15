"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { SelectedRepository } from "@/lib/agentcore-client/types"

type InstalledRepositoryComboboxProps = {
  repositories: SelectedRepository[]
  value: string
  onValueChange: (value: string) => void
  isLoading?: boolean
  disabled?: boolean
  placeholder?: string
}

export function InstalledRepositoryCombobox({
  repositories,
  value,
  onValueChange,
  isLoading = false,
  disabled = false,
  placeholder = "Select repository",
}: InstalledRepositoryComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const selected = repositories.find(repository => repository.fullName === value)
  const filteredRepositories = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return repositories
    return repositories.filter(repository =>
      [repository.fullName, repository.owner, repository.name, repository.defaultBranch]
        .filter(Boolean)
        .some(field => field.toLowerCase().includes(normalized))
    )
  }, [query, repositories])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between rounded-lg"
          disabled={disabled || isLoading}
          aria-expanded={open}
        >
          <span className="truncate">
            {selected?.fullName || (isLoading ? "Loading repositories..." : placeholder)}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-2">
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search repositories..."
              className="pl-8"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
            {filteredRepositories.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {isLoading ? "Loading repositories..." : "No installed repositories found"}
              </p>
            ) : (
              filteredRepositories.map(repository => (
                <button
                  type="button"
                  key={repository.fullName}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-950",
                    repository.fullName === value && "bg-slate-100 text-slate-950"
                  )}
                  onClick={() => {
                    onValueChange(repository.fullName)
                    setOpen(false)
                    setQuery("")
                  }}
                >
                  <Check className={cn("h-4 w-4", repository.fullName === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{repository.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Default branch: {repository.defaultBranch || "main"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
