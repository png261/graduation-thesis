import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import { parseChangedFile } from "../components/files/FileSystemPanel"

describe("Component Integration Tests", () => {
  describe("FileSystemPanel changed-file parsing", () => {
    it("should preserve full filenames for status and plain changed-file entries", () => {
      expect(parseChangedFile("M\tfrontend/src/App.tsx")).toEqual({
        path: "frontend/src/App.tsx",
        status: "modified",
      })
      expect(parseChangedFile("M  frontend/src/App.tsx")).toEqual({
        path: "frontend/src/App.tsx",
        status: "modified",
      })
      expect(parseChangedFile("frontend/src/App.tsx")).toEqual({
        path: "frontend/src/App.tsx",
        status: "modified",
      })
      expect(parseChangedFile("R100\told-name.tf\tnew-name.tf")).toEqual({
        path: "new-name.tf",
        status: "modified",
      })
    })
  })

  describe("App Component Structure", () => {
    it("should import BrowserRouter from react-router-dom", () => {
      const appContent = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8")
      expect(appContent).toMatch(/import \{[^}]*BrowserRouter[^}]*\} from ["']react-router-dom["']/)
    })

    it("should import AuthProvider", () => {
      const appContent = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8")
      expect(appContent).toMatch(/import \{ AuthProvider \} from ["']@\/components\/auth\/AuthProvider["']/)
    })

    it("should wrap routes with BrowserRouter", () => {
      const appContent = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8")
      expect(appContent).toContain("<BrowserRouter>")
      expect(appContent).toContain("</BrowserRouter>")
    })

    it("should wrap routes with AuthProvider", () => {
      const appContent = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8")
      expect(appContent).toContain("<AuthProvider>")
      expect(appContent).toContain("</AuthProvider>")
    })

    it("should render AppRoutes component", () => {
      const appContent = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8")
      expect(appContent).toContain("<AppRoutes />")
    })
  })

  describe("AuthProvider Component", () => {
    it("should use Amplify Auth for custom Cognito authentication", () => {
      const authProviderContent = readFileSync(
        resolve(__dirname, "../components/auth/AuthProvider.tsx"),
        "utf-8"
      )
      expect(authProviderContent).toContain('import { Amplify } from "aws-amplify"')
      expect(authProviderContent).toContain('from "aws-amplify/auth"')
      expect(authProviderContent).toContain("amplifySignIn")
      expect(authProviderContent).toContain("amplifySignUp")
    })

    it("should load auth configuration", () => {
      const authProviderContent = readFileSync(
        resolve(__dirname, "../components/auth/AuthProvider.tsx"),
        "utf-8"
      )
      expect(authProviderContent).toContain("createCognitoAuthConfig")
    })

    it("should show loading state while loading config", () => {
      const authProviderContent = readFileSync(
        resolve(__dirname, "../components/auth/AuthProvider.tsx"),
        "utf-8"
      )
      expect(authProviderContent).toContain("Loading...")
    })

    it("should handle auth config loading errors", () => {
      const authProviderContent = readFileSync(
        resolve(__dirname, "../components/auth/AuthProvider.tsx"),
        "utf-8"
      )
      expect(authProviderContent).toContain("Cognito user pool configuration is incomplete")
    })

    it("should render a custom sign-in and sign-up screen before children", () => {
      const authProviderContent = readFileSync(
        resolve(__dirname, "../components/auth/AuthProvider.tsx"),
        "utf-8"
      )
      expect(authProviderContent).toContain("<AuthScreen")
      expect(authProviderContent).toContain("Create account")
      expect(authProviderContent).toContain("Confirm account")
    })
  })

  describe("ChatPage Component", () => {
    it("should use useAuth hook", () => {
      const chatPageContent = readFileSync(resolve(__dirname, "../routes/ChatPage.tsx"), "utf-8")
      expect(chatPageContent).toContain('import { useAuth } from "@/hooks/useAuth"')
      expect(chatPageContent).toContain("const { isAuthenticated, signIn } = useAuth()")
    })

    it("should render sign-in UI for unauthenticated users", () => {
      const chatPageContent = readFileSync(resolve(__dirname, "../routes/ChatPage.tsx"), "utf-8")
      expect(chatPageContent).toContain("if (!isAuthenticated)")
      expect(chatPageContent).toContain("Please sign in")
      expect(chatPageContent).toContain("Sign In")
    })

    it("should render ChatInterface for authenticated users", () => {
      const chatPageContent = readFileSync(resolve(__dirname, "../routes/ChatPage.tsx"), "utf-8")
      expect(chatPageContent).toContain(
        'import ChatInterface from "@/components/chat/ChatInterface"'
      )
      expect(chatPageContent).toContain("<ChatInterface />")
    })

    it("should wrap authenticated view with GlobalContextProvider", () => {
      const chatPageContent = readFileSync(resolve(__dirname, "../routes/ChatPage.tsx"), "utf-8")
      expect(chatPageContent).toContain(
        'import { GlobalContextProvider } from "@/app/context/GlobalContext"'
      )
      expect(chatPageContent).toContain("<GlobalContextProvider>")
      expect(chatPageContent).toContain("</GlobalContextProvider>")
    })

    it("should allow chat sessions before GitHub setup", () => {
      const chatInterfaceContent = readFileSync(
        resolve(__dirname, "../components/chat/ChatInterface.tsx"),
        "utf-8"
      )
      expect(chatInterfaceContent).toContain("useWebAppStore")
      expect(chatInterfaceContent).toContain("listInstalledRepositories")
      expect(chatInterfaceContent).not.toContain("pendingSessionId")
      expect(chatInterfaceContent).not.toContain("Clone Repository and Start")
      expect(chatInterfaceContent).not.toContain("No repository connected")
      expect(chatInterfaceContent).not.toContain("Chat works without a repository")
      expect(chatInterfaceContent).not.toContain("Connect Repository")
      expect(chatInterfaceContent).not.toContain("Installed repository")
      expect(chatInterfaceContent).not.toContain("Connected to ${repository.fullName}")
      expect(chatInterfaceContent).not.toContain("Create a chat session connected to a GitHub repository before chatting.")
      const storeContent = readFileSync(resolve(__dirname, "../stores/webAppStore.ts"), "utf-8")
      expect(storeContent).toContain("requestNewChat")
      expect(storeContent).toContain("const nextSession = createEmptyChatSession()")
      expect(chatInterfaceContent).not.toContain("Create New Repo")
      expect(chatInterfaceContent).not.toContain("createRepositorySelection")
      expect(chatInterfaceContent).not.toContain("Create Repository and Start")
    })
  })

  describe("FileSystemPanel Component", () => {
    it("should load file entries through the AgentCore runtime filesystem action", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      const fileEventsServiceContent = readFileSync(
        resolve(__dirname, "../services/fileEventsService.ts"),
        "utf-8"
      )
      const agentClientContent = readFileSync(
        resolve(__dirname, "../lib/agentcore-client/client.ts"),
        "utf-8"
      )
      expect(filePanelContent).toContain("filesystemAction(")
      expect(filePanelContent).toContain('"listFiles"')
      expect(fileEventsServiceContent).not.toContain(`subscribe${"To"}FileEvents`)
      expect(agentClientContent).toContain("filesystemAction")
    })

    it("should render the filesystem with React Arborist", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      expect(filePanelContent).toContain('from "react-arborist"')
      expect(filePanelContent).toContain("<Tree")
      expect(filePanelContent).toContain("FileTreeNode")
    })

    it("should preview selected file content with Monaco editor", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      const fileEventsServiceContent = readFileSync(
        resolve(__dirname, "../services/fileEventsService.ts"),
        "utf-8"
      )
      expect(filePanelContent).toContain('from "@monaco-editor/react"')
      expect(filePanelContent).toContain("<Editor")
      expect(filePanelContent).toContain("filesystemAction(")
      expect(filePanelContent).toContain('"getFileContent"')
      expect(fileEventsServiceContent).not.toContain("query GetFileContent")
    })

    it("should poll listFiles so runtime filesystem changes appear in the UI", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      expect(filePanelContent).toContain("FILE_REFRESH_INTERVAL_MS")
      expect(filePanelContent).toContain("window.setInterval")
      expect(filePanelContent).toContain("filesystemAction(")
      expect(filePanelContent).toContain('"listFiles"')
    })

    it("should refresh immediately when chat tool actions change the runtime filesystem", () => {
      const chatInterfaceContent = readFileSync(
        resolve(__dirname, "../components/chat/ChatInterface.tsx"),
        "utf-8"
      )
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      const fileEventsServiceContent = readFileSync(
        resolve(__dirname, "../services/fileEventsService.ts"),
        "utf-8"
      )
      expect(chatInterfaceContent).toContain("notifyFilesystemChanged")
      expect(chatInterfaceContent).toContain("toolCallChangedFilesystem(tc)")
      expect(filePanelContent).toContain("subscribeFilesystemChanges")
      expect(filePanelContent).toContain("FILE_SYNC_DEBOUNCE_MS")
      expect(filePanelContent).toContain("setSelectedKey(nextKey)")
      expect(filePanelContent).toContain("setSelectedDisplayPath(focusPath)")
      expect(filePanelContent).toContain('setFileView("file")')
      expect(fileEventsServiceContent).toContain("subscribeFilesystemChanges")
      expect(fileEventsServiceContent).toContain("clearCachedFileContentForSession")
    })

    it("should provide a reload filesystem button", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      expect(filePanelContent).toContain('aria-label="Reload filesystem"')
      expect(filePanelContent).toContain("refreshFiles({ showLoading: true })")
      expect(filePanelContent).toContain("ml-auto h-7 w-7")
    })

    it("should allow downloading the current workspace source as a ZIP", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      const agentClientContent = readFileSync(
        resolve(__dirname, "../lib/agentcore-client/client.ts"),
        "utf-8"
      )
      expect(filePanelContent).toContain('aria-label="Download source as ZIP"')
      expect(filePanelContent).toContain("downloadSourceZip")
      expect(filePanelContent).toContain("downloadBase64Archive")
      expect(agentClientContent).toContain('"downloadSourceZip"')
    })

    it("should remove the global app header while keeping filesystem status controls out of the file panel", () => {
      const appContent = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8")
      const chatInterfaceContent = readFileSync(resolve(__dirname, "../components/chat/ChatInterface.tsx"), "utf-8")
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      expect(appContent).toContain("<main")
      expect(appContent).not.toContain("<header")
      expect(appContent).not.toContain("infraqLogo")
      expect(appContent).not.toContain("pullRequestUrl")
      expect(appContent).not.toContain("View PR")
      expect(chatInterfaceContent).not.toContain("infraqLogo")
      expect(chatInterfaceContent).not.toContain("onViewPullRequestReady")
      expect(filePanelContent).not.toContain("onViewPullRequestReady")
      expect(filePanelContent).not.toContain("Radio")
      expect(filePanelContent).not.toContain("WifiOff")
      expect(filePanelContent).not.toContain("<span className=\"capitalize\">{status}</span>")
    })

    it("should scope the file tree to the active chat session", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      expect(filePanelContent).toContain("workspacePrefixes")
      expect(filePanelContent).toContain("return []")
      expect(filePanelContent).not.toContain("Set up a GitHub repository to browse files")
      expect(filePanelContent).not.toContain("HardDrive")
      expect(filePanelContent).toContain("No changed files in this chat workspace.")
    })

    it("should expose the filesystem toggle without requiring a repository", () => {
      const chatInterfaceContent = readFileSync(
        resolve(__dirname, "../components/chat/ChatInterface.tsx"),
        "utf-8"
      )
      expect(chatInterfaceContent).toContain("const showFilesystem = isFilesystemOpen")
      expect(chatInterfaceContent).toContain('aria-label={isFilesystemOpen ? "Collapse filesystem" : "Open filesystem"}')
      expect(chatInterfaceContent).toContain("{isFilesystemOpen && (")
      expect(chatInterfaceContent).not.toContain("repository && isFilesystemOpen")
    })

    it("should show scratch workspace files by default when no repository is connected", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      expect(filePanelContent).toContain('if (!repository) setFileScope("all")')
      expect(filePanelContent).toContain("disabled={!repository}")
      expect(filePanelContent).toContain('"downloadSourceZip"')
    })

    it("should support installed GitHub repositories and changed-file status preview", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      const agentClientContent = readFileSync(
        resolve(__dirname, "../lib/agentcore-client/client.ts"),
        "utf-8"
      )
      expect(filePanelContent).toContain("previewPullRequest")
      expect(filePanelContent).not.toContain("Pull Request Preview")
      expect(filePanelContent).not.toContain("createPullRequest")
      expect(agentClientContent).toContain("listInstalledRepositories")
      expect(agentClientContent).not.toContain("createRepository")
      expect(agentClientContent).toContain("githubAction")
      expect(agentClientContent).toContain('parsed.status === "error"')
      expect(agentClientContent).toContain("throw new Error")
    })

    it("should not expose a Terraform graph tab in the filesystem panel", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      expect(filePanelContent).not.toContain("TerraformGraphPreview")
      expect(filePanelContent).not.toContain("refreshTerraformGraph")
      expect(filePanelContent).not.toContain("Run plan")
      expect(filePanelContent).not.toContain(">Graph<")
    })

    it("should offer a scratch architecture starter prompt", () => {
      const chatInterfaceContent = readFileSync(
        resolve(__dirname, "../components/chat/ChatInterface.tsx"),
        "utf-8"
      )
      expect(chatInterfaceContent).toContain("Create architecture")
      expect(chatInterfaceContent).toContain("Create a new cloud architecture from scratch")
      expect(chatInterfaceContent).toContain("source files in this chat workspace")
    })

    it("should open the filesystem wider than chat and keep chat follow-scroll behavior", () => {
      const chatInterfaceContent = readFileSync(
        resolve(__dirname, "../components/chat/ChatInterface.tsx"),
        "utf-8"
      )
      const chatMessagesContent = readFileSync(
        resolve(__dirname, "../components/chat/ChatMessages.tsx"),
        "utf-8"
      )
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      expect(chatInterfaceContent).toContain("minmax(320px,0.8fr) minmax(560px,1.2fr)")
      expect(chatInterfaceContent).not.toContain("0px minmax(560px,1.2fr)")
      expect(chatInterfaceContent).not.toContain("filesystemPanelWidth")
      expect(chatInterfaceContent).not.toContain("handleFilesystemResize")
      expect(chatInterfaceContent).toContain("shouldFollowLatestRef")
      expect(chatInterfaceContent).toContain("window.requestAnimationFrame")
      expect(chatInterfaceContent).not.toContain("absolute bottom-4")
      expect(chatMessagesContent).toContain("[scrollbar-width:none]")
      expect(chatMessagesContent).toContain("[&::-webkit-scrollbar]:hidden")
      expect(chatMessagesContent).not.toContain("pb-36")
      expect(filePanelContent).not.toContain("pb-36")
      expect(filePanelContent).toContain("handleTreeResize")
      expect(filePanelContent).toContain("treePanePercent")
    })

    it("should support collapsed sidebar and unbounded hidden-scrollbar chat list", () => {
      const appContent = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8")
      const sidebarContent = readFileSync(resolve(__dirname, "../components/layout/AppSidebar.tsx"), "utf-8")
      expect(appContent).toContain("isSidebarCollapsed")
      expect(sidebarContent).toContain("onCollapsedChange")
      expect(sidebarContent).not.toContain("max-h-[min(460px,calc(100vh-300px))]")
      expect(sidebarContent).toContain("[scrollbar-width:none]")
      expect(sidebarContent).toContain("[&::-webkit-scrollbar]:hidden")
      expect(sidebarContent).toContain("border-r")
      expect(sidebarContent).not.toContain("border-b")
      expect(sidebarContent).not.toContain("border-t")
      expect(sidebarContent).not.toContain("border-slate-300")
    })

    it("should render a static Cloudrift analytics chart in resource catalog", () => {
      const resourceCatalogContent = readFileSync(resolve(__dirname, "../routes/ResourceCatalogPage.tsx"), "utf-8")
      expect(resourceCatalogContent).toContain("CloudriftAnalyticsChart")
      expect(resourceCatalogContent).toContain("Cloudrift Analysis")
      expect(resourceCatalogContent).toContain("Top Resource Types")
      expect(resourceCatalogContent).toContain("Scan Health")
    })
  })

  describe("Route Configuration", () => {
    it("should define routes using react-router-dom", () => {
      const routesContent = readFileSync(resolve(__dirname, "../routes/index.tsx"), "utf-8")
      expect(routesContent).toMatch(/import \{ Routes, Route \} from ["']react-router-dom["']/)
    })

    it("should have root route pointing to ChatPage", () => {
      const routesContent = readFileSync(resolve(__dirname, "../routes/index.tsx"), "utf-8")
      expect(routesContent).toContain('<Route path="/" element={<ChatPage />} />')
    })

    it("should have settings route for GitHub App install", () => {
      const routesContent = readFileSync(resolve(__dirname, "../routes/index.tsx"), "utf-8")
      const settingsContent = readFileSync(resolve(__dirname, "../routes/SettingsPage.tsx"), "utf-8")
      expect(routesContent).toContain('<Route path="/settings" element={<SettingsPage />} />')
      expect(settingsContent).toContain("Install GitHub App")
      expect(settingsContent).toContain("githubAppInstallUrl")
    })

    it("should keep AWS credential input limited to access key ID and secret access key", () => {
      const settingsContent = readFileSync(resolve(__dirname, "../routes/SettingsPage.tsx"), "utf-8")
      expect(settingsContent).toContain("Access key ID")
      expect(settingsContent).toContain("Secret access key")
      expect(settingsContent).not.toContain("Account ID")
      expect(settingsContent).not.toContain("Session token")
    })

    it("should add state backends through a modal with credential, region, and S3 bucket browse/manual input", () => {
      const catalogContent = readFileSync(resolve(__dirname, "../routes/ResourceCatalogPage.tsx"), "utf-8")
      const serviceContent = readFileSync(resolve(__dirname, "../services/resourcesService.ts"), "utf-8")
      expect(catalogContent).toContain("<Dialog")
      expect(catalogContent).toContain("AWS Credential")
      expect(catalogContent).toContain("Region")
      expect(catalogContent).toContain("Browse buckets")
      expect(catalogContent).toContain("my-terraform-state-bucket")
      expect(catalogContent).toContain("listS3Buckets")
      expect(serviceContent).toContain("/resources/s3-buckets")
    })

    it("should merge Drift Guard into Resource Catalog as an Autoscan tab for added states", () => {
      const catalogContent = readFileSync(resolve(__dirname, "../routes/ResourceCatalogPage.tsx"), "utf-8")
      const sidebarContent = readFileSync(resolve(__dirname, "../components/layout/AppSidebar.tsx"), "utf-8")
      const routesContent = readFileSync(resolve(__dirname, "../routes/index.tsx"), "utf-8")
      expect(catalogContent).toContain('value: "autoscan", label: "Autoscan"')
      expect(catalogContent).toContain("Added State")
      expect(catalogContent).toContain("Run Autoscan")
      expect(catalogContent).toContain("saveDriftGuard")
      expect(catalogContent).toContain("runDriftGuard")
      expect(sidebarContent).not.toContain('label: "Drift Guard"')
      expect(routesContent).toContain('<Route path="/drift-guard" element={<Navigate to="/resource-catalog" replace />} />')
    })

    it("should import ChatPage component", () => {
      const routesContent = readFileSync(resolve(__dirname, "../routes/index.tsx"), "utf-8")
      expect(routesContent).toMatch(/ChatPage.*import\(["']\.\/ChatPage["']\)/)
    })
  })
})
