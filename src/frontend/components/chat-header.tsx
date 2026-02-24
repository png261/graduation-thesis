"use client";

import { useRouter } from "next/navigation";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "./icons";
import { DownloadIcon, PlayIcon } from "lucide-react";
import { VisibilitySelector, type VisibilityType } from "./visibility-selector";
import { HistoryModal } from "./history-modal";

function PureChatHeader({
  chatId,
  selectedVisibilityType,
  isReadonly,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
}) {
  const router = useRouter();

  return (
    <header className="sticky top-0 flex items-center gap-2 bg-background px-2 py-1.5 md:px-2 border-b shrink-0">
      {/* Left side: History + New Chat + Privacy */}
      <HistoryModal />

      <Button
        className="h-8 px-2"
        onClick={() => {
          router.push("/");
          router.refresh();
        }}
        variant="outline"
      >
        <PlusIcon />
        <span className="md:sr-only">New Chat</span>
      </Button>

      {!isReadonly && (
        <VisibilitySelector
          chatId={chatId}
          className=""
          selectedVisibilityType={selectedVisibilityType}
        />
      )}

      {/* Right side actions */}
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <DownloadIcon size={14} />
          Export Code
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs">
          <PlayIcon size={14} />
          Run Workflow
        </Button>
      </div>

    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly
  );
});
