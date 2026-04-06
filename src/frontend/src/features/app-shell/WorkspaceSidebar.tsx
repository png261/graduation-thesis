import { Database, ListChecks, LogOut, MessageSquareText, Settings, Settings2, UserRound } from "lucide-react";

import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";

interface WorkspaceSidebarProps {
  authenticated: boolean;
  canOpenConfig: boolean;
  accountName?: string;
  accountEmail?: string;
  accountAvatarUrl?: string | null;
  onLogin: () => void;
  onLogout: () => void;
  onOpenUserSettings: () => void;
  workspaceTab: "view" | "jobs" | "state" | "config";
  onChange: (tab: "view" | "jobs" | "state" | "config") => void;
}

function WorkspaceTabActions({
  workspaceTab,
  canOpenConfig,
  onChange,
}: {
  workspaceTab: "view" | "jobs" | "state" | "config";
  canOpenConfig: boolean;
  onChange: (tab: "view" | "jobs" | "state" | "config") => void;
}) {
  return (
    <>
      <Button
        variant={workspaceTab === "view" ? "default" : "ghost"}
        size="icon"
        className="h-10 w-10"
        title="Chat"
        aria-label="Chat"
        onClick={() => onChange("view")}
      >
        <MessageSquareText className="h-4 w-4" />
        <span className="sr-only">Chat</span>
      </Button>
      <Button
        variant={workspaceTab === "jobs" ? "default" : "ghost"}
        size="icon"
        className="h-10 w-10"
        title="Jobs"
        aria-label="Jobs"
        onClick={() => onChange("jobs")}
      >
        <ListChecks className="h-4 w-4" />
        <span className="sr-only">Jobs</span>
      </Button>
      <Button
        variant={workspaceTab === "state" ? "default" : "ghost"}
        size="icon"
        className="h-10 w-10"
        title="State"
        aria-label="State"
        onClick={() => onChange("state")}
      >
        <Database className="h-4 w-4" />
        <span className="sr-only">State</span>
      </Button>
      <Button
        variant={workspaceTab === "config" ? "default" : "ghost"}
        size="icon"
        className="h-10 w-10"
        title={canOpenConfig ? "Config" : "Config unavailable"}
        aria-label="Config"
        disabled={!canOpenConfig}
        onClick={() => onChange("config")}
      >
        <Settings2 className="h-4 w-4" />
        <span className="sr-only">Config</span>
      </Button>
    </>
  );
}

function AccountAvatar({
  accountName,
  accountAvatarUrl,
  className,
}: {
  accountName?: string;
  accountAvatarUrl?: string | null;
  className?: string;
}) {
  if (accountAvatarUrl) {
    return <img src={accountAvatarUrl} alt={accountName || "User avatar"} className={className || "h-8 w-8 rounded-full border border-[var(--da-border)] object-cover"} />;
  }
  return <UserRound className={className || "h-5 w-5"} />;
}

function AccountMenu({
  authenticated,
  accountName,
  accountEmail,
  accountAvatarUrl,
  onLogin,
  onOpenUserSettings,
  onLogout,
}: {
  authenticated: boolean;
  accountName?: string;
  accountEmail?: string;
  accountAvatarUrl?: string | null;
  onLogin: () => void;
  onOpenUserSettings: () => void;
  onLogout: () => void;
}) {
  const label = accountName?.trim() ? `User menu: ${accountName}` : "User menu";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10" title={label} aria-label={label}>
          <AccountAvatar
            accountName={accountName}
            accountAvatarUrl={accountAvatarUrl}
            className={accountAvatarUrl ? "h-8 w-8 rounded-full border border-[var(--da-border)] object-cover" : "h-5 w-5"}
          />
          <span className="sr-only">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-64">
        {authenticated ? (
          <>
            <DropdownMenuLabel className="max-w-full">
              <p className="truncate text-sm font-medium text-[var(--da-text)]">{accountName || "User"}</p>
              <p className="truncate text-xs font-normal text-[var(--da-muted)]">{accountEmail || ""}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenUserSettings}>
              <Settings className="mr-2 h-4 w-4" />
              User Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuLabel>Guest</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogin}>Sign in with Cognito</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  return (
    <aside className="flex h-full max-h-full min-h-0 flex-col items-center gap-1 border-r border-[var(--da-border)] bg-[var(--da-panel)] px-2 py-3">
      <div className="mb-2 flex h-10 w-10 items-center justify-center">
        <img src="/images/logo.png" alt="Project logo" className="h-8 w-8 object-contain" />
      </div>
      <WorkspaceTabActions workspaceTab={props.workspaceTab} canOpenConfig={props.canOpenConfig} onChange={props.onChange} />
      <div className="mt-auto">
        <AccountMenu authenticated={props.authenticated} accountName={props.accountName} accountEmail={props.accountEmail} accountAvatarUrl={props.accountAvatarUrl} onLogin={props.onLogin} onOpenUserSettings={props.onOpenUserSettings} onLogout={props.onLogout} />
      </div>
    </aside>
  );
}
