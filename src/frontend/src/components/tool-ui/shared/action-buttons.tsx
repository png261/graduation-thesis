"use client";

import { Button, cn } from "./_adapter";
import type { Action } from "./schema";
import { useActionButtons } from "./use-action-buttons";

interface ActionButtonsProps {
  actions: Action[];
  onAction: (actionId: string) => void | Promise<void>;
  onBeforeAction?: (actionId: string) => boolean | Promise<boolean>;
  confirmTimeout?: number;
  align?: "left" | "center" | "right";
  className?: string;
}

export function ActionButtons(props: ActionButtonsProps) {
  const { actions, onAction, onBeforeAction, confirmTimeout = 3000, align = "right", className } = props;
  const { actions: resolvedActions, runAction } = useActionButtons({
    actions,
    onAction,
    onBeforeAction,
    confirmTimeout,
  });

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2",
        align === "left" && "sm:justify-start",
        align === "center" && "sm:justify-center",
        align === "right" && "sm:justify-end",
        className,
      )}
    >
      {resolvedActions.map((action) => (
        <Button
          key={action.id}
          variant={action.variant ?? "default"}
          onClick={() => void runAction(action.id)}
          disabled={action.isDisabled}
          className={cn(
            "min-h-11 w-full justify-center rounded-full px-4 text-base sm:min-h-0 sm:w-auto sm:px-3 sm:py-2 sm:text-sm",
            action.isConfirming && "ring-2 ring-[var(--da-accent)]/60 ring-offset-2 ring-offset-[var(--da-bg)]",
          )}
          aria-label={action.shortcut ? `${action.currentLabel} (${action.shortcut})` : action.currentLabel}
        >
          {action.isLoading ? (
            <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : null}
          {action.icon}
          {action.currentLabel}
          {action.shortcut ? <kbd className="ml-2 hidden rounded-lg border border-[var(--da-border)] bg-[var(--da-panel)] px-2 py-0.5 font-mono text-xs font-medium sm:inline-block">{action.shortcut}</kbd> : null}
        </Button>
      ))}
    </div>
  );
}
