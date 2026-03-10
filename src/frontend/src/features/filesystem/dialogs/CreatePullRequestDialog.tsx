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

export function CreatePullRequestDialog({
  open,
  onOpenChange,
  title,
  onTitleChange,
  baseBranch,
  onBaseBranchChange,
  description,
  onDescriptionChange,
  error,
  busy,
  onSubmit,
  githubConnected,
  placeholderBase,
}: {
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
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Pull Request</DialogTitle>
          <DialogDescription>
            Commit current workspace changes and open a pull request.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="pr-title">Title</Label>
            <Input
              id="pr-title"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="chore: export code updates"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr-base">Base branch</Label>
            <Input
              id="pr-base"
              value={baseBranch}
              onChange={(e) => onBaseBranchChange(e.target.value)}
              placeholder={placeholderBase || "main"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr-description">Description</Label>
            <Textarea
              id="pr-description"
              className="min-h-28"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Optional pull request description"
            />
          </div>

          {error && (
            <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
              <AlertTitle>Create pull request failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy || !githubConnected}>
            {busy ? "Creating..." : "Create Pull Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
