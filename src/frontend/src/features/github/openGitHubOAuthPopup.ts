import { getGitHubOauthStart } from "../../api/projects";

export async function openGitHubOAuthPopup(): Promise<void> {
  const data = await getGitHubOauthStart();
  const popup = window.open(data.authorize_url, "github-oauth", "width=640,height=720");
  if (!popup) throw new Error("Unable to open GitHub OAuth popup");
  await new Promise<void>((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || payload.source !== "github-oauth") return;
      cleanup();
      if (payload.status === "ok") resolve();
      else reject(new Error(payload.message || "GitHub OAuth failed"));
    };
    const timer = window.setInterval(() => {
      if (popup.closed) cleanup(resolve);
    }, 400);
    const cleanup = (done?: () => void) => {
      window.clearInterval(timer);
      window.removeEventListener("message", handler);
      done?.();
    };
    window.addEventListener("message", handler);
  });
}
