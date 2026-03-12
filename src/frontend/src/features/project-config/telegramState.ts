import type { ProjectTelegramStatus } from "../../api/projects";

export type TelegramPhase = "loading" | "connected" | "pending" | "disconnected";

export function telegramPhase(status: ProjectTelegramStatus | null): TelegramPhase {
  if (!status) return "loading";
  if (status.connected) return "connected";
  if (status.pending) return "pending";
  return "disconnected";
}

export function formatTelegramTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
