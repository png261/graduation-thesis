export function isGuestProjectId(projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  return projectId === "guest-session" || projectId.startsWith("guest-");
}
