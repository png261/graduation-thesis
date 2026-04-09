import { Check, ChevronDown, Loader2, MoreHorizontal, Slash } from "lucide-react";
import { useState } from "react";

import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import type { PlanTodoStatus, SerializablePlan, SerializablePlanTodo } from "./schema";

const STATUS_LABELS: Record<PlanTodoStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<PlanTodoStatus, string> = {
  pending: "border-[var(--da-border)] text-[var(--da-muted)]",
  in_progress:
    "border-[var(--da-accent)]/40 bg-[color-mix(in_srgb,var(--da-accent)_14%,transparent)] text-[var(--da-accent)]",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  cancelled: "border-amber-500/30 bg-amber-500/10 text-amber-300",
};

function progressWidth(completed: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((completed / total) * 100)}%`;
}

function resolvePlanStatus(todos: SerializablePlanTodo[]) {
  if (todos.some((todo) => todo.status === "in_progress")) return "in_progress";
  if (todos.every((todo) => todo.status === "completed")) return "completed";
  if (todos.some((todo) => todo.status === "cancelled")) return "cancelled";
  return "pending";
}

function resolveActiveStepIndex(todos: SerializablePlanTodo[]) {
  const firstActive = todos.findIndex((todo) => todo.status === "in_progress" || todo.status === "pending");
  return firstActive >= 0 ? firstActive + 1 : todos.length;
}

function StepMarker({ index, status }: { index: number; status: PlanTodoStatus }) {
  const tone =
    status === "completed"
      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
      : status === "in_progress"
        ? "border-[var(--da-accent)]/40 bg-[color-mix(in_srgb,var(--da-accent)_16%,transparent)] text-[var(--da-accent)]"
        : status === "cancelled"
          ? "border-amber-500/30 bg-amber-500/12 text-amber-300"
          : "border-[var(--da-border)] bg-[var(--da-bg)] text-[var(--da-muted)]";

  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
        tone,
      )}
    >
      {status === "completed" ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : status === "in_progress" ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : status === "cancelled" ? (
        <Slash className="h-4 w-4" aria-hidden />
      ) : (
        index
      )}
    </span>
  );
}

function PlanTodoRow({
  index,
  todo,
  showConnector,
}: {
  index: number;
  todo: SerializablePlanTodo;
  showConnector: boolean;
}) {
  const [open, setOpen] = useState(false);
  const canExpand = Boolean(todo.description);

  return (
    <li className="relative">
      {showConnector ? (
        <div className="absolute top-9 left-4 h-[calc(100%-0.2rem)] w-px bg-[var(--da-border)]" aria-hidden />
      ) : null}
      <button
        type="button"
        onClick={canExpand ? () => setOpen((value) => !value) : undefined}
        className={cn(
          "group flex w-full items-start gap-3 rounded-2xl border border-[var(--da-border)] bg-[color-mix(in_srgb,var(--da-elevated)_82%,transparent)] p-4 text-left transition-colors",
          canExpand ? "hover:border-[color-mix(in_srgb,var(--da-accent)_30%,var(--da-border))]" : "cursor-default",
          open ? "border-[color-mix(in_srgb,var(--da-accent)_38%,var(--da-border))]" : "",
        )}
      >
        <StepMarker index={index} status={todo.status} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--da-text)]">{todo.label}</p>
            <Badge variant="outline" className={cn("shrink-0", STATUS_TONE[todo.status])}>
              {STATUS_LABELS[todo.status]}
            </Badge>
          </div>
          {todo.description ? (
            <p className={cn("text-sm text-[var(--da-muted)]", open ? "" : "line-clamp-2")}>{todo.description}</p>
          ) : null}
        </div>
        {canExpand ? (
          <ChevronDown
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-[var(--da-muted)] transition-transform",
              open ? "rotate-180" : "",
            )}
            aria-hidden
          />
        ) : null}
      </button>
    </li>
  );
}

function PlanList({ todos }: { todos: SerializablePlanTodo[] }) {
  const visibleCount = todos.length > 0 ? todos.length - 1 : 0;
  return (
    <ul className="space-y-3">
      {todos.map((todo, index) => (
        <PlanTodoRow key={todo.id} index={index + 1} todo={todo} showConnector={index < visibleCount} />
      ))}
    </ul>
  );
}

function PlanOverflow({ todos, hiddenLabel }: { todos: SerializablePlanTodo[]; hiddenLabel: string }) {
  const [expanded, setExpanded] = useState(false);
  if (todos.length < 1) return null;

  return (
    <div className="space-y-3">
      {!expanded ? (
        <Button
          type="button"
          variant="ghost"
          className="h-auto justify-start gap-2 rounded-xl px-3 py-2 text-sm text-[var(--da-muted)] hover:bg-[var(--da-bg)] hover:text-[var(--da-text)]"
          onClick={() => setExpanded(true)}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
          {hiddenLabel}
        </Button>
      ) : null}
      {expanded ? <PlanList todos={todos} /> : null}
    </div>
  );
}

function PlanCompact(props: SerializablePlan & { className?: string }) {
  const limit = props.maxVisibleTodos ?? 4;
  const visible = props.todos.slice(0, limit);
  const hidden = props.todos.slice(limit);

  return (
    <div className={cn("space-y-3", props.className)}>
      <PlanList todos={visible} />
      <PlanOverflow todos={hidden} hiddenLabel={`${hidden.length} more step${hidden.length === 1 ? "" : "s"}`} />
    </div>
  );
}

type PlanViewProps = SerializablePlan & {
  className?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
};

function PlanRoot(props: PlanViewProps) {
  const completedCount = props.todos.filter((todo) => todo.status === "completed").length;
  const activeStep = resolveActiveStepIndex(props.todos);
  const planStatus = resolvePlanStatus(props.todos);
  const [collapsed, setCollapsed] = useState(Boolean(props.defaultCollapsed));

  const summaryRow = (
    <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--da-muted)]">
      <Badge variant="outline" className={cn("rounded-full px-3 py-1", STATUS_TONE[planStatus])}>
        {STATUS_LABELS[planStatus]}
      </Badge>
      <span>
        Step {activeStep} of {props.todos.length}
      </span>
      <span className="text-xs uppercase tracking-[0.22em] text-[var(--da-muted)]">
        {completedCount}/{props.todos.length} complete
      </span>
    </div>
  );

  return (
    <Card
      className={cn(
        "border-[var(--da-border)] bg-[color-mix(in_srgb,var(--da-elevated)_92%,transparent)] text-[var(--da-text)] shadow-sm",
        props.className,
      )}
    >
      <CardHeader className="space-y-4">
        {props.collapsible ? (
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl bg-[color-mix(in_srgb,var(--da-bg)_92%,transparent)] px-3 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--da-bg)_100%,transparent)]"
            aria-expanded={!collapsed}
          >
            <div className="min-w-0">{summaryRow}</div>
            <ChevronDown
              className={cn(
                "h-5 w-5 shrink-0 text-[var(--da-muted)] transition-transform",
                collapsed ? "" : "rotate-180",
              )}
              aria-hidden
            />
          </button>
        ) : (
          summaryRow
        )}
        {!collapsed ? (
          <>
            <div className="space-y-1.5">
              <CardTitle className="text-xl">{props.title}</CardTitle>
              {props.description ? (
                <CardDescription className="text-[var(--da-muted)]">{props.description}</CardDescription>
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="h-2 rounded-full bg-[var(--da-bg)]">
                <div
                  className="h-2 rounded-full bg-[var(--da-accent)] transition-[width]"
                  style={{ width: progressWidth(completedCount, props.todos.length) }}
                />
              </div>
            </div>
          </>
        ) : null}
      </CardHeader>
      {!collapsed ? (
        <CardContent>
          <PlanCompact {...props} />
        </CardContent>
      ) : null}
    </Card>
  );
}

export const Plan = Object.assign(PlanRoot, { Compact: PlanCompact });
