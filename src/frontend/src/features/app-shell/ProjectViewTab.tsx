import { AssistantSidebar } from "../../components/assistant-ui/assistant-sidebar";
import { FilesystemPanel } from "../../components/FilesystemPanel";
import type { Suggestion } from "../../lib/suggestions";

export function ProjectViewTab({
  projectId,
  authenticated,
  suggestions,
}: {
  projectId: string;
  authenticated: boolean;
  suggestions: Suggestion[];
}) {
  return (
    <div className="h-full max-h-full min-h-0 overflow-hidden bg-[var(--da-panel)]">
      <AssistantSidebar suggestions={suggestions}>
        <FilesystemPanel projectId={projectId} authenticated={authenticated} />
      </AssistantSidebar>
    </div>
  );
}
