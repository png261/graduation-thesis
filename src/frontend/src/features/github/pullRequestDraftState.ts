import type { ProjectPullRequestDefaults } from "../../api/projects";

export interface PullRequestDraftState {
  title: string;
  description: string;
  baseBranch: string;
  titleEdited: boolean;
  descriptionEdited: boolean;
  baseBranchEdited: boolean;
}

export function createPullRequestDraftState(): PullRequestDraftState {
  return {
    title: "",
    description: "",
    baseBranch: "",
    titleEdited: false,
    descriptionEdited: false,
    baseBranchEdited: false,
  };
}

export function applyPullRequestDefaults(
  draft: PullRequestDraftState,
  defaults: ProjectPullRequestDefaults,
): PullRequestDraftState {
  return {
    title: draft.titleEdited ? draft.title : defaults.title,
    description: draft.descriptionEdited ? draft.description : defaults.description,
    baseBranch: draft.baseBranchEdited ? draft.baseBranch : defaults.base_branch,
    titleEdited: draft.titleEdited,
    descriptionEdited: draft.descriptionEdited,
    baseBranchEdited: draft.baseBranchEdited,
  };
}

export function buildPullRequestSuggestionCopy(
  source: ProjectPullRequestDefaults["source"],
): string {
  if (source === "fallback") {
    return "Suggested title/body come from the latest available project context and remain editable.";
  }
  return "Suggested title/body come from the latest generation history and remain editable.";
}
