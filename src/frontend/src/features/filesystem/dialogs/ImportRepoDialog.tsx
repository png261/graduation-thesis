import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";

export function ImportRepoDialog({
  open,
  onOpenChange,
  loading,
  busy,
  error,
  session,
  repos,
  repoName,
  onRepoNameChange,
  baseBranch,
  onBaseBranchChange,
  onLogin,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  busy: boolean;
  error: string;
  session: { authenticated: boolean; login?: string };
  repos: Array<{ id: number; full_name: string; default_branch: string }>;
  repoName: string;
  onRepoNameChange: (value: string) => void;
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
  onLogin: () => void;
  onSubmit: () => void;
}) {
  const defaultBranch = repos.find((repo) => repo.full_name === repoName)?.default_branch || "main";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import from GitHub</DialogTitle>
          <DialogDescription>
            Connect this project to a repository and import files into the empty workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {loading && (
            <p className="text-sm text-[var(--da-muted)]">Loading GitHub state...</p>
          )}

          {!loading && !session.authenticated && (
            <Button type="button" variant="outline" className="w-full" onClick={onLogin}>
              Login with GitHub
            </Button>
          )}

          {!loading && session.authenticated && (
            <>
              <p className="text-xs text-[var(--da-muted)]">
                Signed in as <strong className="text-[var(--da-text)]">{session.login}</strong>
              </p>

              <div className="space-y-2">
                <Label>Repository</Label>
                <Select
                  value={repoName || "__none__"}
                  onValueChange={(value) => {
                    const next = value === "__none__" ? "" : value;
                    onRepoNameChange(next);
                    const selected = repos.find((repo) => repo.full_name === next);
                    onBaseBranchChange(selected?.default_branch || "");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select repository" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select repository...</SelectItem>
                    {repos.map((repo) => (
                      <SelectItem key={repo.id} value={repo.full_name}>
                        {repo.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Base branch</Label>
                <Input
                  value={baseBranch}
                  onChange={(e) => onBaseBranchChange(e.target.value)}
                  placeholder={defaultBranch}
                />
              </div>
            </>
          )}

          {error && (
            <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
              <AlertTitle>Import failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy || loading || !session.authenticated || !repoName}>
            {busy ? "Importing..." : "Import Repository"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
