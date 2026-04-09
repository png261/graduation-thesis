import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { createProjectPullRequest, getProjectPullRequestDefaults } from "../../api/projects/index";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import {
  applyPullRequestDefaults,
  buildPullRequestSuggestionCopy,
  createPullRequestDraftState,
  type PullRequestDraftState,
} from "../github/pullRequestDraftState";

const GENERATION_SUGGESTION_COPY = "Suggested title/body come from the latest generation history and remain editable.";

interface PullRequestModalProps {
  projectId: string;
  defaultBaseBranch: string;
  workingBranch: string;
  onClose: () => void;
  onCreated: (url: string) => void;
}

interface PullRequestSubmitPayload {
  title: string;
  description: string;
  baseBranch: string;
  workingBranch: string;
}

export function buildPullRequestFormDefaults(
  draft: PullRequestDraftState,
  defaultBaseBranch: string,
  defaults: {
    title: string;
    description: string;
    base_branch: string;
  } | null,
): PullRequestDraftState {
  if (!defaults) {
    return {
      ...draft,
      baseBranch: draft.baseBranch || defaultBaseBranch,
    };
  }
  return applyPullRequestDefaults(draft, {
    ...defaults,
    working_branch: "",
    repo_full_name: "",
    source: "fallback",
    terraform_generation_id: null,
    ansible_generation_id: null,
  });
}

export function buildPullRequestSubmitPayload(args: {
  title: string;
  description: string;
  baseBranch: string;
  defaultBaseBranch: string;
  workingBranch: string;
}): PullRequestSubmitPayload {
  return {
    title: args.title.trim(),
    description: args.description,
    baseBranch: args.baseBranch.trim() || args.defaultBaseBranch,
    workingBranch: args.workingBranch,
  };
}

function isValidTitle(title: string): boolean {
  return title.trim().length > 0;
}

function usePullRequestModalState(defaultBaseBranch: string) {
  const [draft, setDraft] = useState(() =>
    buildPullRequestFormDefaults(createPullRequestDraftState(), defaultBaseBranch, null),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [suggestionCopy, setSuggestionCopy] = useState(GENERATION_SUGGESTION_COPY);
  return { draft, setDraft, loading, setLoading, error, setError, submitting, setSubmitting, suggestionCopy, setSuggestionCopy };
}

function useLoadPullRequestDefaults(
  projectId: string,
  defaultBaseBranch: string,
  setDraft: Dispatch<SetStateAction<PullRequestDraftState>>,
  setLoading: (value: boolean) => void,
  setError: (value: string) => void,
  setSuggestionCopy: (value: string) => void,
) {
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const defaults = await getProjectPullRequestDefaults(projectId);
        if (cancelled) return;
        setDraft((current) => buildPullRequestFormDefaults(current, defaultBaseBranch, defaults));
        setSuggestionCopy(buildPullRequestSuggestionCopy(defaults.source));
      } catch (error: unknown) {
        if (cancelled) return;
        setDraft((current) => buildPullRequestFormDefaults(current, defaultBaseBranch, null));
        setSuggestionCopy(GENERATION_SUGGESTION_COPY);
        setError(error instanceof Error ? error.message : "Failed to load pull request defaults");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultBaseBranch, projectId, setDraft, setError, setLoading, setSuggestionCopy]);
}

function updateDraftTitle(setDraft: Dispatch<SetStateAction<PullRequestDraftState>>, value: string) {
  setDraft((current) => ({ ...current, title: value, titleEdited: true }));
}

function updateDraftDescription(setDraft: Dispatch<SetStateAction<PullRequestDraftState>>, value: string) {
  setDraft((current) => ({ ...current, description: value, descriptionEdited: true }));
}

function updateDraftBaseBranch(setDraft: Dispatch<SetStateAction<PullRequestDraftState>>, value: string) {
  setDraft((current) => ({ ...current, baseBranch: value, baseBranchEdited: true }));
}

function PullRequestDialogHeader({ workingBranch, baseBranch, defaultBaseBranch }: { workingBranch: string; baseBranch: string; defaultBaseBranch: string }) {
  return (
    <DialogHeader>
      <DialogTitle>Create Pull Request</DialogTitle>
      <DialogDescription>
        Current workspace changes will be committed from <code>{workingBranch}</code> into <code>{baseBranch || defaultBaseBranch}</code>.
      </DialogDescription>
    </DialogHeader>
  );
}

function PullRequestDraftLoading({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return <p className="text-sm text-[var(--da-muted)]">Loading suggested pull request draft...</p>;
}

function PullRequestContext({ suggestionCopy }: { suggestionCopy: string }) {
  return <p className="text-sm text-[var(--da-muted)]">{suggestionCopy}</p>;
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
    <Alert className="border-red-500/40 bg-red-500/10 text-red-700">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function PullRequestFooter({
  submitting,
  loading,
  onClose,
  onSubmit,
}: {
  submitting: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
      <Button onClick={onSubmit} disabled={submitting || loading}>{submitting ? "Creating..." : "Create Pull Request"}</Button>
    </DialogFooter>
  );
}

export function PullRequestModal({ projectId, defaultBaseBranch, workingBranch, onClose, onCreated }: PullRequestModalProps) {
  const state = usePullRequestModalState(defaultBaseBranch);
  useLoadPullRequestDefaults(
    projectId,
    defaultBaseBranch,
    state.setDraft,
    state.setLoading,
    state.setError,
    state.setSuggestionCopy,
  );

  const submit = useCallback(async () => {
    const payload = buildPullRequestSubmitPayload({
      title: state.draft.title,
      description: state.draft.description,
      baseBranch: state.draft.baseBranch,
      defaultBaseBranch,
      workingBranch,
    });
    if (!isValidTitle(payload.title)) {
      state.setError("Pull request title is required.");
      return;
    }
    state.setSubmitting(true);
    state.setError("");
    try {
      const data = await createProjectPullRequest(
        projectId,
        payload.title,
        payload.description,
        payload.baseBranch,
      );
      if (data.url) onCreated(data.url);
      onClose();
    } catch (error: unknown) {
      state.setError(error instanceof Error ? error.message : "Failed to create pull request");
    } finally {
      state.setSubmitting(false);
    }
  }, [defaultBaseBranch, onClose, onCreated, projectId, state, workingBranch]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <PullRequestDialogHeader workingBranch={workingBranch} baseBranch={state.draft.baseBranch} defaultBaseBranch={defaultBaseBranch} />
        <PullRequestDraftLoading loading={state.loading} />
        {!state.loading ? <PullRequestContext suggestionCopy={state.suggestionCopy} /> : null}
        {!state.loading ? <PullRequestFields title={state.draft.title} description={state.draft.description} baseBranch={state.draft.baseBranch} setTitle={(value) => updateDraftTitle(state.setDraft, value)} setDescription={(value) => updateDraftDescription(state.setDraft, value)} setBaseBranch={(value) => updateDraftBaseBranch(state.setDraft, value)} /> : null}
        <PullRequestError error={state.error} />
        <PullRequestFooter submitting={state.submitting} loading={state.loading} onClose={onClose} onSubmit={() => void submit()} />
      </DialogContent>
    </Dialog>
  );
}
