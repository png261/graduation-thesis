import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Thread } from "./thread";
import { ThreadList } from "./thread-list";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";

interface AssistantSidebarProps {
  children: ReactNode;
  className?: string;
}

function HistoryDialog({
  historyOpen,
  setHistoryOpen,
}: {
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
}) {
  return (
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
      <DialogContent className="max-w-md border-[var(--da-border)] bg-[var(--da-panel)] p-0">
        <DialogHeader className="border-b border-[var(--da-border)] px-4 py-3">
          <DialogTitle className="text-sm">Thread History</DialogTitle>
        </DialogHeader>
        <div className="thread-sidebar">
          <ScrollArea className="h-[70vh]">
            <div className="p-2">
              <ThreadList />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SidebarLayout({
  children,
  onOpenHistory,
}: {
  children: ReactNode;
  onOpenHistory: () => void;
}) {
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full max-h-full min-h-0 w-full">
      <ResizablePanel defaultSize={34} minSize={28} className="min-w-0">
        <div className="assistant-chat-pane flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <Thread onOpenHistory={onOpenHistory} />
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={70} minSize={35} className="min-w-0">
        <div className="assistant-editor-pane h-full min-h-0">{children}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function AssistantSidebar({ children, className }: AssistantSidebarProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <section className={cn("assistant-sidebar h-full min-h-0 min-w-0", className)}>
      <SidebarLayout children={children}  onOpenHistory={() => setHistoryOpen(true)} />
      <HistoryDialog historyOpen={historyOpen} setHistoryOpen={setHistoryOpen} />
    </section>
  );
}
