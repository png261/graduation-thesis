"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import type { UIEditor } from "@/components/create-editor";

export const initialEditorData: UIEditor = {
  documentId: "init",
  content: "",
  kind: "terraform",
  title: "",
  status: "idle",
  isVisible: true,
  boundingBox: {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  },
};

type Selector<T> = (state: UIEditor) => T;

export function useEditorSelector<Selected>(selector: Selector<Selected>) {
  const { data: localEditor } = useSWR<UIEditor>("editor", null, {
    fallbackData: initialEditorData,
  });

  const selectedValue = useMemo(() => {
    if (!localEditor) {
      return selector(initialEditorData);
    }
    return selector(localEditor);
  }, [localEditor, selector]);

  return selectedValue;
}

export function useEditor() {
  const { data: localEditor, mutate: setLocalEditor } = useSWR<UIEditor>(
    "editor",
    null,
    {
      fallbackData: initialEditorData,
    }
  );

  const editor = useMemo(() => {
    if (!localEditor) {
      return initialEditorData;
    }
    return localEditor;
  }, [localEditor]);

  const setEditor = useCallback(
    (updaterFn: UIEditor | ((currentEditor: UIEditor) => UIEditor)) => {
      setLocalEditor((currentEditor) => {
        const editorToUpdate = currentEditor || initialEditorData;

        if (typeof updaterFn === "function") {
          return updaterFn(editorToUpdate);
        }

        return updaterFn;
      });
    },
    [setLocalEditor]
  );

  const { data: localEditorMetadata, mutate: setLocalEditorMetadata } =
    useSWR<any>(
      () =>
        editor.documentId ? `editor-metadata-${editor.documentId}` : null,
      null,
      {
        fallbackData: null,
      }
    );

  return useMemo(
    () => ({
      editor,
      setEditor,
      metadata: localEditorMetadata,
      setMetadata: setLocalEditorMetadata,
    }),
    [editor, setEditor, localEditorMetadata, setLocalEditorMetadata]
  );
}
