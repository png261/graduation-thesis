import Editor from "@monaco-editor/react";
import { useEffect, useState } from "react";

import { getProjectFileSignedUrl, readProjectFileBlob } from "../../../api/projects/index";

interface EditorPaneProps {
  projectId: string;
  selectedPath: string | null;
  isLoading: boolean;
  language: string;
  content: string;
  setContent: (value: string) => void;
  exportError: string;
  workflowError: string;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);

function extensionFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  const index = name.lastIndexOf(".");
  if (index < 0 || index === name.length - 1) return "";
  return name.slice(index + 1).toLowerCase();
}

function isImagePath(path: string | null): path is string {
  if (!path) return false;
  return IMAGE_EXTENSIONS.has(extensionFromPath(path));
}

function EditorErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700">{message}</div>;
}

function EmptyEditorState() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 text-center">
      <svg className="h-10 w-10 text-[var(--da-muted)]/30" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zm5.5 1v3.5H13L9.5 1z" />
      </svg>
      <p className="text-sm text-[var(--da-muted)]">Select a file to edit</p>
    </div>
  );
}

function LoadingEditorState() {
  return <div className="flex h-full items-center justify-center text-sm text-[var(--da-muted)]">Loading…</div>;
}

function resolveReadonlyPreview(args: { selectedPath: string; content: string }) {
  if (args.content.startsWith("data:image/")) return { src: args.content, error: "" };
  if (extensionFromPath(args.selectedPath) === "svg" && args.content.trim()) {
    return { blob: new Blob([args.content], { type: "image/svg+xml" }), error: "" };
  }
  return { error: "Image preview requires authenticated project access." };
}

function useImagePreviewState(args: { projectId: string; selectedPath: string; content: string }) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let revokedUrl = "";
    let active = true;
    const setPreviewFromBlob = (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      revokedUrl = url;
      if (active) {
        setSrc(url);
        setError("");
        setLoading(false);
      }
    };
    const loadImage = async () => {
      setLoading(true);
      setSrc("");
      setError("");
      try {
        const signedUrl = await getProjectFileSignedUrl(args.projectId, args.selectedPath);
        if (!active) return;
        setSrc(signedUrl);
        setError("");
        setLoading(false);
      } catch {
        try {
          const blob = await readProjectFileBlob(args.projectId, args.selectedPath);
          if (!active) return;
          setPreviewFromBlob(blob);
        } catch (err) {
          if (!active) return;
          setError(err instanceof Error ? err.message : "Failed to load image");
          setLoading(false);
        }
      }
    };
    void loadImage();
    return () => {
      active = false;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [args.content, args.projectId, args.selectedPath]);
  return { src, error, loading, setError, setLoading };
}

function ImagePreview({
  projectId,
  selectedPath,
  content,
}: {
  projectId: string;
  selectedPath: string;
  content: string;
}) {
  const { src, error, loading, setError, setLoading } = useImagePreviewState({
    projectId,
    selectedPath,
    content,
  });

  if (loading) return <LoadingEditorState />;
  if (error) return <div className="flex h-full items-center justify-center px-4 text-sm text-red-700">{error}</div>;
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-[var(--da-bg)] p-4">
      <img
        src={src}
        alt={selectedPath.split("/").pop() || "Selected image"}
        className="max-h-full max-w-full rounded border border-[var(--da-border)] bg-[var(--da-panel)] object-contain shadow-sm"
        onError={() => {
          setError("Image URL expired or unavailable. Reopen file to refresh.");
          setLoading(false);
        }}
      />
    </div>
  );
}

function MonacoEditorView({
  language,
  content,
  setContent,
}: {
  language: string;
  content: string;
  setContent: (value: string) => void;
}) {
  return (
    <Editor
      height="100%"
      language={language}
      value={content}
      theme="vs-light"
      options={{
        fontSize: 13,
        lineHeight: 22,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        lineNumbers: "on",
        renderLineHighlight: "line",
        smoothScrolling: true,
        cursorBlinking: "smooth",
        tabSize: 2,
        padding: { top: 10, bottom: 10 },
      }}
    />
  );
}

function EditorContent({
  projectId,
  selectedPath,
  isLoading,
  language,
  content,
  setContent,
}: {
  projectId: string;
  selectedPath: string | null;
  isLoading: boolean;
  language: string;
  content: string;
  setContent: (value: string) => void;
}) {
  if (!selectedPath) return <EmptyEditorState />;
  if (isLoading) return <LoadingEditorState />;
  if (isImagePath(selectedPath))
    return <ImagePreview projectId={projectId} selectedPath={selectedPath} content={content} />;
  return <MonacoEditorView language={language} content={content} setContent={setContent} />;
}

export function EditorPane(props: EditorPaneProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--da-panel)]">
      <EditorErrorBanner message={props.exportError} />
      <EditorErrorBanner message={props.workflowError} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <EditorContent
          projectId={props.projectId}
          selectedPath={props.selectedPath}
          isLoading={props.isLoading}
          language={props.language}
          content={props.content}
          setContent={props.setContent}
        />
      </div>
    </div>
  );
}
