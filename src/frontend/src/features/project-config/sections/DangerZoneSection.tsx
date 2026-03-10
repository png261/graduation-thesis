import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";

export function DangerZoneSection({
  projectName,
  projectCount,
  deleteBusy,
  deleteError,
  onDelete,
}: {
  projectName: string;
  projectCount: number;
  deleteBusy: boolean;
  deleteError: string;
  onDelete: () => void;
}) {
  return (
    <Card className="border-red-500/40 bg-red-950/10 xl:col-span-2">
      <CardHeader>
        <CardTitle className="text-base text-red-200">Danger Zone</CardTitle>
        <CardDescription>Permanently delete this project and its workspace data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {deleteError && (
          <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
            <AlertTitle>Delete failed</AlertTitle>
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={projectCount <= 1 || deleteBusy}>
              {deleteBusy ? "Deleting..." : "Delete Project"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete project "{projectName}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This action is permanent. All files and linked project metadata will be removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete Project</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {projectCount <= 1 && <p className="text-xs text-[var(--da-muted)]">At least one project must remain.</p>}
      </CardContent>
    </Card>
  );
}
