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

    it("should require GitHub setup when creating chat sessions", () => {
      const chatInterfaceContent = readFileSync(
        resolve(__dirname, "../components/chat/ChatInterface.tsx"),
        "utf-8"
      )
      expect(chatInterfaceContent).toContain("agentcore:chatSessions")
      expect(chatInterfaceContent).toContain("Set Up Chat Session")
      expect(chatInterfaceContent).toContain("Installed repository")
      expect(chatInterfaceContent).toContain("listInstalledRepositories")
      expect(chatInterfaceContent).toContain("pendingSessionId")
      expect(chatInterfaceContent).toContain("Clone Repository and Start")
      expect(chatInterfaceContent).toContain("No repository connected")
      expect(chatInterfaceContent).toContain("Connect a GitHub Repository")
      expect(chatInterfaceContent).toContain("!repository ?")
      expect(chatInterfaceContent).not.toContain("Create New Repo")
      expect(chatInterfaceContent).not.toContain("createRepositorySelection")
      expect(chatInterfaceContent).not.toContain("Create Repository and Start")
    })
  })

  describe("FileSystemPanel Component", () => {
    it("should subscribe to AppSync file events", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      const fileEventsServiceContent = readFileSync(
        resolve(__dirname, "../services/fileEventsService.ts"),
        "utf-8"
      )
      expect(filePanelContent).toContain("subscribeToFileEvents")
      expect(fileEventsServiceContent).toContain("onFileEvent")
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
      expect(filePanelContent).toContain("getFileContent")
      expect(fileEventsServiceContent).toContain("query GetFileContent")
    })

    it("should poll listFiles so delayed S3 Files sync appears in the UI", () => {
      const filePanelContent = readFileSync(
        resolve(__dirname, "../components/files/FileSystemPanel.tsx"),
        "utf-8"
      )
      expect(filePanelContent).toContain("FILE_REFRESH_INTERVAL_MS")
      expect(filePanelContent).toContain("window.setInterval")
      expect(filePanelContent).toContain("listFileEntries")
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
      expect(filePanelContent).toContain("shared/workspace/sessions")
      expect(filePanelContent).toContain("shared/workspace/workspace/sessions")
      expect(filePanelContent).toContain("repos/${repository.owner}/${repository.name}")
      expect(filePanelContent).toContain("Set up a GitHub repository to browse files")
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

    it("should import ChatPage component", () => {
      const routesContent = readFileSync(resolve(__dirname, "../routes/index.tsx"), "utf-8")
      expect(routesContent).toMatch(/ChatPage.*import\(["']\.\/ChatPage["']\)/)
    })
  })
})
