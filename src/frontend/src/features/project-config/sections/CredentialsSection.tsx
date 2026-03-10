import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import { ProviderBadge } from "../ProviderBadge";
import type { ProjectConfigState } from "../useProjectConfigState";

export function CredentialsSection({
  state,
  provider,
}: {
  state: ProjectConfigState;
  provider: string | null | undefined;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider Credentials</CardTitle>
          <CardDescription>
            Current provider: <ProviderBadge provider={state.credentialsProvider ?? provider} />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.credentialsLoading && <p className="text-sm text-[var(--da-muted)]">Loading...</p>}
          {!state.credentialsLoading && state.providerFields.length === 0 && (
            <Alert>
              <AlertTitle>No provider configured</AlertTitle>
              <AlertDescription>Create a project with cloud provider first.</AlertDescription>
            </Alert>
          )}

          {state.providerFields.map(({ key, label, secret, placeholder }) => (
            <div key={key} className="space-y-1">
              <Label>{label}</Label>
              {key === "gcp_credentials_json" ? (
                <Textarea
                  className="min-h-32 font-mono text-xs"
                  placeholder="Paste service account JSON"
                  value={state.credentialFields[key] ?? ""}
                  onChange={(e) => state.setCredentialFields((fields) => ({ ...fields, [key]: e.target.value }))}
                  spellCheck={false}
                />
              ) : (
                <Input
                  type={secret ? "password" : "text"}
                  placeholder={placeholder ?? (secret ? "********" : "")}
                  value={state.credentialFields[key] ?? ""}
                  onChange={(e) => state.setCredentialFields((fields) => ({ ...fields, [key]: e.target.value }))}
                  autoComplete="off"
                />
              )}
            </div>
          ))}

          {state.credentialsError && (
            <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
              <AlertTitle>Credentials error</AlertTitle>
              <AlertDescription>{state.credentialsError}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-end gap-2">
            {state.credentialsSaved && <span className="text-xs text-green-300">Saved</span>}
            <Button onClick={state.saveCredentials} disabled={state.credentialsSaving || state.providerFields.length === 0}>
              {state.credentialsSaving ? "Saving..." : "Save Credentials"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
