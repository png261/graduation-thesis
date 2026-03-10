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

export function CreateProjectDialog({ model }: { model: CreateProjectDialogModel }) {
  return (
    <Dialog open={model.createOpen} onOpenChange={model.handleCreateDialogOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Create an empty project. You can import from GitHub or upload ZIP in File View.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="create-name">Project name</Label>
            <Input id="create-name" value={model.createName} onChange={(e) => model.setCreateName(e.target.value)} placeholder="My Project" />
          </div>
          <div className="space-y-2">
            <Label>Cloud provider</Label>
            <Select value={model.createProvider} onValueChange={(v) => model.setCreateProvider(v as CloudProvider)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aws">AWS</SelectItem>
                <SelectItem value="gcloud">GCP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {model.createError && (
            <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
              <AlertTitle>Create failed</AlertTitle>
              <AlertDescription>{model.createError}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => model.handleCreateDialogOpenChange(false)} disabled={model.createSubmitting}>
            Cancel
          </Button>
          <Button onClick={model.handleCreateProject} disabled={model.createSubmitting}>
            {model.createSubmitting ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
