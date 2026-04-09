import { CircleX, Terminal } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import type { WorkflowProblem } from "../types";

interface WorkflowTabsPanelProps {
  workflowTab: "logs" | "problems";
  setWorkflowTab: (tab: "logs" | "problems") => void;
  activityLogs: string[];
  workflowProblems: WorkflowProblem[];
}

function getTabSummary(tab: "logs" | "problems", activityCount: number, problemCount: number) {
  return tab === "logs" ? `${activityCount} events` : `${problemCount} problems`;
}

function WorkflowTabsHeader({
  workflowTab,
  problemCount,
  activityCount,
}: {
  workflowTab: "logs" | "problems";
  problemCount: number;
  activityCount: number;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--da-border)] px-2 py-1">
      <TabsList className="h-8 rounded-none border-0 bg-transparent p-0">
        <TabsTrigger value="logs" className="h-7 gap-1.5 text-xs uppercase tracking-[0.15em]">
          <Terminal className="h-3.5 w-3.5" />
          Workflow Logs
        </TabsTrigger>
        <TabsTrigger value="problems" className="h-7 gap-1.5 text-xs uppercase tracking-[0.15em]">
          <CircleX className="h-3.5 w-3.5" />
          Problems
          <span className="rounded-full bg-[var(--da-accent)]/15 px-1.5 py-0.5 text-[10px] leading-none text-[var(--da-accent)]">{problemCount}</span>
        </TabsTrigger>
      </TabsList>
      <span className="text-[10px] text-[var(--da-muted)]">{getTabSummary(workflowTab, activityCount, problemCount)}</span>
    </div>
  );
}

function WorkflowLogsContent({ activityLogs }: { activityLogs: string[] }) {
  if (activityLogs.length < 1) return <p className="text-[var(--da-muted)]">No activity yet.</p>;
  return (
    <>
      {activityLogs.map((line, index) => (
        <div key={`${index}-${line.slice(0, 12)}`} className="mb-1">
          {line}
        </div>
      ))}
    </>
  );
}

function buildProblemMeta(problem: WorkflowProblem) {
  const entries = [
    problem.module ? `module: ${problem.module}` : "",
    problem.stage ? `stage: ${problem.stage}` : "",
    problem.path ? `path: ${problem.path}` : "",
    problem.line ? `line: ${problem.line}` : "",
    problem.ruleId ? `rule: ${problem.ruleId}` : "",
    problem.source ? `source: ${problem.source}` : "",
  ];
  return entries.filter(Boolean).join(" | ");
}

function ProblemCard({ problem }: { problem: WorkflowProblem }) {
  const details = buildProblemMeta(problem);
  return (
    <div className="mb-2 rounded border border-red-500/35 bg-red-500/10 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-red-700">
        <span>{problem.severity ? `${problem.mode} · ${problem.severity}` : problem.mode}</span>
        <span>{problem.at}</span>
      </div>
      <div className="leading-5 text-red-700">{problem.message}</div>
      {details ? <div className="mt-1 text-[10px] text-red-600">{details}</div> : null}
    </div>
  );
}

function WorkflowProblemsContent({ workflowProblems }: { workflowProblems: WorkflowProblem[] }) {
  if (workflowProblems.length < 1) return <p className="text-[var(--da-muted)]">No problems found.</p>;
  return (
    <>
      {workflowProblems.map((problem) => (
        <ProblemCard key={problem.id} problem={problem} />
      ))}
    </>
  );
}

export function WorkflowTabsPanel({ workflowTab, setWorkflowTab, activityLogs, workflowProblems }: WorkflowTabsPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--da-panel)]">
      <Tabs value={workflowTab} onValueChange={(value) => setWorkflowTab(value as "logs" | "problems")} className="flex h-full min-h-0 flex-col">
        <WorkflowTabsHeader workflowTab={workflowTab} problemCount={workflowProblems.length} activityCount={activityLogs.length} />
        <TabsContent value="logs" className="mt-0 min-h-0 flex-1">
          <div className="h-full overflow-y-auto px-3 py-2 font-mono text-[11px] text-[color-mix(in_srgb,var(--da-text)_82%,transparent)]">
            <WorkflowLogsContent activityLogs={activityLogs} />
          </div>
        </TabsContent>
        <TabsContent value="problems" className="mt-0 min-h-0 flex-1">
          <div className="h-full overflow-y-auto px-3 py-2 font-mono text-[11px] text-red-700">
            <WorkflowProblemsContent workflowProblems={workflowProblems} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
