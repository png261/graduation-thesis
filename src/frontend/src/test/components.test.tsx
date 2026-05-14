import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"

describe("Component Integration Tests", () => {
  describe("App Component Structure", () => {
    it("should import BrowserRouter from react-router-dom", () => {
      const appContent = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8")
      expect(appContent).toMatch(/import \{ BrowserRouter \} from ["']react-router-dom["']/)
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
    it("should use react-oidc-context AuthProvider", () => {
      const authProviderContent = readFileSync(
        resolve(__dirname, "../components/auth/AuthProvider.tsx"),
        "utf-8"
      )
      expect(authProviderContent).toContain(
        'import { AuthProvider as OidcAuthProvider } from "react-oidc-context"'
      )
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
      expect(authProviderContent).toContain("Loading authentication configuration")
    })

    it("should handle auth config loading errors", () => {
      const authProviderContent = readFileSync(
        resolve(__dirname, "../components/auth/AuthProvider.tsx"),
        "utf-8"
      )
      expect(authProviderContent).toContain("Failed to load authentication configuration")
    })

    it("should wrap children with OidcAuthProvider", () => {
      const authProviderContent = readFileSync(
        resolve(__dirname, "../components/auth/AuthProvider.tsx"),
        "utf-8"
      )
      expect(authProviderContent).toContain("<OidcAuthProvider")
      expect(authProviderContent).toContain("</OidcAuthProvider>")
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
      expect(chatInterfaceContent).toContain("Connect Repository")
      expect(chatInterfaceContent).toContain("Installed repository")
      expect(chatInterfaceContent).toContain("listInstalledRepositories")
      expect(chatInterfaceContent).not.toContain("pendingSessionId")
      expect(chatInterfaceContent).not.toContain("Clone Repository and Start")
      expect(chatInterfaceContent).toContain("No repository connected")
      expect(chatInterfaceContent).toContain("Chat works without a repository")
      expect(chatInterfaceContent).not.toContain("Connected to ${repository.fullName}")
      expect(chatInterfaceContent).not.toContain("Create a chat session connected to a GitHub repository before chatting.")
      const storeContent = readFileSync(resolve(__dirname, "../stores/webAppStore.ts"), "utf-8")
      expect(storeContent).toContain("requestNewChat")
      expect(storeContent).toContain("state.sessions.find(isEmptyNewChatSession)")
      expect(storeContent).toContain("existingEmptySession ?? createEmptyChatSession()")
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

    it("should provide a reload filesystem button", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      expect(filePanelContent).toContain('aria-label="Reload filesystem"')
      expect(filePanelContent).toContain("refreshFiles({ showLoading: true })")
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
    })

    it("should support GitHub repository creation and pull request preview", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      const agentClientContent = readFileSync(
        resolve(__dirname, "../lib/agentcore-client/client.ts"),
        "utf-8"
      )
      expect(filePanelContent).toContain("Pull Request Preview")
      expect(filePanelContent).toContain("previewPullRequest")
      expect(filePanelContent).toContain("createPullRequest")
      expect(agentClientContent).toContain("listInstalledRepositories")
      expect(agentClientContent).not.toContain("createRepository")
      expect(agentClientContent).toContain("githubAction")
      expect(agentClientContent).toContain('parsed.status === "error"')
      expect(agentClientContent).toContain("throw new Error")
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
