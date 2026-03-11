import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

function RenameProjectField({ draft, onDraftChange }: { draft: string; onDraftChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="rename-name">Project name</Label>
      <Input id="rename-name" value={draft} onChange={(e) => onDraftChange(e.target.value)} />
    </div>
  );
}

function RenameDialogFooter({ onOpenChange, onSave }: { onOpenChange: (open: boolean) => void; onSave: () => void }) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button onClick={onSave}>Save</Button>
    </DialogFooter>
  );
}

export function RenameProjectDialog({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Project</DialogTitle>
          <DialogDescription>Update the display name for the current project.</DialogDescription>
        </DialogHeader>
        <RenameProjectField draft={draft} onDraftChange={onDraftChange} />
        <RenameDialogFooter onOpenChange={onOpenChange} onSave={onSave} />
      </DialogContent>
    </Dialog>
  );
}
