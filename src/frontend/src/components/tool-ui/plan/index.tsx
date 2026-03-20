import { CheckCircle2, CircleDashed, LoaderCircle, Slash } from "lucide-react";

import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import type { PlanTodoStatus, SerializablePlan, SerializablePlanTodo } from "./schema";

const STATUS_LABELS: Record<PlanTodoStatus, string> = {
  pending: "Pending",
  "in-progress": "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<PlanTodoStatus, string> = {
  pending: "border-[var(--da-border)] text-[var(--da-muted)]",
  "in-progress": "border-[var(--da-accent)]/40 text-[var(--da-accent)]",
  completed: "border-emerald-500/30 text-emerald-300",
  cancelled: "border-amber-500/30 text-amber-300",
};

function TodoIcon({ status }: { status: PlanTodoStatus }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  if (status === "in-progress") return <LoaderCircle className="h-4 w-4 animate-spin text-[var(--da-accent)]" />;
  if (status === "cancelled") return <Slash className="h-4 w-4 text-amber-300" />;
  return <CircleDashed className="h-4 w-4 text-[var(--da-muted)]" />;
}

function PlanProgress({ todos }: { todos: SerializablePlanTodo[] }) {
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const width = `${Math.round((completed / todos.length) * 100)}%`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">
        <span>Progress</span>
        <span>
          {completed}/{todos.length} complete
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--da-bg)]">
        <div className="h-2 rounded-full bg-[var(--da-accent)] transition-[width]" style={{ width }} />
      </div>
    </div>
  );
}

function PlanTodoRow({ todo }: { todo: SerializablePlanTodo }) {
  return (
    <li className="rounded-xl border border-[var(--da-border)] bg-[var(--da-bg)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 shrink-0">
            <TodoIcon status={todo.status} />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--da-text)]">{todo.label}</p>
            {todo.description ? <p className="text-sm text-[var(--da-muted)]">{todo.description}</p> : null}
          </div>
        </div>
        <Badge variant="outline" className={cn("shrink-0", STATUS_TONE[todo.status])}>
          {STATUS_LABELS[todo.status]}
        </Badge>
      </div>
    </li>
  );
}

function PlanCompact(props: SerializablePlan & { className?: string }) {
  return (
    <div className={cn("space-y-3", props.className)}>
      <ul className="space-y-3">
        {props.todos.map((todo) => (
          <PlanTodoRow key={todo.id} todo={todo} />
        ))}
      </ul>
    </div>
  );
}

function PlanRoot(props: SerializablePlan & { className?: string }) {
  return (
    <Card className={cn("bg-[var(--da-elevated)]", props.className)}>
      <CardHeader className="space-y-3">
        <div className="space-y-1.5">
          <CardTitle>{props.title}</CardTitle>
          {props.description ? <CardDescription>{props.description}</CardDescription> : null}
        </div>
        <PlanProgress todos={props.todos} />
      </CardHeader>
      <CardContent>
        <PlanCompact {...props} />
      </CardContent>
    </Card>
  );
}

export const Plan = Object.assign(PlanRoot, { Compact: PlanCompact });
