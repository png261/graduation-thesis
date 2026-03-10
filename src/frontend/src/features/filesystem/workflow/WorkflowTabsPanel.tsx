import { CircleX, Terminal } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import type { WorkflowProblem } from "../types";

export function WorkflowTabsPanel({
  workflowTab,
  setWorkflowTab,
  activityLogs,
  workflowProblems,
}: {
  workflowTab: "logs" | "problems";
  setWorkflowTab: (tab: "logs" | "problems") => void;
  activityLogs: string[];
  workflowProblems: WorkflowProblem[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0c1320]">
      <Tabs
        value={workflowTab}
        onValueChange={(value) => setWorkflowTab(value as "logs" | "problems")}
        className="flex h-full min-h-0 flex-col"
      >
        <div className="flex items-center justify-between border-b border-[var(--da-border)] px-2 py-1">
          <TabsList className="h-8 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="logs" className="h-7 gap-1.5 text-xs uppercase tracking-[0.15em]">
              <Terminal className="h-3.5 w-3.5" />
              Workflow Logs
            </TabsTrigger>
            <TabsTrigger value="problems" className="h-7 gap-1.5 text-xs uppercase tracking-[0.15em]">
              <CircleX className="h-3.5 w-3.5" />
              Problems
              <span className="rounded-full bg-[var(--da-accent)]/25 px-1.5 py-0.5 text-[10px] leading-none text-blue-200">
                {workflowProblems.length}
              </span>
            </TabsTrigger>
          </TabsList>
          <span className="text-[10px] text-[var(--da-muted)]">
            {workflowTab === "logs"
              ? `${activityLogs.length} events`
              : `${workflowProblems.length} problems`}
          </span>
        </div>

        <TabsContent value="logs" className="mt-0 min-h-0 flex-1">
          <div className="h-full overflow-y-auto px-3 py-2 font-mono text-[11px] text-blue-100/85">
            {activityLogs.length === 0 ? (
              <p className="text-[var(--da-muted)]">No activity yet.</p>
            ) : (
              activityLogs.map((line, idx) => (
                <div key={`${idx}-${line.slice(0, 12)}`} className="mb-1">
                  {line}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="problems" className="mt-0 min-h-0 flex-1">
          <div className="h-full overflow-y-auto px-3 py-2 font-mono text-[11px] text-red-100/90">
            {workflowProblems.length === 0 ? (
              <p className="text-[var(--da-muted)]">No problems found.</p>
            ) : (
              workflowProblems.map((problem) => (
                <div
                  key={problem.id}
                  className="mb-2 rounded border border-red-500/35 bg-red-500/10 px-2.5 py-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.12em] text-red-200/80">
                    <span>
                      {problem.mode}
                      {problem.severity ? ` · ${problem.severity}` : ""}
                    </span>
                    <span>{problem.at}</span>
                  </div>
                  <div className="leading-5 text-red-100">{problem.message}</div>
                  {(problem.module ||
                    problem.stage ||
                    problem.path ||
                    problem.line ||
                    problem.ruleId ||
                    problem.source) && (
                    <div className="mt-1 text-[10px] text-red-200/70">
                      {problem.module ? `module: ${problem.module}` : ""}
                      {problem.module && (problem.stage || problem.path || problem.line || problem.ruleId || problem.source)
                        ? " | "
                        : ""}
                      {problem.stage ? `stage: ${problem.stage}` : ""}
                      {problem.stage && (problem.path || problem.line || problem.ruleId || problem.source) ? " | " : ""}
                      {problem.path ? `path: ${problem.path}` : ""}
                      {problem.path && (problem.line || problem.ruleId || problem.source) ? " | " : ""}
                      {problem.line ? `line: ${problem.line}` : ""}
                      {problem.line && (problem.ruleId || problem.source) ? " | " : ""}
                      {problem.ruleId ? `rule: ${problem.ruleId}` : ""}
                      {problem.ruleId && problem.source ? " | " : ""}
                      {problem.source ? `source: ${problem.source}` : ""}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
