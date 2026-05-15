import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppSidebar } from "@/components/layout/AppSidebar"
import ResourceCatalogPage from "@/routes/ResourceCatalogPage"
import PullRequestsPage from "@/routes/PullRequestsPage"
import AppRoutes from "@/routes"

const authState = vi.hoisted(() => ({
  isAuthenticated: true,
  user: {
    access_token: "dev-access-token",
    id_token: "dev-id-token",
    profile: {
      email: "dev@gmail.com",
      sub: "dev-user",
    },
  },
  signIn: vi.fn(),
  signOut: vi.fn(),
  isLoading: false,
  error: null,
  token: "dev-id-token",
}))

const storeActions = vi.hoisted(() => ({
  requestNewChat: vi.fn(),
  requestRepositoryChat: vi.fn(),
  setActiveSessionId: vi.fn(),
  deleteChatSession: vi.fn(),
  hydrateChatSessions: vi.fn(async () => ({ sessions: [], activeSessionId: "" })),
  hydrateUserConfig: vi.fn(async () => undefined),
  persistSelectedRepository: vi.fn(async () => undefined),
  loadPullRequests: vi.fn(),
}))

const resourceMocks = vi.hoisted(() => ({
  listStateBackends: vi.fn(),
  listStateBackendResources: vi.fn(),
  listResourceScans: vi.fn(),
  listDriftGuards: vi.fn(),
  listAwsCredentials: vi.fn(),
  createStateBackend: vi.fn(),
  listS3Buckets: vi.fn(),
  getStateBackendGraphUrl: vi.fn(),
  saveDriftGuard: vi.fn(),
  runDriftGuard: vi.fn(),
}))

const installedRepositories = vi.hoisted(() => ({
  repositories: [
    {
      owner: "png261",
      name: "hcp-terraform",
      fullName: "png261/hcp-terraform",
      defaultBranch: "main",
    },
  ],
  isLoading: false,
  error: null,
}))

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}))

vi.mock("@/components/chat/ChatInterface", () => ({
  default: () => <div data-testid="chat-interface">Chat Interface</div>,
}))

vi.mock("@/stores/webAppStore", () => {
  const getState = () => ({
      sessions: [
        {
          id: "session-1",
          name: "Dev chat",
          history: [],
          startDate: "2026-05-15T01:00:00.000Z",
          endDate: "2026-05-15T01:00:00.000Z",
          repository: null,
          pullRequest: null,
        },
        {
          id: "session-pr-42",
          name: "Fix drift",
          history: [],
          startDate: "2026-05-15T01:20:00.000Z",
          endDate: "2026-05-15T01:25:00.000Z",
          repository: {
            owner: "png261",
            name: "hcp-terraform",
            fullName: "png261/hcp-terraform",
            defaultBranch: "main",
          },
          pullRequest: {
            number: 42,
            url: "https://github.com/png261/hcp-terraform/pull/42",
          },
        },
      ],
      activeSessionId: "session-1",
      selectedRepository: {
        owner: "png261",
        name: "hcp-terraform",
        fullName: "png261/hcp-terraform",
        defaultBranch: "main",
      },
      pullRequestsByKey: {},
      ...storeActions,
    })
  const useWebAppStore = ((selector: (state: Record<string, unknown>) => unknown) =>
    selector(getState())) as any
  useWebAppStore.getState = getState
  return { useWebAppStore }
})

vi.mock("@/hooks/useInstalledRepositories", () => ({
  useInstalledRepositories: () => installedRepositories,
}))

vi.mock("@/components/github/InstalledRepositoryCombobox", () => ({
  InstalledRepositoryCombobox: ({
    repositories,
    value,
    onValueChange,
  }: {
    repositories: Array<{ fullName: string }>
    value: string
    onValueChange: (value: string) => void
  }) => (
    <select
      aria-label="GitHub Repository"
      value={value}
      onChange={event => onValueChange(event.target.value)}
    >
      {repositories.map(repository => (
        <option key={repository.fullName} value={repository.fullName}>
          {repository.fullName}
        </option>
      ))}
    </select>
  ),
}))

vi.mock("@/services/resourcesService", async importOriginal => {
  const actual = await importOriginal<typeof import("@/services/resourcesService")>()
  return {
    ...actual,
    listStateBackends: resourceMocks.listStateBackends,
    listStateBackendResources: resourceMocks.listStateBackendResources,
    listResourceScans: resourceMocks.listResourceScans,
    listDriftGuards: resourceMocks.listDriftGuards,
    listAwsCredentials: resourceMocks.listAwsCredentials,
    createStateBackend: resourceMocks.createStateBackend,
    listS3Buckets: resourceMocks.listS3Buckets,
    getStateBackendGraphUrl: resourceMocks.getStateBackendGraphUrl,
    saveDriftGuard: resourceMocks.saveDriftGuard,
    runDriftGuard: resourceMocks.runDriftGuard,
  }
})

const repository = {
  owner: "png261",
  name: "hcp-terraform",
  fullName: "png261/hcp-terraform",
  defaultBranch: "main",
}

const backend = {
  backendId: "backend-prod",
  name: "Production state",
  bucket: "tf-prod-state",
  key: "env/prod/terraform.tfstate",
  region: "ap-southeast-1",
  service: "s3",
  credentialId: "cred-1",
  credentialName: "Dev AWS",
  repository,
  graphBucket: "graphs",
  graphKey: "backend-prod.png",
  graphGeneratedAt: "2026-05-15T01:00:00.000Z",
  graphResourceCount: 2,
  createdAt: "2026-05-15T01:00:00.000Z",
  updatedAt: "2026-05-15T01:00:00.000Z",
}

const scan = {
  scanId: "scan-prod",
  backendId: "backend-prod",
  backendName: "Production state",
  stateBucket: "tf-prod-state",
  stateKey: "env/prod/terraform.tfstate",
  stateRegion: "ap-southeast-1",
  service: "s3",
  status: "SUCCEEDED",
  startedAt: "2026-05-15T01:05:00.000Z",
  updatedAt: "2026-05-15T01:06:00.000Z",
  driftAlerts: [
    {
      resource_address: "aws_s3_bucket.logs",
      resource_name: "prod-logs",
      severity: "high",
      message: "Bucket tags drifted",
    },
  ],
  policyAlerts: [
    {
      resource_address: "aws_s3_bucket.logs",
      policy_name: "S3 encryption required",
      severity: "critical",
      message: "Default encryption is missing",
    },
  ],
  currentResources: [
    {
      address: "aws_s3_bucket.logs",
      type: "aws_s3_bucket",
      change: {
        after: {
          bucket: "prod-logs",
          arn: "arn:aws:s3:::prod-logs",
        },
      },
    },
  ],
  repository,
}

const stateResources = [
  {
    backendId: "backend-prod",
    backendName: "Production state",
    stateBucket: "tf-prod-state",
    stateKey: "env/prod/terraform.tfstate",
    stateRegion: "ap-southeast-1",
    service: "s3",
    repository,
    address: "aws_s3_bucket.logs",
    type: "aws_s3_bucket",
    name: "logs",
    values: {
      bucket: "prod-logs",
      arn: "arn:aws:s3:::prod-logs",
    },
    updatedAt: "2026-05-15T01:00:00.000Z",
  },
  {
    backendId: "backend-prod",
    backendName: "Production state",
    stateBucket: "tf-prod-state",
    stateKey: "env/prod/terraform.tfstate",
    stateRegion: "ap-southeast-1",
    service: "s3",
    repository,
    address: "aws_instance.app",
    type: "aws_instance",
    name: "app",
    values: {
      id: "i-0123456789abcdef0",
      tags: { Name: "app-server" },
    },
    updatedAt: "2026-05-15T01:00:00.000Z",
  },
]

function renderWithRouter(ui: React.ReactElement, initialEntries = ["/"]) {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>)
}

describe("authenticated app functional coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resourceMocks.listStateBackends.mockResolvedValue([backend])
    resourceMocks.listStateBackendResources.mockImplementation((backendId: string) =>
      Promise.resolve(backendId === "backend-prod" ? stateResources : [])
    )
    resourceMocks.listResourceScans.mockResolvedValue([scan])
    resourceMocks.listDriftGuards.mockResolvedValue([
      {
        guardId: "guard-prod",
        name: "Autoscan - Production state",
        backendId: "backend-prod",
        repository: "png261/hcp-terraform",
        frequency: "manual",
        email: "dev@gmail.com",
        enabled: true,
        lastScanId: "scan-prod",
        lastRunAt: "2026-05-15T01:05:00.000Z",
        createdAt: "2026-05-15T01:00:00.000Z",
        updatedAt: "2026-05-15T01:06:00.000Z",
      },
    ])
    resourceMocks.listAwsCredentials.mockResolvedValue({
      activeCredentialId: "cred-1",
      credentials: [
        {
          configured: true,
          credentialId: "cred-1",
          name: "Dev AWS",
          accountId: "123456789012",
          region: "ap-southeast-1",
        },
      ],
    })
    resourceMocks.createStateBackend.mockResolvedValue({
      ...backend,
      backendId: "backend-new",
      name: "New production state",
      bucket: "tf-new-state",
      key: "env/new/terraform.tfstate",
    })
    resourceMocks.listS3Buckets.mockResolvedValue([
      { name: "tf-new-state", createdAt: "2026-05-14T01:00:00.000Z" },
    ])
    resourceMocks.getStateBackendGraphUrl.mockResolvedValue({
      url: "https://example.com/graph.png",
      expiresIn: 300,
    })
    resourceMocks.saveDriftGuard.mockResolvedValue({
      guardId: "guard-prod",
      name: "Autoscan - Production state",
      backendId: "backend-prod",
      repository: "png261/hcp-terraform",
      frequency: "manual",
      email: "dev@gmail.com",
      enabled: true,
      createdAt: "2026-05-15T01:00:00.000Z",
      updatedAt: "2026-05-15T01:06:00.000Z",
    })
    resourceMocks.runDriftGuard.mockResolvedValue({
      scan: {
        ...scan,
        scanId: "scan-autoscan",
        startedAt: "2026-05-15T01:10:00.000Z",
        updatedAt: "2026-05-15T01:11:00.000Z",
      },
    })
    storeActions.loadPullRequests.mockResolvedValue([
      {
        repository: "png261/hcp-terraform",
        number: 42,
        title: "Fix Terraform drift",
        state: "open",
        url: "https://github.com/png261/hcp-terraform/pull/42",
        author: "dev",
        headBranch: "fix/drift",
        baseBranch: "main",
        checkStatus: "success",
        createdAt: "2026-05-15T01:20:00.000Z",
        githubUpdatedAt: "2026-05-15T01:25:00.000Z",
        labels: ["cloudrift"],
        comments: 2,
        reactions: { total: 3 },
        changedFiles: 1,
        additions: 12,
        deletions: 4,
      },
      {
        repository: "png261/hcp-terraform",
        number: 41,
        title: "Old closed change",
        state: "closed",
        url: "https://github.com/png261/hcp-terraform/pull/41",
        author: "dev",
        headBranch: "old/change",
        baseBranch: "main",
        checkConclusion: "failure",
        createdAt: "2026-05-14T01:20:00.000Z",
        closedAt: "2026-05-14T02:20:00.000Z",
        changedFiles: 2,
        additions: 3,
        deletions: 8,
      },
    ])
  })

  it("renders a logged-in dev account, chat route, and authenticated navigation", async () => {
    renderWithRouter(
      <div className="lg:flex">
        <AppSidebar />
        <AppRoutes />
      </div>
    )

    expect(await screen.findByTestId("chat-interface")).toBeInTheDocument()
    expect(screen.getByText("dev@gmail.com")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Resource Catalog/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Pull Requests/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Settings/i })).toBeInTheDocument()
    expect(screen.queryByText(/Please sign in/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("link", { name: /Resource Catalog/i }))

    expect(await screen.findByRole("heading", { name: "Resource Catalog" })).toBeInTheDocument()
    expect(resourceMocks.listStateBackends).toHaveBeenCalledWith("dev-id-token")
  })

  it("covers resource catalog browsing, filtering, add backend, graph, autoscan, alerts, and fix-chat handoff", async () => {
    renderWithRouter(<ResourceCatalogPage />, ["/resource-catalog"])

    expect(await screen.findByRole("heading", { name: "Resource Catalog" })).toBeInTheDocument()
    expect(screen.getByText("Connected Resources")).toBeInTheDocument()
    expect(await screen.findByText("prod-logs")).toBeInTheDocument()
    expect(screen.getByText("aws_s3_bucket.logs")).toBeInTheDocument()
    expect(screen.getByText("app-server")).toBeInTheDocument()
    expect(resourceMocks.listStateBackendResources).toHaveBeenCalledWith("backend-prod", "dev-id-token")
    expect(screen.getByText("drifted")).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("Search resources..."), {
      target: { value: "no-match" },
    })
    expect(screen.getByText("No resources match that search.")).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText("Search resources..."), {
      target: { value: "prod-logs" },
    })
    expect(screen.getByText("prod-logs")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Fix error/i }))
    expect(storeActions.requestRepositoryChat).toHaveBeenCalledWith(
      repository,
      expect.stringContaining("State backend: s3://tf-prod-state/env/prod/terraform.tfstate")
    )

    fireEvent.click(screen.getByRole("button", { name: "Visualize" }))
    expect(screen.getByText("Resource Graph Viewer")).toBeInTheDocument()
    expect(screen.getByText("Select a ready backend to view its resource graph here.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /View graph/i }))
    await waitFor(() => expect(resourceMocks.getStateBackendGraphUrl).toHaveBeenCalledWith("backend-prod", "dev-id-token"))
    expect(screen.getByTitle("Resource graph for Production state")).toHaveAttribute("src", "https://example.com/graph.png")

    fireEvent.click(screen.getByRole("button", { name: "State History" }))
    expect(screen.getByText("s3://tf-prod-state/env/prod/terraform.tfstate")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Autoscan" }))
    expect(screen.getByText("Autoscan History")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Run Autoscan/i }))
    await waitFor(() => expect(resourceMocks.saveDriftGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        backendId: "backend-prod",
        email: "dev@gmail.com",
        repository: "png261/hcp-terraform",
      }),
      "dev-id-token"
    ))
    expect(resourceMocks.runDriftGuard).toHaveBeenCalledWith("guard-prod", "dev-id-token")

    fireEvent.click(screen.getByRole("button", { name: "Drift Alert" }))
    expect(screen.getByText("prod-logs")).toBeInTheDocument()
    expect(screen.getByText("aws_s3_bucket.logs")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Policy Alert" }))
    expect(screen.getByText("S3 encryption required")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Scan History" }))
    expect(screen.getByText("scan-prod")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Add State Backend/i }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "New production state" },
    })
    fireEvent.change(within(dialog).getByLabelText("State key"), {
      target: { value: "env/new/terraform.tfstate" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: /Browse buckets/i }))
    expect(await within(dialog).findByText("tf-new-state")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByText("tf-new-state"))
    fireEvent.click(within(dialog).getByRole("button", { name: /^Add State Backend$/i }))

    await waitFor(() => expect(resourceMocks.createStateBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New production state",
        bucket: "tf-new-state",
        key: "env/new/terraform.tfstate",
        credentialId: "cred-1",
        repository,
      }),
      "dev-id-token"
    ))
    expect(await screen.findByText("State backend added and resource graph generated")).toBeInTheDocument()
  })

  it("covers pull request summaries, filtering, external links, and chat handoff", async () => {
    renderWithRouter(<PullRequestsPage />, ["/pull-requests"])

    expect(await screen.findByRole("heading", { name: "Pull Requests" })).toBeInTheDocument()
    await waitFor(() =>
      expect(storeActions.loadPullRequests).toHaveBeenCalledWith(
        "png261/hcp-terraform",
        "all",
        "dev-id-token",
        { force: false }
      )
    )
    expect(screen.getByText("#42 Fix Terraform drift")).toBeInTheDocument()
    expect(screen.getByText("#41 Old closed change")).toBeInTheDocument()
    expect(screen.getByText("2 of 2 pull requests")).toBeInTheDocument()
    expect(screen.getByText("3 reactions")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("State"), { target: { value: "open" } })
    expect(screen.getByText("#42 Fix Terraform drift")).toBeInTheDocument()
    expect(screen.queryByText("#41 Old closed change")).not.toBeInTheDocument()
    expect(screen.getByText("1 of 2 pull requests")).toBeInTheDocument()

    expect(screen.getByRole("link", { name: /View PR/i })).toHaveAttribute(
      "href",
      "https://github.com/png261/hcp-terraform/pull/42"
    )
    fireEvent.click(screen.getByRole("button", { name: /View chat/i }))
    expect(storeActions.setActiveSessionId).toHaveBeenCalledWith("session-pr-42")

    await waitFor(() => expect(screen.getByRole("button", { name: /Reload/i })).toBeEnabled())
  })
})
