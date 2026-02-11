"use client";

import { FileIcon, FilesIcon, FolderIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface MentionListProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (filename: string) => void;
  suggestions?: string[];
  filter?: string;
  highlightedIndex: number;
  onHighlightedIndexChange: (index: number) => void;
}

function getIcon(name: string) {
  if (name === "all files")
    return <FilesIcon className="h-4 w-4 shrink-0 text-muted-foreground" />;
  if (name.endsWith("/"))
    return <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />;
  return <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

export function MentionList({
  isOpen,
  onOpenChange,
  onSelect,
  suggestions = [],
  filter,
  highlightedIndex,
  onHighlightedIndexChange,
}: MentionListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Filter suggestions based on filter text
  const filtered = filter
    ? suggestions.filter((s) => s.toLowerCase().includes(filter.toLowerCase()))
    : suggestions;

  // Keep highlighted index in bounds
  useEffect(() => {
    if (highlightedIndex >= filtered.length) {
      onHighlightedIndexChange(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, highlightedIndex, onHighlightedIndexChange]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-mention-item]");
    const item = items[highlightedIndex];
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  if (!isOpen || filtered.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 mb-2 max-h-[200px] w-[240px] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md z-50"
      ref={listRef}
    >
      {filtered.map((name, index) => (
        <div
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors",
            index === highlightedIndex
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          )}
          data-mention-item
          key={name}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(filtered[index]);
            onOpenChange(false);
          }}
          onMouseEnter={() => onHighlightedIndexChange(index)}
        >
          {getIcon(name)}
          <span className="truncate">{name}</span>
        </div>
      ))}
    </div>
  );
}
