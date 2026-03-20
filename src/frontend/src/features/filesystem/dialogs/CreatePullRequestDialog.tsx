import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";

const GENERATION_SUGGESTION_COPY = "Suggested title/body come from the latest blueprint generation history and remain editable.";

interface CreatePullRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  title: string;
  onTitleChange: (value: string) => void;
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  error: string;
  busy: boolean;
  onSubmit: () => void;
  githubConnected: boolean;
  placeholderBase: string;
  workingBranch: string;
  suggestionCopy: string;
}

function PullRequestFormFields({
  title,
  onTitleChange,
  baseBranch,
  onBaseBranchChange,
  description,
  onDescriptionChange,
  placeholderBase,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  placeholderBase: string;
}) {
  return (
    <div className="space-y-3">
      <PullRequestTitleField title={title} onTitleChange={onTitleChange} />
      <PullRequestBaseBranchField baseBranch={baseBranch} onBaseBranchChange={onBaseBranchChange} placeholderBase={placeholderBase} />
      <PullRequestDescriptionField description={description} onDescriptionChange={onDescriptionChange} />
    </div>
  );
}

function PullRequestTitleField({ title, onTitleChange }: { title: string; onTitleChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="pr-title">Title</Label>
      <Input id="pr-title" value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="chore: export code updates" />
    </div>
  );
}

function PullRequestBaseBranchField({
  baseBranch,
  onBaseBranchChange,
  placeholderBase,
}: {
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
  placeholderBase: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="pr-base">Base branch</Label>
      <Input id="pr-base" value={baseBranch} onChange={(event) => onBaseBranchChange(event.target.value)} placeholder={placeholderBase || "main"} />
    </div>
  );
}

function PullRequestDescriptionField({
  description,
  onDescriptionChange,
}: {
  description: string;
  onDescriptionChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="pr-description">Description</Label>
      <Textarea id="pr-description" className="min-h-28" value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="Optional pull request description" />
    </div>
  );
}

function PullRequestError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
      <AlertTitle>Create pull request failed</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function PullRequestDialogFooter({
  busy,
  loading,
  githubConnected,
  onOpenChange,
  onSubmit,
}: {
  busy: boolean;
  loading: boolean;
  githubConnected: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
      <Button onClick={onSubmit} disabled={busy || loading || !githubConnected}>{busy ? "Creating..." : "Create Pull Request"}</Button>
    </DialogFooter>
  );
}

function PullRequestDraftLoading({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return <p className="text-sm text-[var(--da-muted)]">Loading suggested pull request draft...</p>;
}

function PullRequestContext({
  suggestionCopy,
  workingBranch,
  baseBranch,
  placeholderBase,
}: {
  suggestionCopy: string;
  workingBranch: string;
  baseBranch: string;
  placeholderBase: string;
}) {
  if (!suggestionCopy && !workingBranch) return null;
  return (
    <div className="space-y-1 text-sm text-[var(--da-muted)]">
      <p>{suggestionCopy || GENERATION_SUGGESTION_COPY}</p>
      {workingBranch ? <p>Current workspace changes will be committed from <code>{workingBranch}</code> into <code>{baseBranch || placeholderBase}</code>.</p> : null}
    </div>
  );
}

export function CreatePullRequestDialog(props: CreatePullRequestDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Pull Request</DialogTitle>
          <DialogDescription>Commit current workspace changes and open a pull request.</DialogDescription>
        </DialogHeader>
        <PullRequestDraftLoading loading={props.loading} />
        {!props.loading ? <PullRequestContext suggestionCopy={props.suggestionCopy} workingBranch={props.workingBranch} baseBranch={props.baseBranch} placeholderBase={props.placeholderBase} /> : null}
        {!props.loading ? <PullRequestFormFields title={props.title} onTitleChange={props.onTitleChange} baseBranch={props.baseBranch} onBaseBranchChange={props.onBaseBranchChange} description={props.description} onDescriptionChange={props.onDescriptionChange} placeholderBase={props.placeholderBase} /> : null}
        <PullRequestError error={props.error} />
        <PullRequestDialogFooter busy={props.busy} loading={props.loading} githubConnected={props.githubConnected} onOpenChange={props.onOpenChange} onSubmit={props.onSubmit} />
      </DialogContent>
    </Dialog>
  );
}
