"use client";

import { isAfter } from "date-fns";
import { motion } from "framer-motion";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { useWindowSize } from "usehooks-ts";
import { useEditor, useEditorSelector } from "@/hooks/use-editor";
import type { Document } from "@/lib/db/schema";
import { getDocumentTimestampByIndex } from "@/lib/utils";
import { LoaderIcon } from "./icons";
import { Button } from "./ui/button";

type VersionFooterProps = {
  handleVersionChange: (type: "next" | "prev" | "toggle" | "latest") => void;
  documents: Document[] | undefined;
  currentVersionIndex: number;
};

export const VersionFooter = ({
  handleVersionChange,
  documents,
  currentVersionIndex,
}: VersionFooterProps) => {
  const isEditorVisible = useEditorSelector((state) => state.isVisible);
  const { editor } = useEditor();

  const { width } = useWindowSize();
  const isMobile = width < 768;

  const { mutate } = useSWRConfig();
  const [isMutating, setIsMutating] = useState(false);

  if (!isEditorVisible) return null;

  // The original code had a check for `!documents` here.
  // If `documents` is still needed for the restore logic,
  // this check should be re-evaluated or `documents` should be guaranteed.
  // For now, I'm keeping the `!isEditorVisible` check as per instruction.
  // If `documents` can be undefined and is critical, the restore button might need to be disabled or the component return null.
  // Assuming `documents` will be defined if `isEditorVisible` is true and the component renders.

  return (
    <motion.div
      animate={{ y: 0 }}
      className="absolute bottom-0 z-50 flex w-full flex-col justify-between gap-4 border-t bg-background p-4 lg:flex-row"
      exit={{ y: isMobile ? 200 : 77 }}
      initial={{ y: isMobile ? 200 : 77 }}
      transition={{ type: "spring", stiffness: 140, damping: 20 }}
    >
      <div>
        <div>You are viewing a previous version</div>
        <div className="text-muted-foreground text-sm">
          Restore this version to make edits
        </div>
      </div>

      <div className="flex flex-row gap-4">
        <Button
          disabled={isMutating}
          onClick={async () => {
            setIsMutating(true);

            mutate(
              `/api/document?id=${editor.documentId}`,
              await fetch(
                `/api/document?id=${editor.documentId}&timestamp=${getDocumentTimestampByIndex(
                  documents || [],
                  currentVersionIndex
                )}`,
                {
                  method: "DELETE",
                }
              ),
              {
                optimisticData: documents
                  ? [
                    ...documents.filter((document) =>
                      isAfter(
                        new Date(document.createdAt),
                        new Date(
                          getDocumentTimestampByIndex(
                            documents || [],
                            currentVersionIndex
                          )
                        )
                      )
                    ),
                  ]
                  : [],
              }
            );
          }}
        >
          <div>Restore this version</div>
          {isMutating && (
            <div className="animate-spin">
              <LoaderIcon />
            </div>
          )}
        </Button>
        <Button
          onClick={() => {
            handleVersionChange("latest");
          }}
          variant="outline"
        >
          Back to latest version
        </Button>
      </div>
    </motion.div>
  );
};
