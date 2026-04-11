import { type CloudProvider } from "../../api/projects";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

export interface CreateProjectDialogModel {
  createOpen: boolean;
  createName: string;
  setCreateName: (value: string) => void;
  createProvider: CloudProvider;
  setCreateProvider: (value: CloudProvider) => void;
  createSubmitting: boolean;
  createError: string;
  handleCreateDialogOpenChange: (open: boolean) => void;
  handleCreateProject: () => Promise<void>;
}

function CreateProjectNameField({ model }: { model: CreateProjectDialogModel }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="create-name">Project name</Label>
      <Input id="create-name" value={model.createName} onChange={(e) => model.setCreateName(e.target.value)} placeholder="My Project" />
    </div>
  );
}

function CreateProjectProviderField({ model }: { model: CreateProjectDialogModel }) {
  return (
    <div className="space-y-2">
      <Label>Cloud provider</Label>
      <Select value={model.createProvider} onValueChange={(v) => model.setCreateProvider(v as CloudProvider)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="aws">AWS</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function CreateProjectError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Alert className="border-red-500/40 bg-red-500/10 text-red-700">
      <AlertTitle>Create failed</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function CreateProjectFooter({ model }: { model: CreateProjectDialogModel }) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={() => model.handleCreateDialogOpenChange(false)} disabled={model.createSubmitting}>Cancel</Button>
      <Button onClick={model.handleCreateProject} disabled={model.createSubmitting}>{model.createSubmitting ? "Creating..." : "Create"}</Button>
    </DialogFooter>
  );
}

export function CreateProjectDialog({ model }: { model: CreateProjectDialogModel }) {
  return (
    <Dialog open={model.createOpen} onOpenChange={model.handleCreateDialogOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <CreateProjectNameField model={model} />
          <CreateProjectProviderField model={model} />
          <CreateProjectError error={model.createError} />
        </div>
        <CreateProjectFooter model={model} />
      </DialogContent>
    </Dialog>
  );
}
