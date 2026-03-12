import { useCallback, useEffect, useState } from "react";

import {
  connectProjectTelegram,
  disconnectProjectTelegram,
  getProjectTelegramStatus,
  type ProjectTelegramStatus,
} from "../../api/projects/index";

const TELEGRAM_PENDING_POLL_MS = 3000;

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function useConnectionState() {
  const [telegramStatus, setTelegramStatus] = useState<ProjectTelegramStatus | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramError, setTelegramError] = useState("");
  const [telegramConnectUrl, setTelegramConnectUrl] = useState("");
  return {
    telegramStatus,
    setTelegramStatus,
    telegramBusy,
    setTelegramBusy,
    telegramError,
    setTelegramError,
    telegramConnectUrl,
    setTelegramConnectUrl,
  };
}

function useTelegramRefresh(
  projectId: string,
  setTelegramStatus: (value: ProjectTelegramStatus) => void,
  setTelegramConnectUrl: (value: string) => void,
  setTelegramError: (value: string) => void,
) {
  return useCallback(async () => {
    try {
      const status = await getProjectTelegramStatus(projectId);
      setTelegramStatus(status);
      if (!status.pending) setTelegramConnectUrl("");
    } catch (error: unknown) {
      setTelegramError(toErrorMessage(error, "Failed to load Telegram status"));
    }
  }, [projectId, setTelegramConnectUrl, setTelegramError, setTelegramStatus]);
}

function useLoadEffect(
  projectId: string,
  refreshTelegramStatus: () => Promise<void>,
  setTelegramError: (value: string) => void,
) {
  useEffect(() => {
    setTelegramError("");
    void refreshTelegramStatus();
  }, [projectId, refreshTelegramStatus, setTelegramError]);
}

function usePendingPolling(
  status: ProjectTelegramStatus | null,
  refreshTelegramStatus: () => Promise<void>,
) {
  useEffect(() => {
    if (!status?.pending || status.connected) return;
    const interval = window.setInterval(() => void refreshTelegramStatus(), TELEGRAM_PENDING_POLL_MS);
    return () => window.clearInterval(interval);
  }, [status?.pending, status?.connected, refreshTelegramStatus]);
}

function useConnectAction(
  projectId: string,
  setTelegramBusy: (value: boolean) => void,
  setTelegramError: (value: string) => void,
  setTelegramStatus: (value: ProjectTelegramStatus) => void,
  setTelegramConnectUrl: (value: string) => void,
  refreshTelegramStatus: () => Promise<void>,
) {
  return useCallback(async () => {
    setTelegramBusy(true);
    setTelegramError("");
    try {
      const data = await connectProjectTelegram(projectId);
      setTelegramStatus(data);
      setTelegramConnectUrl(data.connect_url);
      await refreshTelegramStatus();
    } catch (error: unknown) {
      setTelegramError(toErrorMessage(error, "Failed to connect Telegram"));
    } finally {
      setTelegramBusy(false);
    }
  }, [
    projectId,
    refreshTelegramStatus,
    setTelegramBusy,
    setTelegramConnectUrl,
    setTelegramError,
    setTelegramStatus,
  ]);
}

function useDisconnectAction(
  projectId: string,
  setTelegramBusy: (value: boolean) => void,
  setTelegramError: (value: string) => void,
  setTelegramStatus: (value: ProjectTelegramStatus) => void,
  setTelegramConnectUrl: (value: string) => void,
  refreshTelegramStatus: () => Promise<void>,
) {
  return useCallback(async () => {
    setTelegramBusy(true);
    setTelegramError("");
    try {
      const data = await disconnectProjectTelegram(projectId);
      setTelegramStatus(data);
      setTelegramConnectUrl("");
      await refreshTelegramStatus();
    } catch (error: unknown) {
      setTelegramError(toErrorMessage(error, "Failed to disconnect Telegram"));
    } finally {
      setTelegramBusy(false);
    }
  }, [
    projectId,
    refreshTelegramStatus,
    setTelegramBusy,
    setTelegramConnectUrl,
    setTelegramError,
    setTelegramStatus,
  ]);
}

export function useTelegramConfigState(projectId: string) {
  const state = useConnectionState();
  const refreshTelegramStatus = useTelegramRefresh(
    projectId,
    state.setTelegramStatus,
    state.setTelegramConnectUrl,
    state.setTelegramError,
  );
  useLoadEffect(projectId, refreshTelegramStatus, state.setTelegramError);
  usePendingPolling(state.telegramStatus, refreshTelegramStatus);
  const handleConnectTelegram = useConnectAction(
    projectId,
    state.setTelegramBusy,
    state.setTelegramError,
    state.setTelegramStatus,
    state.setTelegramConnectUrl,
    refreshTelegramStatus,
  );
  const handleDisconnectTelegram = useDisconnectAction(
    projectId,
    state.setTelegramBusy,
    state.setTelegramError,
    state.setTelegramStatus,
    state.setTelegramConnectUrl,
    refreshTelegramStatus,
  );
  return {
    telegramStatus: state.telegramStatus,
    telegramBusy: state.telegramBusy,
    telegramError: state.telegramError,
    telegramConnectUrl: state.telegramConnectUrl,
    refreshTelegramStatus,
    handleConnectTelegram,
    handleDisconnectTelegram,
  };
}
