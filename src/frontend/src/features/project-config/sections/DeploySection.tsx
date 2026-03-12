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
        <CardDescription>Plan/apply infrastructure, then run post-provision Ansible configuration.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button className="w-full" onClick={onOpenDeploy} disabled={!canDeploy}>
          Deploy Infrastructure + Config
        </Button>
        <p className="text-xs text-[var(--da-muted)]">{disabledReason || "Project is ready to deploy."}</p>
      </CardContent>
    </Card>
  );
}
