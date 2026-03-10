import { useState } from "react";

import { createProjectPullRequest } from "../../api/projects/index";
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
import { Textarea } from "../../components/ui/textarea";

export function PullRequestModal({
  projectId,
  defaultBaseBranch,
  workingBranch,
  onClose,
  onCreated,
}: {
  projectId: string;
  defaultBaseBranch: string;
  workingBranch: string;
  onClose: () => void;
  onCreated: (url: string) => void;
}) {
  const [title, setTitle] = useState("chore: update infrastructure");
  const [description, setDescription] = useState("");
  const [baseBranch, setBaseBranch] = useState(defaultBaseBranch);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!title.trim()) {
      setError("Pull request title is required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const data = await createProjectPullRequest(projectId, title.trim(), description, baseBranch.trim());
      if (data.url) onCreated(data.url);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create pull request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Pull Request</DialogTitle>
          <DialogDescription>
            Working branch <code>{workingBranch}</code> into base <code>{baseBranch || defaultBaseBranch}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pull request title" />
          <Input value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} placeholder="Base branch" />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-48" placeholder="Description" />
        </div>

        {error && (
          <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? "Creating..." : "Create Pull Request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
