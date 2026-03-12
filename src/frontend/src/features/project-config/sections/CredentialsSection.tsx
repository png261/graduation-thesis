import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import { ProviderBadge } from "../ProviderBadge";
import { formatTelegramTime, telegramPhase } from "../telegramState";
import type { ProjectConfigState } from "../useProjectConfigState";

interface CredentialsSectionProps {
  state: ProjectConfigState;
  provider: string | null | undefined;
}

function CredentialsHeader({ state, provider }: CredentialsSectionProps) {
  return (
    <CardHeader>
      <CardTitle className="text-base">Provider Credentials</CardTitle>
      <CardDescription>
        Current provider: <ProviderBadge provider={state.credentialsProvider ?? provider} />
      </CardDescription>
    </CardHeader>
  );
}

function setCredentialFieldValue(state: ProjectConfigState, key: string, value: string) {
  state.setCredentialFields((fields) => ({ ...fields, [key]: value }));
}

function CredentialFieldInput({ state, keyName, secret, placeholder }: { state: ProjectConfigState; keyName: string; secret?: boolean; placeholder?: string }) {
  const value = state.credentialFields[keyName] ?? "";
  if (keyName === "gcp_credentials_json") {
    return (
      <Textarea className="min-h-32 font-mono text-xs" placeholder="Paste service account JSON" value={value} onChange={(event) => setCredentialFieldValue(state, keyName, event.target.value)} spellCheck={false} />
    );
  }
  return (
    <Input type={secret ? "password" : "text"} placeholder={placeholder ?? (secret ? "********" : "")} value={value} onChange={(event) => setCredentialFieldValue(state, keyName, event.target.value)} autoComplete="off" />
  );
}

function CredentialsFields({ state }: { state: ProjectConfigState }) {
  return (
    <>
      {state.providerFields.map(({ key, label, secret, placeholder }) => (
        <div key={key} className="space-y-1">
          <Label>{label}</Label>
          <CredentialFieldInput state={state} keyName={key} secret={secret} placeholder={placeholder} />
        </div>
      ))}
    </>
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
    <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
      <AlertTitle>Credentials error</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function CredentialsActions({ state }: { state: ProjectConfigState }) {
  return (
    <div className="flex items-center justify-end gap-2">
      {state.credentialsSaved ? <span className="text-xs text-green-300">Saved</span> : null}
      <Button onClick={state.saveCredentials} disabled={state.credentialsSaving || state.providerFields.length < 1}>
        {state.credentialsSaving ? "Saving..." : "Save Credentials"}
      </Button>
    </div>
  );
}

function TelegramPending({ state }: { state: ProjectConfigState }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-md border border-[var(--da-border)] bg-[var(--da-elevated)] p-3 text-xs text-[var(--da-muted)]">
        <p>Connection request pending.</p>
        <p>Expires at: <code className="text-[var(--da-text)]">{formatTelegramTime(state.telegramStatus?.pending_expires_at ?? null)}</code></p>
      </div>
      {state.telegramConnectUrl ? (
        <Button asChild className="w-full">
          <a href={state.telegramConnectUrl} target="_blank" rel="noreferrer">Open Telegram</a>
        </Button>
      ) : null}
      <Button className="w-full" variant="outline" onClick={state.handleConnectTelegram} disabled={state.telegramBusy}>
        {state.telegramBusy ? "Refreshing..." : "Generate New Link"}
      </Button>
    </div>
  );
}

function TelegramConnected({ state }: { state: ProjectConfigState }) {
  const requiresReconnect = Boolean(state.telegramStatus?.requires_reconnect);
  return (
    <>
      <div className="space-y-1 rounded-md border border-[var(--da-border)] bg-[var(--da-elevated)] p-3 text-xs text-[var(--da-muted)]">
        <p>Chat ID: <code className="text-[var(--da-text)]">{state.telegramStatus?.chat_id ?? "-"}</code></p>
        <p>Topic ID: <code className="text-[var(--da-text)]">{state.telegramStatus?.topic_id ?? "-"}</code></p>
        <p>Topic: <code className="text-[var(--da-text)]">{state.telegramStatus?.topic_title ?? "-"}</code></p>
        <p>Connected at: <code className="text-[var(--da-text)]">{formatTelegramTime(state.telegramStatus?.connected_at ?? null)}</code></p>
      </div>
      {requiresReconnect ? (
        <Alert className="border-yellow-500/40 bg-yellow-500/10 text-yellow-100">
          <AlertTitle>Reconnect Required</AlertTitle>
          <AlertDescription>
            Legacy Telegram connection detected. Disconnect and connect again to enable secure topic isolation.
          </AlertDescription>
        </Alert>
      ) : null}
      <Button variant="outline" className="w-full" onClick={state.handleDisconnectTelegram} disabled={state.telegramBusy}>
        {state.telegramBusy ? "Disconnecting..." : "Disconnect Telegram"}
      </Button>
    </>
  );
}

function TelegramDisconnected({ state }: { state: ProjectConfigState }) {
  return (
    <Button className="w-full" onClick={state.handleConnectTelegram} disabled={state.telegramBusy}>
      {state.telegramBusy ? "Connecting..." : "Connect Telegram"}
    </Button>
  );
}

function TelegramContent({ state }: { state: ProjectConfigState }) {
  const phase = telegramPhase(state.telegramStatus);
  if (phase === "loading") return <p className="text-sm text-[var(--da-muted)]">Loading Telegram status...</p>;
  if (phase === "connected") return <TelegramConnected state={state} />;
  if (phase === "pending") return <TelegramPending state={state} />;
  return <TelegramDisconnected state={state} />;
}

function TelegramError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
      <AlertTitle>Telegram error</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function TelegramCard({ state }: { state: ProjectConfigState }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Telegram Notifications</CardTitle>
        <CardDescription>Connect via Telegram group deep-link. Each project uses its own topic.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <TelegramContent state={state} />
        {state.telegramStatus?.warning ? (
          <Alert className="border-yellow-500/40 bg-yellow-500/10 text-yellow-100">
            <AlertTitle>Telegram warning</AlertTitle>
            <AlertDescription>{state.telegramStatus.warning}</AlertDescription>
          </Alert>
        ) : null}
        <TelegramError error={state.telegramError} />
      </CardContent>
    </Card>
  );
}

export function CredentialsSection(props: CredentialsSectionProps) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Card>
        <CredentialsHeader {...props} />
        <CardContent className="space-y-3">
          <CredentialsLoadState state={props.state} />
          <CredentialsFields state={props.state} />
          <CredentialsError error={props.state.credentialsError} />
          <CredentialsActions state={props.state} />
        </CardContent>
      </Card>
      <TelegramCard state={props.state} />
    </div>
  );
}
