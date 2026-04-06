import { useEffect, useMemo, useRef } from "react";
import type { PropsWithChildren } from "react";

import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  unstable_useRemoteThreadListRuntime,
  useLocalRuntime,
} from "@assistant-ui/react";

import { useFilesystemContext } from "../contexts/FilesystemContext";
import { createChatModelAdapter } from "./local-runtime/createChatModelAdapter";
import { DocumentAttachmentAdapter, ImageAttachmentAdapter } from "./local-runtime/documentAttachmentAdapter";
import { useProjectThreadListAdapter } from "./local-runtime/useProjectThreadListAdapter";

interface Props {
  projectId: string;
  authenticated: boolean;
  userScope: string;
}

export function LocalRuntimeProvider({
  children,
  projectId,
  authenticated,
  userScope,
}: PropsWithChildren<Props>) {
  const projectIdRef = useRef(projectId);
  const { notifyFileChanged, notifyPolicyCheck } = useFilesystemContext();
  const threadListAdapter = useProjectThreadListAdapter(projectId, {
    authenticated,
    userScope,
  });

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  const adapter = createChatModelAdapter({
    getProjectId: () => projectIdRef.current,
    authenticated,
    notifyFileChanged,
    notifyPolicyCheck,
  });
  const attachments = useMemo(
    () => new CompositeAttachmentAdapter([new DocumentAttachmentAdapter(), new ImageAttachmentAdapter()]),
    [],
  );

  const runtime = unstable_useRemoteThreadListRuntime({
    runtimeHook: () => useLocalRuntime(adapter, { adapters: { attachments } }),
    adapter: threadListAdapter,
    allowNesting: true,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
