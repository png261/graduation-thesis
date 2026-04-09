import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";

interface CreateRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  isPrivate: boolean;
  onPrivateChange: (value: boolean) => void;
  busy: boolean;
  error: string;
  onSubmit: () => void;
}

function CreateRepoFormFields({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  isPrivate,
  onPrivateChange,
}: {
  name: string;
  onNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  isPrivate: boolean;
  onPrivateChange: (value: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <CreateRepoNameField name={name} onNameChange={onNameChange} />
      <CreateRepoDescriptionField description={description} onDescriptionChange={onDescriptionChange} />
      <CreateRepoPrivacyField isPrivate={isPrivate} onPrivateChange={onPrivateChange} />
    </div>
  );
}

function CreateRepoNameField({ name, onNameChange }: { name: string; onNameChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="create-repo-name">Repository name</Label>
      <Input id="create-repo-name" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="my-project" />
    </div>
  );
}

function CreateRepoDescriptionField({
  description,
  onDescriptionChange,
}: {
  description: string;
  onDescriptionChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="create-repo-description">Description</Label>
      <Textarea id="create-repo-description" className="min-h-20" value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="Optional repository description" />
    </div>
  );
}

function CreateRepoPrivacyField({ isPrivate, onPrivateChange }: { isPrivate: boolean; onPrivateChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--da-text)]">
      <input type="checkbox" checked={isPrivate} onChange={(event) => onPrivateChange(event.target.checked)} className="h-4 w-4" />
      Create as private repository
    </label>
  );
}

function CreateRepoError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Alert className="border-red-500/40 bg-red-500/10 text-red-700">
      <AlertTitle>Create repository failed</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function CreateRepoDialogFooter({
  busy,
  onOpenChange,
  onSubmit,
}: {
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
      <Button onClick={onSubmit} disabled={busy}>{busy ? "Creating..." : "Create Repository"}</Button>
    </DialogFooter>
  );
}

export function CreateRepoDialog(props: CreateRepoDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create GitHub Repository</DialogTitle>
          <DialogDescription>Create a new repository, connect this project, and sync code automatically.</DialogDescription>
        </DialogHeader>
        <CreateRepoFormFields name={props.name} onNameChange={props.onNameChange} description={props.description} onDescriptionChange={props.onDescriptionChange} isPrivate={props.isPrivate} onPrivateChange={props.onPrivateChange} />
        <CreateRepoError error={props.error} />
        <CreateRepoDialogFooter busy={props.busy} onOpenChange={props.onOpenChange} onSubmit={props.onSubmit} />
      </DialogContent>
    </Dialog>
  );
}
