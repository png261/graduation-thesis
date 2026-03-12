import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createDriftFixPlan,
  createFixAllPlan,
  deleteStateBackend,
  getDriftAlerts,
  getGitHubSession,
  getGitLabOauthStart,
  getGitLabSession,
  getPolicyAlerts,
  getStateBackendSettings,
  getStateHistory,
  getStateResources,
  importCloudStateBackend,
  importStateBackendFromGitHub,
  importStateBackendFromGitLab,
  listCloudBuckets,
  listCloudObjects,
  listCredentialProfiles,
  listGitHubRepos,
  listGitLabRepos,
  listStateBackends,
  syncStateBackend,
  updateStateBackendSettings,
  type CredentialProfile,
  type DriftAlert,
  type GitHubRepo,
  type GitHubSession,
  type GitLabRepo,
  type GitLabSession,
  type PolicyAlert,
  type StateBackend,
  type StateBackendImportCandidate,
  type StateBackendSettings,
  type StateHistoryItem,
  type StateResource,
} from "../../../api/projects";
import { toErrorMessage } from "../../../lib/errors";

type BackendTab = "resources" | "history" | "drift" | "policy" | "settings";
type ConnectSource = "cloud" | "github" | "gitlab";

function firstProfileForProvider(profiles: CredentialProfile[], provider: string): string {
  return profiles.find((row) => row.provider === provider)?.id ?? "";
}

function selectedCandidates(candidates: StateBackendImportCandidate[], selected: Record<string, boolean>) {
  const rows = candidates.filter((row) => selected[row.name]);
  return rows.length > 0 ? rows : candidates;
}

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
  const [cloudProfileId, setCloudProfileId] = useState("");
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
    cloudProfileId,
    setCloudProfileId,
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

function useGithubConnectState() {
  const [githubSession, setGithubSession] = useState<GitHubSession>({ authenticated: false });
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubRepo, setGithubRepo] = useState("");
  const [githubBranch, setGithubBranch] = useState("");
  const [githubProfileId, setGithubProfileId] = useState("");
  const [githubCandidates, setGithubCandidates] = useState<StateBackendImportCandidate[]>([]);
  const [githubSelectedCandidates, setGithubSelectedCandidates] = useState<Record<string, boolean>>({});
  return {
    githubSession,
    setGithubSession,
    githubRepos,
    setGithubRepos,
    githubRepo,
    setGithubRepo,
    githubBranch,
    setGithubBranch,
    githubProfileId,
    setGithubProfileId,
    githubCandidates,
    setGithubCandidates,
    githubSelectedCandidates,
    setGithubSelectedCandidates,
  };
}

function useGitlabConnectState() {
  const [gitlabSession, setGitlabSession] = useState<GitLabSession>({ authenticated: false });
  const [gitlabRepos, setGitlabRepos] = useState<GitLabRepo[]>([]);
  const [gitlabRepo, setGitlabRepo] = useState("");
  const [gitlabBranch, setGitlabBranch] = useState("");
  const [gitlabProfileId, setGitlabProfileId] = useState("");
  const [gitlabCandidates, setGitlabCandidates] = useState<StateBackendImportCandidate[]>([]);
  const [gitlabSelectedCandidates, setGitlabSelectedCandidates] = useState<Record<string, boolean>>({});
  return {
    gitlabSession,
    setGitlabSession,
    gitlabRepos,
    setGitlabRepos,
    gitlabRepo,
    setGitlabRepo,
    gitlabBranch,
    setGitlabBranch,
    gitlabProfileId,
    setGitlabProfileId,
    gitlabCandidates,
    setGitlabCandidates,
    gitlabSelectedCandidates,
    setGitlabSelectedCandidates,
  };
}

function useConnectState() {
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectSource, setConnectSource] = useState<ConnectSource>("cloud");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [profiles, setProfiles] = useState<CredentialProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const cloud = useCloudConnectState();
  const github = useGithubConnectState();
  const gitlab = useGitlabConnectState();
  return {
    connectOpen,
    setConnectOpen,
    connectSource,
    setConnectSource,
    connectBusy,
    setConnectBusy,
    connectError,
    setConnectError,
    profiles,
    setProfiles,
    profilesLoading,
    setProfilesLoading,
    ...cloud,
    ...github,
    ...gitlab,
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

  return { loadBackends, loadDetails };
}

function useProfileLoaders(connect: ReturnType<typeof useConnectState>) {
  const loadProfiles = useCallback(async () => {
    connect.setProfilesLoading(true);
    try {
      const rows = await listCredentialProfiles();
      connect.setProfiles(rows);
      connect.setCloudProfileId((prev) => prev || firstProfileForProvider(rows, connect.cloudProvider));
      connect.setGithubProfileId((prev) => prev || firstProfileForProvider(rows, "aws") || firstProfileForProvider(rows, "gcs"));
      connect.setGitlabProfileId((prev) => prev || firstProfileForProvider(rows, "aws") || firstProfileForProvider(rows, "gcs"));
    } catch {
      connect.setProfiles([]);
    } finally {
      connect.setProfilesLoading(false);
    }
  }, [
    connect.cloudProvider,
    connect.setCloudProfileId,
    connect.setGithubProfileId,
    connect.setGitlabProfileId,
    connect.setProfiles,
    connect.setProfilesLoading,
  ]);
  return { loadProfiles };
}

function useCloudLoaders(projectId: string, connect: ReturnType<typeof useConnectState>) {
  const loadCloudBuckets = useCallback(async () => {
    if (!connect.cloudProfileId) {
      connect.setCloudBuckets([]);
      return;
    }
    connect.setCloudLoading(true);
    try {
      const buckets = await listCloudBuckets(projectId, { provider: connect.cloudProvider, credentialProfileId: connect.cloudProfileId });
      connect.setCloudBuckets(buckets);
      connect.setCloudBucket((prev) => (prev && buckets.includes(prev) ? prev : buckets[0] || ""));
    } catch (error: unknown) {
      connect.setConnectError(toErrorMessage(error, "Failed to load buckets"));
      connect.setCloudBuckets([]);
    } finally {
      connect.setCloudLoading(false);
    }
  }, [
    connect.cloudProfileId,
    connect.cloudProvider,
    connect.setCloudBucket,
    connect.setCloudBuckets,
    connect.setCloudLoading,
    connect.setConnectError,
    projectId,
  ]);

  const loadCloudObjects = useCallback(async () => {
    if (!connect.cloudProfileId || !connect.cloudBucket) {
      connect.setCloudObjects([]);
      return;
    }
    connect.setCloudLoading(true);
    try {
      const objects = await listCloudObjects(projectId, {
        provider: connect.cloudProvider,
        credentialProfileId: connect.cloudProfileId,
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
    connect.cloudProfileId,
    connect.cloudProvider,
    connect.setCloudKey,
    connect.setCloudLoading,
    connect.setCloudObjects,
    connect.setConnectError,
    projectId,
  ]);

  return { loadCloudBuckets, loadCloudObjects };
}

function useRepoSourceLoaders(connect: ReturnType<typeof useConnectState>) {
  const loadGithubSource = useCallback(async () => {
    try {
      const session = await getGitHubSession();
      connect.setGithubSession(session);
      if (!session.authenticated) {
        connect.setGithubRepos([]);
        return;
      }
      const repos = await listGitHubRepos();
      connect.setGithubRepos(repos);
      connect.setGithubRepo((prev) => prev || repos[0]?.full_name || "");
      connect.setGithubBranch((prev) => prev || repos[0]?.default_branch || "main");
    } catch (error: unknown) {
      connect.setConnectError(toErrorMessage(error, "Failed to load GitHub repositories"));
    }
  }, [
    connect.setConnectError,
    connect.setGithubBranch,
    connect.setGithubRepo,
    connect.setGithubRepos,
    connect.setGithubSession,
  ]);

  const loadGitlabSource = useCallback(async () => {
    try {
      const session = await getGitLabSession();
      connect.setGitlabSession(session);
      if (!session.authenticated) {
        connect.setGitlabRepos([]);
        return;
      }
      const repos = await listGitLabRepos();
      connect.setGitlabRepos(repos);
      connect.setGitlabRepo((prev) => prev || repos[0]?.full_name || "");
      connect.setGitlabBranch((prev) => prev || repos[0]?.default_branch || "main");
    } catch (error: unknown) {
      connect.setConnectError(toErrorMessage(error, "Failed to load GitLab repositories"));
    }
  }, [
    connect.setConnectError,
    connect.setGitlabBranch,
    connect.setGitlabRepo,
    connect.setGitlabRepos,
    connect.setGitlabSession,
  ]);

  return { loadGithubSource, loadGitlabSource };
}

function useConnectLoaders(projectId: string, connect: ReturnType<typeof useConnectState>) {
  const profileLoaders = useProfileLoaders(connect);
  const cloudLoaders = useCloudLoaders(projectId, connect);
  const repoLoaders = useRepoSourceLoaders(connect);
  return { ...profileLoaders, ...cloudLoaders, ...repoLoaders };
}

function useConnectActions(
  projectId: string,
  pushLog: (message: string) => void,
  connect: ReturnType<typeof useConnectState>,
  loadBackends: () => Promise<void>,
  loadGitlabSource: () => Promise<void>,
) {
  const openGitlabOAuth = useCallback(async () => {
    const data = await getGitLabOauthStart();
    const popup = window.open(data.authorize_url, "gitlab-oauth", "width=640,height=720");
    if (!popup) throw new Error("Unable to open GitLab OAuth popup");
    await new Promise<void>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const payload = event.data;
        if (!payload || payload.source !== "gitlab-oauth") return;
        window.removeEventListener("message", handler);
        if (payload.status === "ok") {
          resolve();
          return;
        }
        reject(new Error(payload.message || "GitLab OAuth failed"));
      };
      window.addEventListener("message", handler);
      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          window.removeEventListener("message", handler);
          resolve();
        }
      }, 400);
    });
    await loadGitlabSource();
  }, [loadGitlabSource]);

  const runCloudImport = useCallback(async () => {
    if (!connect.cloudProfileId || !connect.cloudBucket) {
      connect.setConnectError("Select credential profile and bucket");
      return;
    }
    connect.setConnectBusy(true);
    connect.setConnectError("");
    try {
      await importCloudStateBackend(projectId, {
        provider: connect.cloudProvider,
        name: connect.cloudName,
        credential_profile_id: connect.cloudProfileId,
        bucket: connect.cloudBucket,
        key: connect.cloudKey,
        prefix: connect.cloudPrefix,
      });
      pushLog(`Imported cloud state backend from ${connect.cloudBucket}`);
      connect.setConnectOpen(false);
      await loadBackends();
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
    connect.cloudProfileId,
    connect.cloudProvider,
    connect.setConnectBusy,
    connect.setConnectError,
    connect.setConnectOpen,
    loadBackends,
    projectId,
    pushLog,
  ]);

  const scanGithubRepo = useCallback(async () => {
    if (!connect.githubRepo || !connect.githubProfileId) {
      connect.setConnectError("Select repository and credential profile");
      return;
    }
    connect.setConnectBusy(true);
    connect.setConnectError("");
    try {
      const result = await importStateBackendFromGitHub(projectId, {
        repo_full_name: connect.githubRepo,
        branch: connect.githubBranch || null,
        credential_profile_id: connect.githubProfileId,
        dry_run: true,
      });
      connect.setGithubCandidates(result.discovered);
      connect.setGithubSelectedCandidates(Object.fromEntries(result.discovered.map((row) => [row.name, true])));
      if (result.discovered.length < 1) connect.setConnectError("No backend configuration found in repository");
    } catch (error: unknown) {
      connect.setConnectError(toErrorMessage(error, "Failed to scan GitHub repository"));
    } finally {
      connect.setConnectBusy(false);
    }
  }, [
    connect.githubBranch,
    connect.githubProfileId,
    connect.githubRepo,
    connect.setConnectBusy,
    connect.setConnectError,
    connect.setGithubCandidates,
    connect.setGithubSelectedCandidates,
    projectId,
  ]);

  const importGithubRepo = useCallback(async () => {
    if (!connect.githubRepo || !connect.githubProfileId) {
      connect.setConnectError("Select repository and credential profile");
      return;
    }
    connect.setConnectBusy(true);
    connect.setConnectError("");
    try {
      const result = await importStateBackendFromGitHub(projectId, {
        repo_full_name: connect.githubRepo,
        branch: connect.githubBranch || null,
        credential_profile_id: connect.githubProfileId,
        selected_candidates: selectedCandidates(connect.githubCandidates, connect.githubSelectedCandidates),
      });
      pushLog(`Imported ${result.created.length} backend(s) from GitHub`);
      connect.setConnectOpen(false);
      await loadBackends();
    } catch (error: unknown) {
      connect.setConnectError(toErrorMessage(error, "GitHub import failed"));
    } finally {
      connect.setConnectBusy(false);
    }
  }, [
    connect.githubBranch,
    connect.githubCandidates,
    connect.githubProfileId,
    connect.githubRepo,
    connect.githubSelectedCandidates,
    connect.setConnectBusy,
    connect.setConnectError,
    connect.setConnectOpen,
    loadBackends,
    projectId,
    pushLog,
  ]);

  const scanGitlabRepo = useCallback(async () => {
    if (!connect.gitlabRepo || !connect.gitlabProfileId) {
      connect.setConnectError("Select repository and credential profile");
      return;
    }
    connect.setConnectBusy(true);
    connect.setConnectError("");
    try {
      const result = await importStateBackendFromGitLab(projectId, {
        repo_full_name: connect.gitlabRepo,
        branch: connect.gitlabBranch || null,
        credential_profile_id: connect.gitlabProfileId,
        dry_run: true,
      });
      connect.setGitlabCandidates(result.discovered);
      connect.setGitlabSelectedCandidates(Object.fromEntries(result.discovered.map((row) => [row.name, true])));
      if (result.discovered.length < 1) connect.setConnectError("No backend configuration found in repository");
    } catch (error: unknown) {
      connect.setConnectError(toErrorMessage(error, "Failed to scan GitLab repository"));
    } finally {
      connect.setConnectBusy(false);
    }
  }, [
    connect.gitlabBranch,
    connect.gitlabProfileId,
    connect.gitlabRepo,
    connect.setConnectBusy,
    connect.setConnectError,
    connect.setGitlabCandidates,
    connect.setGitlabSelectedCandidates,
    projectId,
  ]);

  const importGitlabRepo = useCallback(async () => {
    if (!connect.gitlabRepo || !connect.gitlabProfileId) {
      connect.setConnectError("Select repository and credential profile");
      return;
    }
    connect.setConnectBusy(true);
    connect.setConnectError("");
    try {
      const result = await importStateBackendFromGitLab(projectId, {
        repo_full_name: connect.gitlabRepo,
        branch: connect.gitlabBranch || null,
        credential_profile_id: connect.gitlabProfileId,
        selected_candidates: selectedCandidates(connect.gitlabCandidates, connect.gitlabSelectedCandidates),
      });
      pushLog(`Imported ${result.created.length} backend(s) from GitLab`);
      connect.setConnectOpen(false);
      await loadBackends();
    } catch (error: unknown) {
      connect.setConnectError(toErrorMessage(error, "GitLab import failed"));
    } finally {
      connect.setConnectBusy(false);
    }
  }, [
    connect.gitlabBranch,
    connect.gitlabCandidates,
    connect.gitlabProfileId,
    connect.gitlabRepo,
    connect.gitlabSelectedCandidates,
    connect.setConnectBusy,
    connect.setConnectError,
    connect.setConnectOpen,
    loadBackends,
    projectId,
    pushLog,
  ]);

  return { openGitlabOAuth, runCloudImport, scanGithubRepo, importGithubRepo, scanGitlabRepo, importGitlabRepo };
}

function useBackendActions(
  projectId: string,
  pushLog: (message: string) => void,
  backend: ReturnType<typeof useBackendState>,
  loadBackends: () => Promise<void>,
  loadDetails: () => Promise<void>,
) {
  const syncSelectedBackend = useCallback(async () => {
    if (!backend.selectedBackendId) return;
    try {
      await syncStateBackend(projectId, backend.selectedBackendId);
      pushLog("State backend sync completed");
      await loadBackends();
      await loadDetails();
    } catch (error: unknown) {
      backend.setDetailsError(toErrorMessage(error, "Failed to sync backend"));
    }
  }, [backend.selectedBackendId, backend.setDetailsError, loadBackends, loadDetails, projectId, pushLog]);

  const removeSelectedBackend = useCallback(async () => {
    if (!backend.selectedBackendId) return;
    await deleteStateBackend(projectId, backend.selectedBackendId);
    pushLog("State backend deleted");
    backend.setSelectedBackendId(null);
    await loadBackends();
  }, [backend.selectedBackendId, backend.setSelectedBackendId, loadBackends, projectId, pushLog]);

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
  }, [backend.selectedBackendId, backend.settingsPayload, loadBackends, loadDetails, projectId, pushLog]);

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

  return { syncSelectedBackend, removeSelectedBackend, saveSettings, requestFixPlan, requestFixAllPlan };
}

function useStateBackendsEffects(args: {
  projectId: string;
  backend: ReturnType<typeof useBackendState>;
  connect: ReturnType<typeof useConnectState>;
  loadBackends: () => Promise<void>;
  loadDetails: () => Promise<void>;
  loadProfiles: () => Promise<void>;
  loadCloudBuckets: () => Promise<void>;
  loadCloudObjects: () => Promise<void>;
  loadGithubSource: () => Promise<void>;
  loadGitlabSource: () => Promise<void>;
}) {
  useEffect(() => {
    void args.loadBackends();
  }, [args.loadBackends]);

  useEffect(() => {
    void args.loadDetails();
  }, [args.loadDetails]);

  useEffect(() => {
    if (!args.connect.connectOpen) return;
    args.connect.setConnectError("");
    void args.loadProfiles();
    if (args.connect.connectSource === "cloud") void args.loadCloudBuckets();
    if (args.connect.connectSource === "github") void args.loadGithubSource();
    if (args.connect.connectSource === "gitlab") void args.loadGitlabSource();
  }, [args.connect.connectOpen, args.connect.connectSource, args.connect.setConnectError, args.loadCloudBuckets, args.loadGithubSource, args.loadGitlabSource, args.loadProfiles]);

  useEffect(() => {
    if (!args.connect.connectOpen || args.connect.connectSource !== "cloud") return;
    void args.loadCloudBuckets();
  }, [args.connect.cloudProvider, args.connect.cloudProfileId, args.connect.connectOpen, args.connect.connectSource, args.loadCloudBuckets]);

  useEffect(() => {
    if (!args.connect.connectOpen || args.connect.connectSource !== "cloud") return;
    void args.loadCloudObjects();
  }, [args.connect.cloudBucket, args.connect.cloudPrefix, args.connect.connectOpen, args.connect.connectSource, args.loadCloudObjects]);

  useEffect(() => {
    args.backend.setResources([]);
    args.backend.setHistory([]);
    args.backend.setDriftAlerts([]);
    args.backend.setPolicyAlerts([]);
    args.backend.setSettingsPayload(null);
    args.backend.setSearch("");
    args.backend.setSelectedBackendId(null);
    args.connect.setConnectOpen(false);
  }, [
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
  scanGithubRepo: () => Promise<void>;
  importGithubRepo: () => Promise<void>;
  scanGitlabRepo: () => Promise<void>;
  importGitlabRepo: () => Promise<void>;
  openGitlabOAuth: () => Promise<void>;
  syncSelectedBackend: () => Promise<void>;
  removeSelectedBackend: () => Promise<void>;
  saveSettings: () => Promise<void>;
  requestFixPlan: (alertId: string) => Promise<void>;
  requestFixAllPlan: () => Promise<void>;
}) {
  return {
    connectOpen: args.connect.connectOpen,
    setConnectOpen: args.connect.setConnectOpen,
    connectSource: args.connect.connectSource,
    setConnectSource: args.connect.setConnectSource,
    connectBusy: args.connect.connectBusy,
    connectError: args.connect.connectError,
    profiles: args.connect.profiles,
    profilesLoading: args.connect.profilesLoading,
    cloudProvider: args.connect.cloudProvider,
    setCloudProvider: args.connect.setCloudProvider,
    cloudProfileId: args.connect.cloudProfileId,
    setCloudProfileId: args.connect.setCloudProfileId,
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
    githubSession: args.connect.githubSession,
    githubRepos: args.connect.githubRepos,
    githubRepo: args.connect.githubRepo,
    setGithubRepo: args.connect.setGithubRepo,
    githubBranch: args.connect.githubBranch,
    setGithubBranch: args.connect.setGithubBranch,
    githubProfileId: args.connect.githubProfileId,
    setGithubProfileId: args.connect.setGithubProfileId,
    githubCandidates: args.connect.githubCandidates,
    githubSelectedCandidates: args.connect.githubSelectedCandidates,
    setGithubSelectedCandidates: args.connect.setGithubSelectedCandidates,
    gitlabSession: args.connect.gitlabSession,
    gitlabRepos: args.connect.gitlabRepos,
    gitlabRepo: args.connect.gitlabRepo,
    setGitlabRepo: args.connect.setGitlabRepo,
    gitlabBranch: args.connect.gitlabBranch,
    setGitlabBranch: args.connect.setGitlabBranch,
    gitlabProfileId: args.connect.gitlabProfileId,
    setGitlabProfileId: args.connect.setGitlabProfileId,
    gitlabCandidates: args.connect.gitlabCandidates,
    gitlabSelectedCandidates: args.connect.gitlabSelectedCandidates,
    setGitlabSelectedCandidates: args.connect.setGitlabSelectedCandidates,
    loadBackends: args.loadBackends,
    loadDetails: args.loadDetails,
    runCloudImport: args.runCloudImport,
    scanGithubRepo: args.scanGithubRepo,
    importGithubRepo: args.importGithubRepo,
    scanGitlabRepo: args.scanGitlabRepo,
    importGitlabRepo: args.importGitlabRepo,
    openGitlabOAuth: args.openGitlabOAuth,
    syncSelectedBackend: args.syncSelectedBackend,
    removeSelectedBackend: args.removeSelectedBackend,
    saveSettings: args.saveSettings,
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
  scanGithubRepo: () => Promise<void>;
  importGithubRepo: () => Promise<void>;
  scanGitlabRepo: () => Promise<void>;
  importGitlabRepo: () => Promise<void>;
  openGitlabOAuth: () => Promise<void>;
  syncSelectedBackend: () => Promise<void>;
  removeSelectedBackend: () => Promise<void>;
  saveSettings: () => Promise<void>;
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
      scanGithubRepo: args.scanGithubRepo,
      importGithubRepo: args.importGithubRepo,
      scanGitlabRepo: args.scanGitlabRepo,
      importGitlabRepo: args.importGitlabRepo,
      openGitlabOAuth: args.openGitlabOAuth,
      syncSelectedBackend: args.syncSelectedBackend,
      removeSelectedBackend: args.removeSelectedBackend,
      saveSettings: args.saveSettings,
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
  const { loadBackends, loadDetails } = useBackendLoaders(projectId, backend);
  const {
    loadProfiles,
    loadCloudBuckets,
    loadCloudObjects,
    loadGithubSource,
    loadGitlabSource,
  } = useConnectLoaders(projectId, connect);
  const {
    openGitlabOAuth,
    runCloudImport,
    scanGithubRepo,
    importGithubRepo,
    scanGitlabRepo,
    importGitlabRepo,
  } = useConnectActions(projectId, pushLog, connect, loadBackends, loadGitlabSource);
  const {
    syncSelectedBackend,
    removeSelectedBackend,
    saveSettings,
    requestFixPlan,
    requestFixAllPlan,
  } = useBackendActions(projectId, pushLog, backend, loadBackends, loadDetails);

  useStateBackendsEffects({
    projectId,
    backend,
    connect,
    loadBackends,
    loadDetails,
    loadProfiles,
    loadCloudBuckets,
    loadCloudObjects,
    loadGithubSource,
    loadGitlabSource,
  });

  return buildStateBackendsResult({
    backend,
    connect,
    selectedBackend,
    loadBackends,
    loadDetails,
    runCloudImport,
    scanGithubRepo,
    importGithubRepo,
    scanGitlabRepo,
    importGitlabRepo,
    openGitlabOAuth,
    syncSelectedBackend,
    removeSelectedBackend,
    saveSettings,
    requestFixPlan,
    requestFixAllPlan,
  });
}
