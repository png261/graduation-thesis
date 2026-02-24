"use client";

import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useEditor } from "@/hooks/use-editor";
import { type UIEditor } from "./create-editor";
import { useDataStream } from "./data-stream-provider";
import { getChatHistoryPaginationKey } from "./sidebar-history";

export function DataStreamHandler() {
  const { dataStream, setDataStream } = useDataStream();
  const { mutate } = useSWRConfig();

  const { setEditor } = useEditor();

  useEffect(() => {
    if (!dataStream?.length) {
      return;
    }

    const newDeltas = dataStream.slice();
    setDataStream([]);

    for (const delta of newDeltas) {
      if (delta.type === "data-chat-title") {
        mutate(unstable_serialize(getChatHistoryPaginationKey));
        continue;
      }

      setEditor((currentEditor: UIEditor) => {
        switch (delta.type) {
          case "data-id":
            return {
              ...currentEditor,
              documentId: delta.data,
              status: "streaming",
            };

          case "data-title":
            return {
              ...currentEditor,
              title: delta.data,
              status: "streaming",
            };

          case "data-kind":
            return {
              ...currentEditor,
              kind: delta.data,
              status: "streaming",
            };

          case "data-clear":
            return {
              ...currentEditor,
              content: "",
              status: "streaming",
            };

          case "data-terraformDelta":
            return {
              ...currentEditor,
              content: delta.data,
              isVisible: true,
              status: "streaming",
            };

          case "data-finish":
            return {
              ...currentEditor,
              status: "idle",
            };

          default:
            return currentEditor;
        }
      });
    }
  }, [dataStream, setEditor, mutate, setDataStream]);

  return null;
}
