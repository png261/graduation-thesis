import { Cloud, Database, GitBranch, Gitlab, RefreshCw, ShieldAlert, ShieldCheck, Zap } from "lucide-react";

import type {
  CredentialProfile,
  DriftAlert,
  GitHubRepo,
  GitHubSession,
  GitLabRepo,
  GitLabSession,
  PolicyAlert,
  ProjectDeployDriftSummary,
  StateBackend,
  StateBackendImportCandidate,
  StateBackendSettings,
  StateHistoryItem,
  StateResource,
} from "../../../api/projects";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";

type BackendTab = "resources" | "history" | "drift" | "policy" | "settings";
type ConnectSource = "cloud" | "github" | "gitlab";

function AlertStatus({ status }: { status: string }) {
  const tone = status === "drifted" ? "text-red-300" : status === "unverifiable" ? "text-amber-300" : "text-emerald-300";
  return <span className={`rounded border border-white/10 px-2 py-0.5 text-xs uppercase ${tone}`}>{status}</span>;
}

function SourceIcon({ source }: { source: string }) {
  if (source === "github") return <GitBranch className="h-4 w-4" />;
  if (source === "gitlab") return <Gitlab className="h-4 w-4" />;
  return <Cloud className="h-4 w-4" />;
}

function isPrimaryDeployBackend(backend: StateBackend | null) {
  return backend?.settings["primary_for_deploy"] === true;
}

function readinessTone(summary: ProjectDeployDriftSummary | null) {
  if (!summary) return "text-[var(--da-muted)]";
  if (summary.blocking) return "text-amber-300";
  return "text-emerald-300";
}

function freshnessLabel(summary: ProjectDeployDriftSummary | null) {
  if (!summary) return "-";
  if (summary.freshness_minutes === null) return "Unknown";
  return `${summary.freshness_minutes} minute${summary.freshness_minutes === 1 ? "" : "s"}`;
}

function lastRefreshLabel(summary: ProjectDeployDriftSummary | null) {
  if (!summary?.last_successful_refresh_at) return "Never";
  return new Date(summary.last_successful_refresh_at).toLocaleString();
}

function ReadinessMetric(props: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-2">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--da-muted)]">{props.label}</p>
      <p className="mt-1 text-sm text-white">{props.value}</p>
    </div>
  );
}

function DeployDriftReadinessCard(props: {
  summary: ProjectDeployDriftSummary | null;
  loading: boolean;
  error: string;
}) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold">Deploy Drift Readiness</p>
          <p className={`text-xs ${readinessTone(props.summary)}`}>
            {props.error || props.summary?.reason || (props.loading ? "Refreshing deploy drift summary..." : "No deploy drift summary yet.")}
          </p>
        </div>
        {props.summary ? (
          <span className={`rounded border border-white/10 px-2 py-0.5 text-xs uppercase ${readinessTone(props.summary)}`}>
            {props.summary.blocking ? "Blocked" : "Ready"}
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <ReadinessMetric label="Status" value={props.summary?.status || "-"} />
        <ReadinessMetric label="Primary Backend" value={props.summary?.primary_backend?.name || "Not configured"} />
        <ReadinessMetric label="Last Refresh" value={lastRefreshLabel(props.summary)} />
        <ReadinessMetric label="Freshness" value={freshnessLabel(props.summary)} />
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <ReadinessMetric label="Drift Alerts" value={props.summary?.active_drift_alert_count ?? 0} />
        <ReadinessMetric label="Source" value={props.summary?.source || "-"} />
      </div>
      {props.summary?.source === "local_runtime_fallback" ? (
        <p className="mt-3 rounded border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Local runtime fallback only
        </p>
      ) : null}
    </div>
  );
}

export function StateBackendsSidebarPanel(props: {
  backends: StateBackend[];
  loading: boolean;
  error: string;
  selectedBackendId: string | null;
  onSelectBackend: (id: string) => void;
  onRefresh: () => void;
  onOpenConnect: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[var(--da-border)] bg-[#0e121b]">
      <div className="space-y-2 border-b border-[var(--da-border)] p-3">
        <Button size="sm" className="w-full" onClick={props.onOpenConnect}>Connect State Backend</Button>
        <Button size="sm" variant="outline" className="w-full" onClick={props.onRefresh}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {props.loading ? <p className="px-2 py-3 text-xs text-[var(--da-muted)]">Loading backends...</p> : null}
        {props.error ? <p className="px-2 py-3 text-xs text-red-300">{props.error}</p> : null}
        {props.backends.map((backend) => (
          <button
            key={backend.id}
            type="button"
            onClick={() => props.onSelectBackend(backend.id)}
            className={`mb-2 w-full rounded border px-2 py-2 text-left ${props.selectedBackendId === backend.id ? "border-blue-400/50 bg-blue-500/10" : "border-white/10 bg-black/20 hover:bg-black/35"}`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold">{backend.name}</p>
              <SourceIcon source={backend.source_type} />
            </div>
            <p className="truncate text-xs text-[var(--da-muted)]">{backend.provider.toUpperCase()} · {backend.bucket_name || backend.repository || "-"}</p>
            <p className="truncate text-xs text-[var(--da-muted)]">{backend.object_key || backend.path || backend.object_prefix || "-"}</p>
            <p className="mt-1 text-xs text-[var(--da-muted)]">{backend.last_sync_at ? `Synced ${new Date(backend.last_sync_at).toLocaleString()}` : "Never synced"}</p>
          </button>
        ))}
        {!props.loading && props.backends.length < 1 ? <p className="px-2 py-3 text-xs text-[var(--da-muted)]">No state backends yet.</p> : null}
      </div>
    </div>
  );
}

function ResourceTable(props: { items: StateResource[] }) {
  return (
    <div className="overflow-auto rounded border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/10 bg-white/[0.03] text-white/70">
          <tr>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Resource</th>
            <th className="px-3 py-2">Provider</th>
            <th className="px-3 py-2">Console Link</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <tr key={item.id} className="border-b border-white/5 align-top text-xs">
              <td className="px-3 py-2"><AlertStatus status={item.status} /></td>
              <td className="px-3 py-2">
                <p className="font-mono text-white">{item.address}</p>
                <pre className="mt-1 overflow-auto rounded bg-black/30 p-2 text-[11px] text-white/70">{JSON.stringify(item.attributes, null, 2)}</pre>
              </td>
              <td className="px-3 py-2">{item.provider || "-"}</td>
              <td className="px-3 py-2">
                {item.console_url ? (
                  <a className="text-blue-300 underline" href={item.console_url} target="_blank" rel="noreferrer">Open</a>
                ) : (
                  <span className="text-white/35">Unavailable</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable(props: { items: StateHistoryItem[] }) {
  return (
    <div className="overflow-auto rounded border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/10 bg-white/[0.03] text-white/70">
          <tr>
            <th className="px-3 py-2">Version</th>
            <th className="px-3 py-2">Resources</th>
            <th className="px-3 py-2">+/-/~</th>
            <th className="px-3 py-2">Synced At</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <tr key={item.id} className="border-b border-white/5 text-xs">
              <td className="px-3 py-2 font-mono">{item.version || item.etag || item.id.slice(0, 8)}</td>
              <td className="px-3 py-2">{item.resource_count}</td>
              <td className="px-3 py-2">+{item.added} / -{item.deleted} / ~{item.changed}</td>
              <td className="px-3 py-2">{item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DriftTable(props: { items: DriftAlert[]; onFix: (alertId: string) => void; onFixAll: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="outline" onClick={props.onFixAll}>
          <Zap className="mr-1 h-3.5 w-3.5" />Fix All Drift
        </Button>
      </div>
      <div className="overflow-auto rounded border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 bg-white/[0.03] text-white/70">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Resource</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.items.map((item) => (
              <tr key={item.id} className="border-b border-white/5 text-xs">
                <td className="px-3 py-2"><AlertStatus status={item.status} /></td>
                <td className="px-3 py-2 font-mono">{item.resource_address}</td>
                <td className="px-3 py-2">{item.severity}</td>
                <td className="px-3 py-2">
                  <Button size="sm" variant="outline" onClick={() => props.onFix(item.id)}>Fix drift</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PolicyTable(props: { items: PolicyAlert[] }) {
  return (
    <div className="overflow-auto rounded border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/10 bg-white/[0.03] text-white/70">
          <tr>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Rule</th>
            <th className="px-3 py-2">Resource</th>
            <th className="px-3 py-2">Severity</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <tr key={item.id} className="border-b border-white/5 text-xs">
              <td className="px-3 py-2"><AlertStatus status={item.status} /></td>
              <td className="px-3 py-2">{item.rule_id}</td>
              <td className="px-3 py-2 font-mono">{item.resource_address}</td>
              <td className="px-3 py-2">{item.severity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsPanel(props: {
  payload: StateBackendSettings | null;
  onChange: (next: StateBackendSettings) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  if (!props.payload) return <p className="text-sm text-[var(--da-muted)]">Loading settings...</p>;
  const backend = props.payload.backend;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>Backend Name</span>
          <Input value={backend.name} onChange={(event) => props.onChange({ ...props.payload!, backend: { ...backend, name: event.target.value } })} />
        </label>
        <label className="space-y-1 text-sm">
          <span>Sync Interval (minutes)</span>
          <Input
            type="number"
            value={backend.schedule_minutes}
            onChange={(event) => props.onChange({ ...props.payload!, backend: { ...backend, schedule_minutes: Number(event.target.value || 60) } })}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>Retention (days)</span>
          <Input
            type="number"
            value={backend.retention_days}
            onChange={(event) => props.onChange({ ...props.payload!, backend: { ...backend, retention_days: Number(event.target.value || 90) } })}
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={props.onDelete}>Delete Backend</Button>
        <Button onClick={props.onSave}>Save Settings</Button>
      </div>
      <div className="rounded border border-white/10 p-2 text-xs text-white/70">
        <p className="font-semibold">Recent Sync Runs</p>
        <div className="mt-2 space-y-1">
          {props.payload.sync_runs.map((run) => (
            <p key={run.id}>{run.status} · {run.triggered_by} · {run.created_at ? new Date(run.created_at).toLocaleString() : "-"}</p>
          ))}
          {props.payload.sync_runs.length < 1 ? <p>No sync runs yet.</p> : null}
        </div>
      </div>
    </div>
  );
}

function CandidateList(props: {
  candidates: StateBackendImportCandidate[];
  selected: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}) {
  if (props.candidates.length < 1) return null;
  return (
    <div className="space-y-1 rounded border border-white/10 p-2 text-xs">
      <p className="font-semibold">Discovered Backend Configs</p>
      {props.candidates.map((item) => (
        <label key={item.name} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(props.selected[item.name])}
            onChange={(event) =>
              props.onChange({
                ...props.selected,
                [item.name]: event.target.checked,
              })
            }
          />
          <span>{item.name} ({item.bucket}/{item.key || item.prefix || "-"})</span>
        </label>
      ))}
    </div>
  );
}

function CloudConnectPanel(props: {
  profiles: CredentialProfile[];
  provider: "aws" | "gcs";
  setProvider: (provider: "aws" | "gcs") => void;
  profileId: string;
  setProfileId: (value: string) => void;
  name: string;
  setName: (value: string) => void;
  bucket: string;
  setBucket: (value: string) => void;
  prefix: string;
  setPrefix: (value: string) => void;
  key: string;
  setKey: (value: string) => void;
  buckets: string[];
  objects: Array<{ key: string; size: number; updated_at: string | null }>;
}) {
  const providerProfiles = props.profiles.filter((row) => row.provider === props.provider);
  return (
    <div className="space-y-2">
      <label className="space-y-1 text-sm">
        <span>Provider</span>
        <select className="h-9 w-full rounded border border-white/15 bg-black/30 px-2" value={props.provider} onChange={(event) => props.setProvider(event.target.value as "aws" | "gcs")}> 
          <option value="aws">AWS S3</option>
          <option value="gcs">Google Cloud Storage</option>
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span>Credential Profile</span>
        <select className="h-9 w-full rounded border border-white/15 bg-black/30 px-2" value={props.profileId} onChange={(event) => props.setProfileId(event.target.value)}>
          <option value="">Select profile</option>
          {providerProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span>Backend Name</span>
        <Input value={props.name} onChange={(event) => props.setName(event.target.value)} placeholder="My Terraform State" />
      </label>
      <label className="space-y-1 text-sm">
        <span>Bucket</span>
        <select className="h-9 w-full rounded border border-white/15 bg-black/30 px-2" value={props.bucket} onChange={(event) => props.setBucket(event.target.value)}>
          <option value="">Select bucket</option>
          {props.buckets.map((bucket) => <option key={bucket} value={bucket}>{bucket}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span>Prefix (Optional)</span>
        <Input value={props.prefix} onChange={(event) => props.setPrefix(event.target.value)} placeholder="states/" />
      </label>
      <label className="space-y-1 text-sm">
        <span>State Object Key</span>
        <select className="h-9 w-full rounded border border-white/15 bg-black/30 px-2" value={props.key} onChange={(event) => props.setKey(event.target.value)}>
          <option value="">Auto select first *.tfstate</option>
          {props.objects.map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}
        </select>
      </label>
    </div>
  );
}

function SourceControlPanel(props: {
  source: "github" | "gitlab";
  profiles: CredentialProfile[];
  session: GitHubSession | GitLabSession;
  repos: GitHubRepo[] | GitLabRepo[];
  repo: string;
  setRepo: (value: string) => void;
  branch: string;
  setBranch: (value: string) => void;
  profileId: string;
  setProfileId: (value: string) => void;
  onScan: () => void;
  onImport: () => void;
  onConnectGitlab: () => void;
  candidates: StateBackendImportCandidate[];
  selectedCandidates: Record<string, boolean>;
  setSelectedCandidates: (next: Record<string, boolean>) => void;
}) {
  const profileOptions = props.profiles;
  return (
    <div className="space-y-2">
      {props.source === "gitlab" && !props.session.authenticated ? (
        <Button variant="outline" className="w-full" onClick={props.onConnectGitlab}>Connect GitLab</Button>
      ) : null}
      <label className="space-y-1 text-sm">
        <span>Credential Profile (Cloud Access)</span>
        <select className="h-9 w-full rounded border border-white/15 bg-black/30 px-2" value={props.profileId} onChange={(event) => props.setProfileId(event.target.value)}>
          <option value="">Select profile</option>
          {profileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} ({profile.provider})</option>)}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span>Repository</span>
        <select className="h-9 w-full rounded border border-white/15 bg-black/30 px-2" value={props.repo} onChange={(event) => props.setRepo(event.target.value)}>
          <option value="">Select repository</option>
          {props.repos.map((repo) => <option key={repo.full_name} value={repo.full_name}>{repo.full_name}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span>Branch</span>
        <Input value={props.branch} onChange={(event) => props.setBranch(event.target.value)} placeholder="main" />
      </label>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={props.onScan}>Scan Repository</Button>
        <Button className="flex-1" onClick={props.onImport}>Import Selected</Button>
      </div>
      <CandidateList candidates={props.candidates} selected={props.selectedCandidates} onChange={props.setSelectedCandidates} />
    </div>
  );
}

type StateBackendsConnectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: ConnectSource;
  onSourceChange: (source: ConnectSource) => void;
  busy: boolean;
  error: string;
  profiles: CredentialProfile[];
  profilesLoading: boolean;
  cloudProvider: "aws" | "gcs";
  setCloudProvider: (provider: "aws" | "gcs") => void;
  cloudProfileId: string;
  setCloudProfileId: (value: string) => void;
  cloudName: string;
  setCloudName: (value: string) => void;
  cloudBucket: string;
  setCloudBucket: (value: string) => void;
  cloudPrefix: string;
  setCloudPrefix: (value: string) => void;
  cloudKey: string;
  setCloudKey: (value: string) => void;
  cloudBuckets: string[];
  cloudObjects: Array<{ key: string; size: number; updated_at: string | null }>;
  githubSession: GitHubSession;
  githubRepos: GitHubRepo[];
  githubRepo: string;
  setGithubRepo: (value: string) => void;
  githubBranch: string;
  setGithubBranch: (value: string) => void;
  githubProfileId: string;
  setGithubProfileId: (value: string) => void;
  githubCandidates: StateBackendImportCandidate[];
  githubSelectedCandidates: Record<string, boolean>;
  setGithubSelectedCandidates: (next: Record<string, boolean>) => void;
  gitlabSession: GitLabSession;
  gitlabRepos: GitLabRepo[];
  gitlabRepo: string;
  setGitlabRepo: (value: string) => void;
  gitlabBranch: string;
  setGitlabBranch: (value: string) => void;
  gitlabProfileId: string;
  setGitlabProfileId: (value: string) => void;
  gitlabCandidates: StateBackendImportCandidate[];
  gitlabSelectedCandidates: Record<string, boolean>;
  setGitlabSelectedCandidates: (next: Record<string, boolean>) => void;
  onRunCloudImport: () => void;
  onScanGitHub: () => void;
  onImportGitHub: () => void;
  onConnectGitlab: () => void;
  onScanGitLab: () => void;
  onImportGitLab: () => void;
};

export function StateBackendsConnectDialog(props: StateBackendsConnectDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-3xl border border-white/10 bg-[#0b0e14] text-white">
        <DialogHeader>
          <DialogTitle>Connect State Backend</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <ConnectSourceSelector source={props.source} onSourceChange={props.onSourceChange} />
          {props.profilesLoading ? <p className="text-xs text-[var(--da-muted)]">Loading credential profiles...</p> : null}
          <ConnectSourceContent props={props} />
          {props.error ? <p className="text-sm text-red-300">{props.error}</p> : null}
          <ConnectDialogActions source={props.source} busy={props.busy} onRunCloudImport={props.onRunCloudImport} onClose={() => props.onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConnectSourceSelector(props: {
  source: ConnectSource;
  onSourceChange: (source: ConnectSource) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <button type="button" onClick={() => props.onSourceChange("cloud")} className={`rounded border px-3 py-2 text-sm ${props.source === "cloud" ? "border-blue-400/60 bg-blue-500/10" : "border-white/10 bg-black/20"}`}>
        <Database className="mb-1 inline h-4 w-4" /> Cloud Storage
      </button>
      <button type="button" onClick={() => props.onSourceChange("github")} className={`rounded border px-3 py-2 text-sm ${props.source === "github" ? "border-blue-400/60 bg-blue-500/10" : "border-white/10 bg-black/20"}`}>
        <GitBranch className="mb-1 inline h-4 w-4" /> GitHub
      </button>
      <button type="button" onClick={() => props.onSourceChange("gitlab")} className={`rounded border px-3 py-2 text-sm ${props.source === "gitlab" ? "border-blue-400/60 bg-blue-500/10" : "border-white/10 bg-black/20"}`}>
        <Gitlab className="mb-1 inline h-4 w-4" /> GitLab
      </button>
    </div>
  );
}

function ConnectSourceContent({ props }: { props: StateBackendsConnectDialogProps }) {
  if (props.source === "cloud") {
    return (
      <CloudConnectPanel
        profiles={props.profiles}
        provider={props.cloudProvider}
        setProvider={props.setCloudProvider}
        profileId={props.cloudProfileId}
        setProfileId={props.setCloudProfileId}
        name={props.cloudName}
        setName={props.setCloudName}
        bucket={props.cloudBucket}
        setBucket={props.setCloudBucket}
        prefix={props.cloudPrefix}
        setPrefix={props.setCloudPrefix}
        key={props.cloudKey}
        setKey={props.setCloudKey}
        buckets={props.cloudBuckets}
        objects={props.cloudObjects}
      />
    );
  }
  if (props.source === "github") {
    return (
      <SourceControlPanel
        source="github"
        profiles={props.profiles}
        session={props.githubSession}
        repos={props.githubRepos}
        repo={props.githubRepo}
        setRepo={props.setGithubRepo}
        branch={props.githubBranch}
        setBranch={props.setGithubBranch}
        profileId={props.githubProfileId}
        setProfileId={props.setGithubProfileId}
        onScan={props.onScanGitHub}
        onImport={props.onImportGitHub}
        onConnectGitlab={props.onConnectGitlab}
        candidates={props.githubCandidates}
        selectedCandidates={props.githubSelectedCandidates}
        setSelectedCandidates={props.setGithubSelectedCandidates}
      />
    );
  }
  return (
    <SourceControlPanel
      source="gitlab"
      profiles={props.profiles}
      session={props.gitlabSession}
      repos={props.gitlabRepos}
      repo={props.gitlabRepo}
      setRepo={props.setGitlabRepo}
      branch={props.gitlabBranch}
      setBranch={props.setGitlabBranch}
      profileId={props.gitlabProfileId}
      setProfileId={props.setGitlabProfileId}
      onScan={props.onScanGitLab}
      onImport={props.onImportGitLab}
      onConnectGitlab={props.onConnectGitlab}
      candidates={props.gitlabCandidates}
      selectedCandidates={props.gitlabSelectedCandidates}
      setSelectedCandidates={props.setGitlabSelectedCandidates}
    />
  );
}

function ConnectDialogActions(props: {
  source: ConnectSource;
  busy: boolean;
  onRunCloudImport: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      {props.source === "cloud" ? <Button disabled={props.busy} onClick={props.onRunCloudImport}>Import Cloud Backend</Button> : null}
      <Button variant="outline" onClick={props.onClose}>Cancel</Button>
    </div>
  );
}

export function StateBackendsMainPanel(props: {
  backend: StateBackend | null;
  deployDriftSummary: ProjectDeployDriftSummary | null;
  deployDriftLoading: boolean;
  deployDriftError: string;
  activeTab: BackendTab;
  onTabChange: (tab: BackendTab) => void;
  loading: boolean;
  error: string;
  search: string;
  onSearch: (value: string) => void;
  activeOnly: boolean;
  onActiveOnly: (value: boolean) => void;
  showSensitive: boolean;
  onShowSensitive: (value: boolean) => void;
  resources: StateResource[];
  history: StateHistoryItem[];
  driftAlerts: DriftAlert[];
  policyAlerts: PolicyAlert[];
  settingsPayload: StateBackendSettings | null;
  onSettingsChange: (value: StateBackendSettings) => void;
  onSync: () => void;
  onSetPrimary: (backendId: string) => void;
  onSaveSettings: () => void;
  onDeleteBackend: () => void;
  onFixPlan: (alertId: string) => void;
  onFixAll: () => void;
}) {
  if (!props.backend) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[#0a0f17] p-3">
        <DeployDriftReadinessCard
          summary={props.deployDriftSummary}
          loading={props.deployDriftLoading}
          error={props.deployDriftError}
        />
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--da-muted)]">
          Select or connect a state backend.
        </div>
      </div>
    );
  }
  const backend = props.backend;
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0f17]">
      <div className="space-y-3 border-b border-[var(--da-border)] p-3">
        <DeployDriftReadinessCard
          summary={props.deployDriftSummary}
          loading={props.deployDriftLoading}
          error={props.deployDriftError}
        />
        <StateBackendHeader
          backend={backend}
          primaryForDeploy={isPrimaryDeployBackend(backend)}
          onSync={props.onSync}
          onSetPrimary={() => props.onSetPrimary(backend.id)}
        />
        <StateBackendTabs activeTab={props.activeTab} onTabChange={props.onTabChange} />
        <StateBackendFilters
          search={props.search}
          onSearch={props.onSearch}
          activeOnly={props.activeOnly}
          onActiveOnly={props.onActiveOnly}
          showSensitive={props.showSensitive}
          onShowSensitive={props.onShowSensitive}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <StateBackendTabContent props={props} />
      </div>
    </div>
  );
}

function StateBackendHeader(props: {
  backend: StateBackend;
  primaryForDeploy: boolean;
  onSync: () => void;
  onSetPrimary: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-lg font-semibold">{props.backend.name}</p>
        <p className="text-xs text-[var(--da-muted)]">{props.backend.provider.toUpperCase()} · {props.backend.source_type} · Last sync: {props.backend.last_sync_at ? new Date(props.backend.last_sync_at).toLocaleString() : "never"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {props.primaryForDeploy ? (
          <Button size="sm" variant="secondary" disabled>Primary for Deploy</Button>
        ) : (
          <Button size="sm" variant="outline" onClick={props.onSetPrimary}>Use for Deploy Decisions</Button>
        )}
        <Button size="sm" onClick={props.onSync}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh Drift Status</Button>
      </div>
    </div>
  );
}

function tabIcon(tab: BackendTab) {
  if (tab === "resources") return <Database className="mr-1 inline h-3 w-3" />;
  if (tab === "history") return <RefreshCw className="mr-1 inline h-3 w-3" />;
  if (tab === "drift") return <ShieldAlert className="mr-1 inline h-3 w-3" />;
  if (tab === "policy") return <ShieldCheck className="mr-1 inline h-3 w-3" />;
  return null;
}

function StateBackendTabs(props: {
  activeTab: BackendTab;
  onTabChange: (tab: BackendTab) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["resources", "history", "drift", "policy", "settings"] as BackendTab[]).map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => props.onTabChange(tab)}
          className={`rounded border px-2 py-1 text-xs uppercase ${props.activeTab === tab ? "border-blue-400/60 bg-blue-500/10" : "border-white/10 bg-black/20"}`}
        >
          {tabIcon(tab)}
          {tab}
        </button>
      ))}
    </div>
  );
}

function StateBackendFilters(props: {
  search: string;
  onSearch: (value: string) => void;
  activeOnly: boolean;
  onActiveOnly: (value: boolean) => void;
  showSensitive: boolean;
  onShowSensitive: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input className="max-w-md" placeholder="Search..." value={props.search} onChange={(event) => props.onSearch(event.target.value)} />
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={props.activeOnly} onChange={(event) => props.onActiveOnly(event.target.checked)} />
        Active only
      </label>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={props.showSensitive} onChange={(event) => props.onShowSensitive(event.target.checked)} />
        Show sensitive fields
      </label>
    </div>
  );
}

function StateBackendTabContent(props: {
  props: {
    activeTab: BackendTab;
    loading: boolean;
    error: string;
    resources: StateResource[];
    history: StateHistoryItem[];
    driftAlerts: DriftAlert[];
    policyAlerts: PolicyAlert[];
    settingsPayload: StateBackendSettings | null;
    onSettingsChange: (value: StateBackendSettings) => void;
    onSaveSettings: () => void;
    onDeleteBackend: () => void;
    onFixPlan: (alertId: string) => void;
    onFixAll: () => void;
  };
}) {
  if (props.props.loading) return <p className="text-sm text-[var(--da-muted)]">Loading...</p>;
  return (
    <>
      {props.props.error ? <p className="mb-3 text-sm text-red-300">{props.props.error}</p> : null}
      {props.props.activeTab === "resources" ? <ResourceTable items={props.props.resources} /> : null}
      {props.props.activeTab === "history" ? <HistoryTable items={props.props.history} /> : null}
      {props.props.activeTab === "drift" ? <DriftTable items={props.props.driftAlerts} onFix={props.props.onFixPlan} onFixAll={props.props.onFixAll} /> : null}
      {props.props.activeTab === "policy" ? <PolicyTable items={props.props.policyAlerts} /> : null}
      {props.props.activeTab === "settings" ? <SettingsPanel payload={props.props.settingsPayload} onChange={props.props.onSettingsChange} onSave={props.props.onSaveSettings} onDelete={props.props.onDeleteBackend} /> : null}
    </>
  );
}
