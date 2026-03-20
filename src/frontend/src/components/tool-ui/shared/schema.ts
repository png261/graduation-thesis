import type { ReactNode } from "react";

export interface Action {
  id: string;
  label: string;
  confirmLabel?: string;
  variant?: "default" | "destructive" | "secondary" | "ghost" | "outline";
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  shortcut?: string;
}
