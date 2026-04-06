export type PlanTodoStatus = "pending" | "in-progress" | "completed" | "cancelled";

export interface SerializablePlanTodo {
  id: string;
  label: string;
  status: PlanTodoStatus;
  description?: string;
}

export interface SerializablePlan {
  id: string;
  title: string;
  description?: string;
  todos: SerializablePlanTodo[];
}

type AgentPlanStep = {
  step: string;
  status: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPlanStatus(value: unknown): PlanTodoStatus | null {
  if (value === "pending" || value === "completed" || value === "cancelled") return value;
  if (value === "in-progress" || value === "in_progress") return "in-progress";
  return null;
}

function parseSerializableTodo(raw: unknown, index: number): SerializablePlanTodo | null {
  const todo = asRecord(raw);
  const label = readOptionalString(todo.label);
  const status = readPlanStatus(todo.status);
  if (!label || !status) return null;
  return {
    id: readOptionalString(todo.id) ?? `todo-${index + 1}`,
    label,
    status,
    description: readOptionalString(todo.description),
  };
}

function parseSerializableTodos(raw: unknown) {
  if (!Array.isArray(raw)) return null;
  const todos = raw.map(parseSerializableTodo).filter((todo): todo is SerializablePlanTodo => todo !== null);
  return todos.length === raw.length && todos.length > 0 ? todos : null;
}

export function safeParseSerializablePlan(raw: unknown): SerializablePlan | null {
  const plan = asRecord(raw);
  const title = readOptionalString(plan.title);
  const todos = parseSerializableTodos(plan.todos);
  if (!title || !todos) return null;
  return {
    id: readOptionalString(plan.id) ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title,
    description: readOptionalString(plan.description),
    todos,
  };
}

function parseWriteTodo(raw: unknown, index: number): SerializablePlanTodo | null {
  const todo = asRecord(raw);
  const label = readOptionalString(todo.content) ?? readOptionalString(todo.label);
  const status = readPlanStatus(todo.status);
  if (!label || !status) return null;
  return {
    id: readOptionalString(todo.id) ?? `todo-${index + 1}`,
    label,
    status,
    description: readOptionalString(todo.description),
  };
}

function parseWriteTodos(raw: unknown) {
  if (!Array.isArray(raw)) return null;
  const todos = raw.map(parseWriteTodo).filter((todo): todo is SerializablePlanTodo => todo !== null);
  return todos.length === raw.length && todos.length > 0 ? todos : null;
}

function resolveWriteTodos(raw: unknown) {
  const payload = asRecord(raw);
  return parseWriteTodos(payload.todos) ?? parseWriteTodos(asRecord(payload.update).todos);
}

function hasTodos(todos: SerializablePlanTodo[]) {
  return todos.length > 0;
}

export function safeParseWriteTodosPlan(raw: unknown, fallbackId: string): SerializablePlan | null {
  const todos = resolveWriteTodos(raw);
  if (!todos || !hasTodos(todos)) return null;
  return {
    id: fallbackId,
    title: "Current Plan",
    description: "Live task progress",
    todos,
  };
}

function parseAgentPlanTodo(raw: unknown, index: number): SerializablePlanTodo | null {
  const todo = asRecord(raw) as Partial<AgentPlanStep>;
  const label = readOptionalString(todo.step);
  const status = readPlanStatus(todo.status);
  if (!label || !status) return null;
  return { id: `step-${index + 1}`, label, status };
}

export function safeParseAgentPlan(raw: unknown, fallbackId: string): SerializablePlan | null {
  const plan = asRecord(raw);
  if (!Array.isArray(plan.plan) || plan.plan.length < 1) return null;
  const todos = plan.plan.map(parseAgentPlanTodo).filter((todo): todo is SerializablePlanTodo => todo !== null);
  if (todos.length !== plan.plan.length) return null;
  return {
    id: fallbackId,
    title: readOptionalString(plan.title) ?? "Current Plan",
    description: readOptionalString(plan.explanation) ?? readOptionalString(plan.description),
    todos,
  };
}
