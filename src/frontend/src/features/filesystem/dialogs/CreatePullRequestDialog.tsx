import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";

interface CreatePullRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  githubConnected,
  onOpenChange,
  onSubmit,
}: {
  busy: boolean;
  githubConnected: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
      <Button onClick={onSubmit} disabled={busy || !githubConnected}>{busy ? "Creating..." : "Create Pull Request"}</Button>
    </DialogFooter>
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
        <PullRequestFormFields title={props.title} onTitleChange={props.onTitleChange} baseBranch={props.baseBranch} onBaseBranchChange={props.onBaseBranchChange} description={props.description} onDescriptionChange={props.onDescriptionChange} placeholderBase={props.placeholderBase} />
        <PullRequestError error={props.error} />
        <PullRequestDialogFooter busy={props.busy} githubConnected={props.githubConnected} onOpenChange={props.onOpenChange} onSubmit={props.onSubmit} />
      </DialogContent>
    </Dialog>
  );
}
