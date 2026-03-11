import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";

interface RepoOption {
  id: number;
  full_name: string;
  default_branch: string;
}

interface ImportRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  busy: boolean;
  error: string;
  session: { authenticated: boolean; login?: string };
  repos: RepoOption[];
  repoName: string;
  onRepoNameChange: (value: string) => void;
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
  onLogin: () => void;
  onSubmit: () => void;
}

function resolveDefaultBranch(repos: RepoOption[], repoName: string) {
  return repos.find((repo) => repo.full_name === repoName)?.default_branch || "main";
}

function handleRepoSelection(
  value: string,
  repos: RepoOption[],
  onRepoNameChange: (value: string) => void,
  onBaseBranchChange: (value: string) => void,
) {
  const next = value === "__none__" ? "" : value;
  onRepoNameChange(next);
  const selected = repos.find((repo) => repo.full_name === next);
  onBaseBranchChange(selected?.default_branch || "");
}

function ImportRepoLoadingState({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return <p className="text-sm text-[var(--da-muted)]">Loading GitHub state...</p>;
}

function ImportRepoAuthPrompt({ onLogin }: { onLogin: () => void }) {
  return <Button type="button" variant="outline" className="w-full" onClick={onLogin}>Login with GitHub</Button>;
}

function ImportRepoForm({
  session,
  repos,
  repoName,
  baseBranch,
  onRepoNameChange,
  onBaseBranchChange,
}: {
  session: { authenticated: boolean; login?: string };
  repos: RepoOption[];
  repoName: string;
  baseBranch: string;
  onRepoNameChange: (value: string) => void;
  onBaseBranchChange: (value: string) => void;
}) {
  return (
    <>
      <ImportRepoSessionLabel login={session.login} />
      <ImportRepoSelector repos={repos} repoName={repoName} onRepoNameChange={onRepoNameChange} onBaseBranchChange={onBaseBranchChange} />
      <ImportRepoBaseBranchInput repos={repos} repoName={repoName} baseBranch={baseBranch} onBaseBranchChange={onBaseBranchChange} />
    </>
  );
}

function ImportRepoSessionLabel({ login }: { login?: string }) {
  return <p className="text-xs text-[var(--da-muted)]">Signed in as <strong className="text-[var(--da-text)]">{login}</strong></p>;
}

function ImportRepoSelector({
  repos,
  repoName,
  onRepoNameChange,
  onBaseBranchChange,
}: {
  repos: RepoOption[];
  repoName: string;
  onRepoNameChange: (value: string) => void;
  onBaseBranchChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Repository</Label>
      <Select value={repoName || "__none__"} onValueChange={(value) => handleRepoSelection(value, repos, onRepoNameChange, onBaseBranchChange)}>
        <SelectTrigger>
          <SelectValue placeholder="Select repository" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Select repository...</SelectItem>
          {repos.map((repo) => <SelectItem key={repo.id} value={repo.full_name}>{repo.full_name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ImportRepoBaseBranchInput({
  repos,
  repoName,
  baseBranch,
  onBaseBranchChange,
}: {
  repos: RepoOption[];
  repoName: string;
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
}) {
  const defaultBranch = resolveDefaultBranch(repos, repoName);
  return (
    <div className="space-y-2">
      <Label>Base branch</Label>
      <Input value={baseBranch} onChange={(event) => onBaseBranchChange(event.target.value)} placeholder={defaultBranch} />
    </div>
  );
}

function ImportRepoDialogBody(props: ImportRepoDialogProps) {
  return (
    <div className="space-y-3">
      <ImportRepoLoadingState loading={props.loading} />
      {!props.loading && !props.session.authenticated ? <ImportRepoAuthPrompt onLogin={props.onLogin} /> : null}
      {!props.loading && props.session.authenticated ? <ImportRepoForm session={props.session} repos={props.repos} repoName={props.repoName} baseBranch={props.baseBranch} onRepoNameChange={props.onRepoNameChange} onBaseBranchChange={props.onBaseBranchChange} /> : null}
      {props.error ? <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
        <AlertTitle>Import failed</AlertTitle>
        <AlertDescription>{props.error}</AlertDescription>
      </Alert> : null}
    </div>
  );
}

function ImportRepoDialogFooter({
  busy,
  loading,
  authenticated,
  repoName,
  onOpenChange,
  onSubmit,
}: {
  busy: boolean;
  loading: boolean;
  authenticated: boolean;
  repoName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
      <Button onClick={onSubmit} disabled={busy || loading || !authenticated || !repoName}>{busy ? "Importing..." : "Import Repository"}</Button>
    </DialogFooter>
  );
}

export function ImportRepoDialog(props: ImportRepoDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import from GitHub</DialogTitle>
          <DialogDescription>Connect this project to a repository and import files into the empty workspace.</DialogDescription>
        </DialogHeader>
        <ImportRepoDialogBody {...props} />
        <ImportRepoDialogFooter busy={props.busy} loading={props.loading} authenticated={props.session.authenticated} repoName={props.repoName} onOpenChange={props.onOpenChange} onSubmit={props.onSubmit} />
      </DialogContent>
    </Dialog>
  );
}
