import { useCallback, useState } from "react";

import { createProjectPullRequest } from "../../api/projects/index";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";

interface PullRequestModalProps {
  projectId: string;
  defaultBaseBranch: string;
  workingBranch: string;
  onClose: () => void;
  onCreated: (url: string) => void;
}

function usePullRequestFormState(defaultBaseBranch: string) {
  const [title, setTitle] = useState("chore: update infrastructure");
  const [description, setDescription] = useState("");
  const [baseBranch, setBaseBranch] = useState(defaultBaseBranch);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  return {
    title, setTitle, description, setDescription, baseBranch, setBaseBranch, submitting, setSubmitting, error, setError,
  };
}

function validatePullRequestTitle(title: string) {
  return title.trim().length > 0;
}

function useSubmitPullRequest(args: {
  projectId: string;
  onClose: () => void;
  onCreated: (url: string) => void;
  title: string;
  description: string;
  baseBranch: string;
  setSubmitting: (value: boolean) => void;
  setError: (value: string) => void;
}) {
  return useCallback(async () => {
    if (!validatePullRequestTitle(args.title)) {
      args.setError("Pull request title is required.");
      return;
    }
    args.setSubmitting(true);
    args.setError("");
    try {
      const data = await createProjectPullRequest(args.projectId, args.title.trim(), args.description, args.baseBranch.trim());
      if (data.url) args.onCreated(data.url);
      args.onClose();
    } catch (error: unknown) {
      args.setError(error instanceof Error ? error.message : "Failed to create pull request");
    } finally {
      args.setSubmitting(false);
    }
  }, [args]);
}

function PullRequestDialogHeader({ workingBranch, baseBranch, defaultBaseBranch }: { workingBranch: string; baseBranch: string; defaultBaseBranch: string }) {
  return (
    <DialogHeader>
      <DialogTitle>Create Pull Request</DialogTitle>
      <DialogDescription>
        Working branch <code>{workingBranch}</code> into base <code>{baseBranch || defaultBaseBranch}</code>
      </DialogDescription>
    </DialogHeader>
  );
}

function PullRequestFields({
  title,
  description,
  baseBranch,
  setTitle,
  setDescription,
  setBaseBranch,
}: {
  title: string;
  description: string;
  baseBranch: string;
  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  setBaseBranch: (value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Pull request title" />
      <Input value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} placeholder="Base branch" />
      <Textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-48" placeholder="Description" />
    </div>
  );
}

function PullRequestError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function PullRequestFooter({ submitting, onClose, onSubmit }: { submitting: boolean; onClose: () => void; onSubmit: () => void }) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
      <Button onClick={onSubmit} disabled={submitting}>{submitting ? "Creating..." : "Create Pull Request"}</Button>
    </DialogFooter>
  );
}

export function PullRequestModal({ projectId, defaultBaseBranch, workingBranch, onClose, onCreated }: PullRequestModalProps) {
  const state = usePullRequestFormState(defaultBaseBranch);
  const submit = useSubmitPullRequest({
    projectId,
    onClose,
    onCreated,
    title: state.title,
    description: state.description,
    baseBranch: state.baseBranch,
    setSubmitting: state.setSubmitting,
    setError: state.setError,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <PullRequestDialogHeader workingBranch={workingBranch} baseBranch={state.baseBranch} defaultBaseBranch={defaultBaseBranch} />
        <PullRequestFields title={state.title} description={state.description} baseBranch={state.baseBranch} setTitle={state.setTitle} setDescription={state.setDescription} setBaseBranch={state.setBaseBranch} />
        <PullRequestError error={state.error} />
        <PullRequestFooter submitting={state.submitting} onClose={onClose} onSubmit={() => void submit()} />
      </DialogContent>
    </Dialog>
  );
}
