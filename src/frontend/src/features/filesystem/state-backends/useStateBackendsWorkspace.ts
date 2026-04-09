import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createDriftFixPlan,
  createFixAllPlan,
  deleteStateBackend,
  getDriftAlerts,
  getPolicyAlerts,
  getProjectDeployDriftSummary,
  getStateBackendSettings,
  getStateHistory,
  getStateResources,
  importCloudStateBackend,
  listCloudBuckets,
  listCloudObjects,
  listStateBackends,
  setPrimaryStateBackend,
  syncStateBackend,
  updateStateBackendSettings,
  type DriftAlert,
  type PolicyAlert,
  type ProjectDeployDriftSummary,
  type StateBackend,
  type StateBackendSettings,
  type StateHistoryItem,
  type StateResource,
} from "../../../api/projects";
import { toErrorMessage } from "../../../lib/errors";

type BackendTab = "resources" | "history" | "drift" | "policy" | "settings";

function useBackendState() {
  const [backends, setBackends] = useState<StateBackend[]>([]);
  const [loadingBackends, setLoadingBackends] = useState(false);
  const [backendError, setBackendError] = useState("");
  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BackendTab>("resources");
  const [resources, setResources] = useState<StateResource[]>([]);
  const [history, setHistory] = useState<StateHistoryItem[]>([]);
  const [driftAlerts, setDriftAlerts] = useState<DriftAlert[]>([]);
  const [policyAlerts, setPolicyAlerts] = useState<PolicyAlert[]>([]);
  const [settingsPayload, setSettingsPayload] = useState<StateBackendSettings | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [deployDriftSummary, setDeployDriftSummary] = useState<ProjectDeployDriftSummary | null>(null);
  const [deployDriftLoading, setDeployDriftLoading] = useState(false);
  const [deployDriftError, setDeployDriftError] = useState("");
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [showSensitive, setShowSensitive] = useState(false);
  return {
    backends,
    setBackends,
    loadingBackends,
    setLoadingBackends,
    backendError,
    setBackendError,
    selectedBackendId,
    setSelectedBackendId,
    activeTab,
    setActiveTab,
    resources,
    setResources,
    history,
    setHistory,
    driftAlerts,
    setDriftAlerts,
    policyAlerts,
    setPolicyAlerts,
    settingsPayload,
    setSettingsPayload,
    detailsLoading,
    setDetailsLoading,
    detailsError,
    setDetailsError,
    deployDriftSummary,
    setDeployDriftSummary,
    deployDriftLoading,
    setDeployDriftLoading,
    deployDriftError,
    setDeployDriftError,
    search,
    setSearch,
    activeOnly,
    setActiveOnly,
    showSensitive,
    setShowSensitive,
  };
}

function useCloudConnectState() {
  const [cloudProvider, setCloudProvider] = useState<"aws" | "gcs">("aws");
  const [cloudAccessKeyId, setCloudAccessKeyId] = useState("");
  const [cloudSecretAccessKey, setCloudSecretAccessKey] = useState("");
  const [cloudName, setCloudName] = useState("");
  const [cloudBucket, setCloudBucket] = useState("");
  const [cloudPrefix, setCloudPrefix] = useState("");
  const [cloudKey, setCloudKey] = useState("");
  const [cloudBuckets, setCloudBuckets] = useState<string[]>([]);
  const [cloudObjects, setCloudObjects] = useState<Array<{ key: string; size: number; updated_at: string | null }>>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  return {
    cloudProvider,
    setCloudProvider,
    cloudAccessKeyId,
    setCloudAccessKeyId,
    cloudSecretAccessKey,
    setCloudSecretAccessKey,
    cloudName,
    setCloudName,
    cloudBucket,
    setCloudBucket,
    cloudPrefix,
    setCloudPrefix,
    cloudKey,
    setCloudKey,
    cloudBuckets,
    setCloudBuckets,
    cloudObjects,
    setCloudObjects,
    cloudLoading,
    setCloudLoading,
  };
}

function useConnectState() {
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState("");
  const cloud = useCloudConnectState();
  return {
    connectOpen,
    setConnectOpen,
    connectBusy,
    setConnectBusy,
    connectError,
    setConnectError,
    ...cloud,
  };
}

function useBackendLoaders(projectId: string, backend: ReturnType<typeof useBackendState>) {
  const loadBackends = useCallback(async () => {
    backend.setLoadingBackends(true);
    backend.setBackendError("");
    try {
      const rows = await listStateBackends(projectId);
      backend.setBackends(rows);
      if (!backend.selectedBackendId && rows.length > 0) backend.setSelectedBackendId(rows[0].id);
      if (backend.selectedBackendId && !rows.some((row) => row.id === backend.selectedBackendId)) {
        backend.setSelectedBackendId(rows[0]?.id ?? null);
      }
    } catch (error: unknown) {
      backend.setBackendError(toErrorMessage(error, "Failed to load state backends"));
    } finally {
      backend.setLoadingBackends(false);
    }
  }, [
    backend.selectedBackendId,
    backend.setBackendError,
    backend.setBackends,
    backend.setLoadingBackends,
    backend.setSelectedBackendId,
    projectId,
  ]);

  const loadDetails = useCallback(async () => {
    if (!backend.selectedBackendId) {
      backend.setResources([]);
      backend.setHistory([]);
      backend.setDriftAlerts([]);
      backend.setPolicyAlerts([]);
      backend.setSettingsPayload(null);
      return;
    }
    backend.setDetailsLoading(true);
    backend.setDetailsError("");
    try {
      if (backend.activeTab === "resources") {
        backend.setResources(await getStateResources(projectId, backend.selectedBackendId, { search: backend.search, showSensitive: backend.showSensitive }));
      }
      if (backend.activeTab === "history") {
        backend.setHistory(await getStateHistory(projectId, backend.selectedBackendId, backend.search));
      }
      if (backend.activeTab === "drift") {
        backend.setDriftAlerts(await getDriftAlerts(projectId, backend.selectedBackendId, { activeOnly: backend.activeOnly, search: backend.search }));
      }
      if (backend.activeTab === "policy") {
        backend.setPolicyAlerts(await getPolicyAlerts(projectId, backend.selectedBackendId, { activeOnly: backend.activeOnly, search: backend.search }));
      }
      if (backend.activeTab === "settings") {
        backend.setSettingsPayload(await getStateBackendSettings(projectId, backend.selectedBackendId));
      }
    } catch (error: unknown) {
      backend.setDetailsError(toErrorMessage(error, "Failed to load backend details"));
    } finally {
      backend.setDetailsLoading(false);
    }
  }, [
    backend.activeOnly,
    backend.activeTab,
    backend.search,
    backend.selectedBackendId,
    backend.setDetailsError,
    backend.setDetailsLoading,
    backend.setDriftAlerts,
    backend.setHistory,
    backend.setPolicyAlerts,
    backend.setResources,
    backend.setSettingsPayload,
    backend.showSensitive,
    projectId,
  ]);

  const loadDeployDrift = useCallback(async () => {
    backend.setDeployDriftLoading(true);
    backend.setDeployDriftError("");
    try {
      backend.setDeployDriftSummary(await getProjectDeployDriftSummary(projectId));
    } catch (error: unknown) {
      backend.setDeployDriftSummary(null);
      backend.setDeployDriftError(toErrorMessage(error, "Failed to load deploy drift summary"));
    } finally {
      backend.setDeployDriftLoading(false);
    }
  }, [
    backend.setDeployDriftError,
    backend.setDeployDriftLoading,
    backend.setDeployDriftSummary,
    projectId,
  ]);

  return { loadBackends, loadDetails, loadDeployDrift };
}

function useCloudLoaders(projectId: string, connect: ReturnType<typeof useConnectState>) {
  const loadCloudBuckets = useCallback(async () => {
    if (!connect.cloudAccessKeyId || !connect.cloudSecretAccessKey) {
      connect.setCloudBuckets([]);
      return;
    }
    connect.setCloudLoading(true);
    try {
      const buckets = await listCloudBuckets(projectId, {
        provider: connect.cloudProvider,
        accessKeyId: connect.cloudAccessKeyId,
        secretAccessKey: connect.cloudSecretAccessKey,
      });
      connect.setCloudBuckets(buckets);
      connect.setCloudBucket((prev) => (prev && buckets.includes(prev) ? prev : buckets[0] || ""));
    } catch (error: unknown) {
      connect.setConnectError(toErrorMessage(error, "Failed to load buckets"));
      connect.setCloudBuckets([]);
    } finally {
      connect.setCloudLoading(false);
    }
  }, [
    connect.cloudAccessKeyId,
    connect.cloudProvider,
    connect.cloudSecretAccessKey,
    connect.setCloudBucket,
    connect.setCloudBuckets,
    connect.setCloudLoading,
    connect.setConnectError,
    projectId,
  ]);

  const loadCloudObjects = useCallback(async () => {
    if (!connect.cloudAccessKeyId || !connect.cloudSecretAccessKey || !connect.cloudBucket) {
      connect.setCloudObjects([]);
      return;
    }
    connect.setCloudLoading(true);
    try {
      const objects = await listCloudObjects(projectId, {
        provider: connect.cloudProvider,
        accessKeyId: connect.cloudAccessKeyId,
        secretAccessKey: connect.cloudSecretAccessKey,
        bucket: connect.cloudBucket,
        prefix: connect.cloudPrefix,
      });
      connect.setCloudObjects(objects);
      connect.setCloudKey((prev) => (prev && objects.some((row) => row.key === prev) ? prev : objects[0]?.key || ""));
    } catch (error: unknown) {
      connect.setConnectError(toErrorMessage(error, "Failed to load state objects"));
      connect.setCloudObjects([]);
    } finally {
      connect.setCloudLoading(false);
    }
  }, [
    connect.cloudBucket,
    connect.cloudPrefix,
    connect.cloudAccessKeyId,
    connect.cloudProvider,
    connect.cloudSecretAccessKey,
    connect.setCloudKey,
    connect.setCloudLoading,
    connect.setCloudObjects,
    connect.setConnectError,
    projectId,
  ]);

  return { loadCloudBuckets, loadCloudObjects };
}

function useConnectLoaders(projectId: string, connect: ReturnType<typeof useConnectState>) {
  return useCloudLoaders(projectId, connect);
}

function useConnectActions(
  projectId: string,
  pushLog: (message: string) => void,
  connect: ReturnType<typeof useConnectState>,
  loadBackends: () => Promise<void>,
  loadDeployDrift: () => Promise<void>,
) {
  const runCloudImport = useCallback(async () => {
    if (!connect.cloudAccessKeyId || !connect.cloudSecretAccessKey || !connect.cloudBucket) {
      connect.setConnectError("Provide access key ID, secret key, and bucket");
      return;
    }
    connect.setConnectBusy(true);
    connect.setConnectError("");
    try {
      await importCloudStateBackend(projectId, {
        provider: connect.cloudProvider,
        name: connect.cloudName,
        access_key_id: connect.cloudAccessKeyId,
        secret_access_key: connect.cloudSecretAccessKey,
        bucket: connect.cloudBucket,
        key: connect.cloudKey,
        prefix: connect.cloudPrefix,
      });
      pushLog(`Imported cloud state backend from ${connect.cloudBucket}`);
      connect.setConnectOpen(false);
      await loadBackends();
      await loadDeployDrift();
    } catch (error: unknown) {
      connect.setConnectError(toErrorMessage(error, "Cloud import failed"));
    } finally {
      connect.setConnectBusy(false);
    }
  }, [
    connect.cloudBucket,
    connect.cloudKey,
    connect.cloudName,
    connect.cloudPrefix,
    connect.cloudAccessKeyId,
    connect.cloudProvider,
    connect.cloudSecretAccessKey,
    connect.setConnectBusy,
    connect.setConnectError,
    connect.setConnectOpen,
    loadBackends,
    loadDeployDrift,
    projectId,
    pushLog,
  ]);

  return { runCloudImport };
}

function useBackendActions(
  projectId: string,
  pushLog: (message: string) => void,
  backend: ReturnType<typeof useBackendState>,
  loadBackends: () => Promise<void>,
  loadDetails: () => Promise<void>,
  loadDeployDrift: () => Promise<void>,
) {
  const syncSelectedBackend = useCallback(async () => {
    if (!backend.selectedBackendId) return;
    try {
      await syncStateBackend(projectId, backend.selectedBackendId);
      pushLog("State backend sync completed");
      await loadBackends();
      await loadDetails();
      await loadDeployDrift();
    } catch (error: unknown) {
      backend.setDetailsError(toErrorMessage(error, "Failed to sync backend"));
    }
  }, [backend.selectedBackendId, backend.setDetailsError, loadBackends, loadDeployDrift, loadDetails, projectId, pushLog]);

  const removeSelectedBackend = useCallback(async () => {
    if (!backend.selectedBackendId) return;
    await deleteStateBackend(projectId, backend.selectedBackendId);
    pushLog("State backend deleted");
    backend.setSelectedBackendId(null);
    await loadBackends();
    await loadDeployDrift();
  }, [backend.selectedBackendId, backend.setSelectedBackendId, loadBackends, loadDeployDrift, projectId, pushLog]);

  const saveSettings = useCallback(async () => {
    if (!backend.selectedBackendId || !backend.settingsPayload) return;
    const row = backend.settingsPayload.backend;
    await updateStateBackendSettings(projectId, backend.selectedBackendId, {
      name: row.name,
      schedule_minutes: row.schedule_minutes,
      retention_days: row.retention_days,
      settings: row.settings,
    });
    pushLog("State backend settings saved");
    await loadBackends();
    await loadDetails();
    await loadDeployDrift();
  }, [backend.selectedBackendId, backend.settingsPayload, loadBackends, loadDeployDrift, loadDetails, projectId, pushLog]);

  const setPrimaryDeployBackend = useCallback(async (backendId: string) => {
    try {
      await setPrimaryStateBackend(projectId, backendId);
      pushLog("Primary deploy backend updated");
      await loadBackends();
      await loadDetails();
      await loadDeployDrift();
    } catch (error: unknown) {
      backend.setDetailsError(toErrorMessage(error, "Failed to update primary backend"));
    }
  }, [backend.setDetailsError, loadBackends, loadDeployDrift, loadDetails, projectId, pushLog]);

  const requestFixPlan = useCallback(async (alertId: string) => {
    if (!backend.selectedBackendId) return;
    await createDriftFixPlan(projectId, backend.selectedBackendId, alertId);
    pushLog("Generated drift fix plan");
    await loadDetails();
  }, [backend.selectedBackendId, loadDetails, projectId, pushLog]);

  const requestFixAllPlan = useCallback(async () => {
    if (!backend.selectedBackendId) return;
    await createFixAllPlan(projectId, backend.selectedBackendId);
    pushLog("Generated fix-all plan");
  }, [backend.selectedBackendId, projectId, pushLog]);

  return { syncSelectedBackend, removeSelectedBackend, saveSettings, setPrimaryDeployBackend, requestFixPlan, requestFixAllPlan };
}

function useStateBackendsEffects(args: {
  projectId: string;
  backend: ReturnType<typeof useBackendState>;
  connect: ReturnType<typeof useConnectState>;
  loadBackends: () => Promise<void>;
  loadDetails: () => Promise<void>;
  loadDeployDrift: () => Promise<void>;
  loadCloudBuckets: () => Promise<void>;
  loadCloudObjects: () => Promise<void>;
}) {
  useEffect(() => {
    void args.loadBackends();
  }, [args.loadBackends]);

  useEffect(() => {
    void args.loadDetails();
  }, [args.loadDetails]);

  useEffect(() => {
    void args.loadDeployDrift();
  }, [args.backend.backends, args.loadDeployDrift]);

  useEffect(() => {
    if (!args.connect.connectOpen) return;
    args.connect.setConnectError("");
    void args.loadCloudBuckets();
  }, [args.connect.connectOpen, args.connect.setConnectError, args.loadCloudBuckets]);

  useEffect(() => {
    if (!args.connect.connectOpen) return;
    void args.loadCloudBuckets();
  }, [args.connect.cloudAccessKeyId, args.connect.cloudProvider, args.connect.cloudSecretAccessKey, args.connect.connectOpen, args.loadCloudBuckets]);

  useEffect(() => {
    if (!args.connect.connectOpen) return;
    void args.loadCloudObjects();
  }, [args.connect.cloudAccessKeyId, args.connect.cloudBucket, args.connect.cloudPrefix, args.connect.cloudSecretAccessKey, args.connect.connectOpen, args.loadCloudObjects]);

  useEffect(() => {
    args.backend.setResources([]);
    args.backend.setHistory([]);
    args.backend.setDriftAlerts([]);
    args.backend.setPolicyAlerts([]);
    args.backend.setSettingsPayload(null);
    args.backend.setDeployDriftSummary(null);
    args.backend.setDeployDriftError("");
    args.backend.setSearch("");
    args.backend.setSelectedBackendId(null);
    args.connect.setConnectOpen(false);
  }, [
    args.backend.setDeployDriftError,
    args.backend.setDeployDriftSummary,
    args.backend.setDriftAlerts,
    args.backend.setHistory,
    args.backend.setPolicyAlerts,
    args.backend.setResources,
    args.backend.setSearch,
    args.backend.setSelectedBackendId,
    args.backend.setSettingsPayload,
    args.connect.setConnectOpen,
    args.projectId,
  ]);
}

function buildBackendWorkspaceResult(args: {
  backend: ReturnType<typeof useBackendState>;
  selectedBackend: StateBackend | null;
}) {
  return {
    backends: args.backend.backends,
    loadingBackends: args.backend.loadingBackends,
    backendError: args.backend.backendError,
    selectedBackendId: args.backend.selectedBackendId,
    setSelectedBackendId: args.backend.setSelectedBackendId,
    selectedBackend: args.selectedBackend,
    activeTab: args.backend.activeTab,
    setActiveTab: args.backend.setActiveTab,
    resources: args.backend.resources,
    history: args.backend.history,
    driftAlerts: args.backend.driftAlerts,
    policyAlerts: args.backend.policyAlerts,
    settingsPayload: args.backend.settingsPayload,
    setSettingsPayload: args.backend.setSettingsPayload,
    detailsLoading: args.backend.detailsLoading,
    detailsError: args.backend.detailsError,
    deployDriftSummary: args.backend.deployDriftSummary,
    deployDriftLoading: args.backend.deployDriftLoading,
    deployDriftError: args.backend.deployDriftError,
    search: args.backend.search,
    setSearch: args.backend.setSearch,
    activeOnly: args.backend.activeOnly,
    setActiveOnly: args.backend.setActiveOnly,
    showSensitive: args.backend.showSensitive,
    setShowSensitive: args.backend.setShowSensitive,
  };
}

function buildConnectWorkspaceResult(args: {
  connect: ReturnType<typeof useConnectState>;
  loadBackends: () => Promise<void>;
  loadDetails: () => Promise<void>;
  runCloudImport: () => Promise<void>;
  syncSelectedBackend: () => Promise<void>;
  removeSelectedBackend: () => Promise<void>;
  saveSettings: () => Promise<void>;
  setPrimaryDeployBackend: (backendId: string) => Promise<void>;
  requestFixPlan: (alertId: string) => Promise<void>;
  requestFixAllPlan: () => Promise<void>;
}) {
  return {
    connectOpen: args.connect.connectOpen,
    setConnectOpen: args.connect.setConnectOpen,
    connectBusy: args.connect.connectBusy,
    connectError: args.connect.connectError,
    cloudProvider: args.connect.cloudProvider,
    setCloudProvider: args.connect.setCloudProvider,
    cloudAccessKeyId: args.connect.cloudAccessKeyId,
    setCloudAccessKeyId: args.connect.setCloudAccessKeyId,
    cloudSecretAccessKey: args.connect.cloudSecretAccessKey,
    setCloudSecretAccessKey: args.connect.setCloudSecretAccessKey,
    cloudName: args.connect.cloudName,
    setCloudName: args.connect.setCloudName,
    cloudBucket: args.connect.cloudBucket,
    setCloudBucket: args.connect.setCloudBucket,
    cloudPrefix: args.connect.cloudPrefix,
    setCloudPrefix: args.connect.setCloudPrefix,
    cloudKey: args.connect.cloudKey,
    setCloudKey: args.connect.setCloudKey,
    cloudBuckets: args.connect.cloudBuckets,
    cloudObjects: args.connect.cloudObjects,
    cloudLoading: args.connect.cloudLoading,
    loadBackends: args.loadBackends,
    loadDetails: args.loadDetails,
    runCloudImport: args.runCloudImport,
    syncSelectedBackend: args.syncSelectedBackend,
    removeSelectedBackend: args.removeSelectedBackend,
    saveSettings: args.saveSettings,
    setPrimaryDeployBackend: args.setPrimaryDeployBackend,
    requestFixPlan: args.requestFixPlan,
    requestFixAllPlan: args.requestFixAllPlan,
  };
}

function buildStateBackendsResult(args: {
  backend: ReturnType<typeof useBackendState>;
  connect: ReturnType<typeof useConnectState>;
  selectedBackend: StateBackend | null;
  loadBackends: () => Promise<void>;
  loadDetails: () => Promise<void>;
  runCloudImport: () => Promise<void>;
  syncSelectedBackend: () => Promise<void>;
  removeSelectedBackend: () => Promise<void>;
  saveSettings: () => Promise<void>;
  setPrimaryDeployBackend: (backendId: string) => Promise<void>;
  requestFixPlan: (alertId: string) => Promise<void>;
  requestFixAllPlan: () => Promise<void>;
}) {
  return {
    ...buildBackendWorkspaceResult({ backend: args.backend, selectedBackend: args.selectedBackend }),
    ...buildConnectWorkspaceResult({
      connect: args.connect,
      loadBackends: args.loadBackends,
      loadDetails: args.loadDetails,
      runCloudImport: args.runCloudImport,
      syncSelectedBackend: args.syncSelectedBackend,
      removeSelectedBackend: args.removeSelectedBackend,
      saveSettings: args.saveSettings,
      setPrimaryDeployBackend: args.setPrimaryDeployBackend,
      requestFixPlan: args.requestFixPlan,
      requestFixAllPlan: args.requestFixAllPlan,
    }),
  };
}

export function useStateBackendsWorkspace(projectId: string, pushLog: (message: string) => void) {
  const backend = useBackendState();
  const connect = useConnectState();
  const selectedBackend = useMemo(
    () => backend.backends.find((row) => row.id === backend.selectedBackendId) ?? null,
    [backend.backends, backend.selectedBackendId],
  );
  const { loadBackends, loadDetails, loadDeployDrift } = useBackendLoaders(projectId, backend);
  const { loadCloudBuckets, loadCloudObjects } = useConnectLoaders(projectId, connect);
  const { runCloudImport } = useConnectActions(projectId, pushLog, connect, loadBackends, loadDeployDrift);
  const {
    syncSelectedBackend,
    removeSelectedBackend,
    saveSettings,
    setPrimaryDeployBackend,
    requestFixPlan,
    requestFixAllPlan,
  } = useBackendActions(projectId, pushLog, backend, loadBackends, loadDetails, loadDeployDrift);

  useStateBackendsEffects({
    projectId,
    backend,
    connect,
    loadBackends,
    loadDetails,
    loadDeployDrift,
    loadCloudBuckets,
    loadCloudObjects,
  });

  return buildStateBackendsResult({
    backend,
    connect,
    selectedBackend,
    loadBackends,
    loadDetails,
    runCloudImport,
    syncSelectedBackend,
    removeSelectedBackend,
    saveSettings,
    setPrimaryDeployBackend,
    requestFixPlan,
    requestFixAllPlan,
  });
}
