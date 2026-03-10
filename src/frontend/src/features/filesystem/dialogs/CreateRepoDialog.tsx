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
import { Textarea } from "../../../components/ui/textarea";

export function CreateRepoDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  isPrivate,
  onPrivateChange,
  busy,
  error,
  onSubmit,
}: {
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
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create GitHub Repository</DialogTitle>
          <DialogDescription>
            Create a new repository, connect this project, and sync code automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="create-repo-name">Repository name</Label>
            <Input
              id="create-repo-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="my-project"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-repo-description">Description</Label>
            <Textarea
              id="create-repo-description"
              className="min-h-20"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Optional repository description"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--da-text)]">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => onPrivateChange(e.target.checked)}
              className="h-4 w-4"
            />
            Create as private repository
          </label>

          {error && (
            <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
              <AlertTitle>Create repository failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy}>
            {busy ? "Creating..." : "Create Repository"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
