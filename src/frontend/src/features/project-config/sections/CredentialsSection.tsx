import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import { ProviderBadge } from "../ProviderBadge";
import type { ProjectConfigState } from "../useProjectConfigState";

interface CredentialsSectionProps {
  state: ProjectConfigState;
  provider: string | null | undefined;
}

function setProfileFieldValue(state: ProjectConfigState, key: string, value: string) {
  state.setProfileFields((fields) => ({ ...fields, [key]: value }));
}

function ProfileFieldInput(props: {
  state: ProjectConfigState;
  keyName: string;
  secret?: boolean;
  placeholder?: string;
}) {
  const value = props.state.profileFields[props.keyName] ?? "";
  if (props.keyName === "gcp_credentials_json") {
    return (
      <Textarea
        className="min-h-32 font-mono text-xs"
        placeholder="Paste service account JSON"
        value={value}
        onChange={(event) => setProfileFieldValue(props.state, props.keyName, event.target.value)}
        spellCheck={false}
      />
    );
  }
  return (
    <Input
      type={props.secret ? "password" : "text"}
      placeholder={props.placeholder ?? (props.secret ? "********" : "")}
      value={value}
      onChange={(event) => setProfileFieldValue(props.state, props.keyName, event.target.value)}
      autoComplete="off"
    />
  );
}

function CredentialsHeader(props: CredentialsSectionProps) {
  return (
    <CardHeader>
      <CardTitle className="text-base">Credential Profiles</CardTitle>
      <CardDescription>
        Current provider: <ProviderBadge provider={props.state.credentialsProvider ?? props.provider} />
      </CardDescription>
    </CardHeader>
  );
}

function CredentialsLoadState({ state }: { state: ProjectConfigState }) {
  if (state.credentialsLoading) return <p className="text-sm text-[var(--da-muted)]">Loading...</p>;
  if (state.providerFields.length > 0) return null;
  return (
    <Alert>
      <AlertTitle>No provider configured</AlertTitle>
      <AlertDescription>Create a project with cloud provider first.</AlertDescription>
    </Alert>
  );
}

function CredentialsError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Alert className="border-red-500/40 bg-red-500/10 text-red-700">
      <AlertTitle>Credential profile error</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function SelectedProfileStatus({ state }: { state: ProjectConfigState }) {
  if (state.credentialsLoading || state.providerFields.length < 1) return null;
  if (state.missingCredentialFields.length > 0) {
    return (
      <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-700">
        <AlertTitle>Selected project profile is missing required fields</AlertTitle>
        <AlertDescription className="flex flex-wrap gap-2">
          {state.missingCredentialFields.map((field) => (
            <code key={field} className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
              {field}
            </code>
          ))}
        </AlertDescription>
      </Alert>
    );
  }
  if (!state.applyReady || !state.appliedCredentialProfileId) return null;
  return (
    <Badge className="bg-green-500/20 text-green-200 hover:bg-green-500/20">
      Selected profile is ready for OpenTofu apply and destroy
    </Badge>
  );
}

function ProfileSelector({ state }: { state: ProjectConfigState }) {
  if (state.providerFields.length < 1) return null;
  return (
    <div className="space-y-2 rounded border border-[var(--da-border)] p-3">
      <div>
        <p className="text-sm font-medium">Project provisioning profile</p>
        <p className="text-xs text-[var(--da-muted)]">
          OpenTofu and deploy checks use the saved profile selected here.
        </p>
      </div>
      <label className="space-y-1 text-sm">
        <span>Saved profile</span>
        <select
          className="h-9 w-full rounded border border-[var(--da-border)] bg-[var(--da-panel)] px-2"
          value={state.selectedCredentialProfileId}
          onChange={(event) => state.setSelectedCredentialProfileId(event.target.value)}
        >
          <option value="">Select profile</option>
          {state.credentialProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--da-muted)]">
        <span>
          Applied profile: {state.appliedCredentialProfile?.name ?? state.appliedCredentialProfileId ?? "none"}
        </span>
        <div className="flex items-center gap-2">
          {state.credentialsSaved ? <span className="text-green-300">Saved</span> : null}
          <Button onClick={state.saveCredentials} disabled={state.credentialsSaving || !state.selectedCredentialProfileId}>
            {state.credentialsSaving ? "Saving..." : "Use For Project"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateProfileForm({ state }: { state: ProjectConfigState }) {
  if (state.providerFields.length < 1) return null;
  return (
    <div className="space-y-3 rounded border border-[var(--da-border)] p-3">
      <div>
        <p className="text-sm font-medium">Add credential profile</p>
        <p className="text-xs text-[var(--da-muted)]">
          Create reusable profiles for state backend discovery and provisioning.
        </p>
      </div>
      <div className="space-y-1">
        <Label>Profile Name</Label>
        <Input value={state.profileName} onChange={(event) => state.setProfileName(event.target.value)} placeholder="Production AWS" />
      </div>
      {state.providerFields.map(({ key, label, secret, placeholder }) => (
        <div key={key} className="space-y-1">
          <Label>{label}</Label>
          <ProfileFieldInput state={state} keyName={key} secret={secret} placeholder={placeholder} />
        </div>
      ))}
      <div className="flex justify-end">
        <Button onClick={state.createProfile} disabled={state.credentialsSaving}>
          {state.credentialsSaving ? "Saving..." : "Add Profile"}
        </Button>
      </div>
    </div>
  );
}

function ProfileList({ state }: { state: ProjectConfigState }) {
  if (state.providerFields.length < 1) return null;
  return (
    <div className="space-y-2 rounded border border-[var(--da-border)] p-3">
      <div>
        <p className="text-sm font-medium">Saved profiles</p>
        <p className="text-xs text-[var(--da-muted)]">These profiles can be reused in state backend connect flows.</p>
      </div>
      <div className="space-y-2">
        {state.credentialProfiles.map((profile) => (
          <div key={profile.id} className="rounded border border-[var(--da-border)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{profile.name}</p>
                <p className="text-xs text-[var(--da-muted)]">
                  Updated {new Date(profile.updated_at).toLocaleString()}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--da-muted)]">
                  {Object.entries(profile.credentials).map(([key, value]) => (
                    <span key={key} className="rounded bg-[var(--da-elevated)] px-2 py-1">
                      {key}: {value}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {state.appliedCredentialProfileId === profile.id ? <Badge variant="outline">In Use</Badge> : null}
                <Button
                  variant="outline"
                  onClick={() => state.removeProfile(profile.id)}
                  disabled={state.profileDeletingId === profile.id}
                >
                  {state.profileDeletingId === profile.id ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </div>
          </div>
        ))}
        {state.credentialProfiles.length < 1 ? (
          <p className="text-sm text-[var(--da-muted)]">No saved profiles yet.</p>
        ) : null}
      </div>
    </div>
  );
}

export function CredentialsSection(props: CredentialsSectionProps) {
  return (
    <div>
      <Card>
        <CredentialsHeader {...props} />
        <CardContent className="space-y-3">
          <CredentialsLoadState state={props.state} />
          <CredentialsError error={props.state.credentialsError} />
          <ProfileSelector state={props.state} />
          <SelectedProfileStatus state={props.state} />
          <CreateProfileForm state={props.state} />
          <ProfileList state={props.state} />
        </CardContent>
      </Card>
    </div>
  );
}
