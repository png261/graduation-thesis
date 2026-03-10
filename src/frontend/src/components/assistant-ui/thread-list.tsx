import { Plus, Trash2 } from "lucide-react";

import { ThreadListItemPrimitive, ThreadListPrimitive } from "@assistant-ui/react";

function ThreadListItem() {
  return (
    <ThreadListItemPrimitive.Root className="aui-thread-list-item">
      <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger">
        <p className="aui-thread-list-item-title">
          <ThreadListItemPrimitive.Title fallback="New thread" />
        </p>
      </ThreadListItemPrimitive.Trigger>

      <ThreadListItemPrimitive.Delete
        className="assistant-thread-action aui-thread-list-item-archive"
        aria-label="Delete thread"
        title="Delete thread"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </ThreadListItemPrimitive.Delete>
    </ThreadListItemPrimitive.Root>
  );
}

export function ThreadList() {
  return (
    <ThreadListPrimitive.Root className="aui-thread-list-root">
      <ThreadListPrimitive.New className="aui-thread-list-new">
        <Plus className="mr-2 h-4 w-4" aria-hidden />
        New thread
      </ThreadListPrimitive.New>

      <ThreadListPrimitive.Items
        components={{
          ThreadListItem,
        }}
      />
    </ThreadListPrimitive.Root>
  );
}
