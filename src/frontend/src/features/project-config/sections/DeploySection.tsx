import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";

export function DeploySection({
  canDeploy,
  disabledReason,
  onOpenDeploy,
}: {
  canDeploy: boolean;
  disabledReason: string;
  onOpenDeploy: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Deploy</CardTitle>
        <CardDescription>Preview modules and run opentofu plan/apply stream.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button className="w-full" onClick={onOpenDeploy} disabled={!canDeploy}>
          Deploy OpenTofu
        </Button>
        <p className="text-xs text-[var(--da-muted)]">{disabledReason || "Project is ready to deploy."}</p>
      </CardContent>
    </Card>
  );
}
