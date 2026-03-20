"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Action } from "./schema";

interface UseActionButtonsOptions {
  actions: Action[];
  onAction: (actionId: string) => void | Promise<void>;
  onBeforeAction?: (actionId: string) => boolean | Promise<boolean>;
  confirmTimeout?: number;
}

function createExecutionLock() {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
  };
}

export function useActionButtons(options: UseActionButtonsOptions) {
  const { actions, onAction, onBeforeAction, confirmTimeout = 3000 } = options;
  const [confirmingActionId, setConfirmingActionId] = useState<string | null>(null);
  const [executingActionId, setExecutingActionId] = useState<string | null>(null);
  const executionLockRef = useRef(createExecutionLock());

  useEffect(() => {
    if (!confirmingActionId) return;
    const timeoutId = window.setTimeout(() => setConfirmingActionId(null), confirmTimeout);
    return () => window.clearTimeout(timeoutId);
  }, [confirmTimeout, confirmingActionId]);

  useEffect(() => {
    if (!confirmingActionId) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirmingActionId(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmingActionId]);

  const runAction = useCallback(
    async (actionId: string) => {
      const action = actions.find((candidate) => candidate.id === actionId);
      if (!action) return;
      if (action.disabled || action.loading || executingActionId) return;
      if (action.confirmLabel && confirmingActionId !== action.id) {
        setConfirmingActionId(action.id);
        return;
      }
      if (!executionLockRef.current.tryAcquire()) return;
      if (onBeforeAction) {
        const shouldProceed = await onBeforeAction(action.id);
        if (!shouldProceed) {
          setConfirmingActionId(null);
          executionLockRef.current.release();
          return;
        }
      }
      try {
        setExecutingActionId(action.id);
        await onAction(action.id);
      } finally {
        executionLockRef.current.release();
        setExecutingActionId(null);
        setConfirmingActionId(null);
      }
    },
    [actions, confirmingActionId, executingActionId, onAction, onBeforeAction],
  );

  const resolvedActions = useMemo(
    () =>
      actions.map((action) => {
        const isConfirming = confirmingActionId === action.id;
        const isExecuting = executingActionId === action.id;
        return {
          ...action,
          currentLabel: isConfirming && action.confirmLabel ? action.confirmLabel : action.label,
          isConfirming,
          isLoading: Boolean(action.loading) || isExecuting,
          isDisabled: Boolean(action.disabled) || (Boolean(executingActionId) && !isExecuting),
        };
      }),
    [actions, confirmingActionId, executingActionId],
  );

  return { actions: resolvedActions, runAction };
}
