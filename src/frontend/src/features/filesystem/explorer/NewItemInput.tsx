import { useEffect, useRef, useState } from "react";

export function NewItemInput({
  onConfirm,
  onCancel,
  placeholder,
}: {
  onConfirm: (name: string) => void;
  onCancel: () => void;
  placeholder: string;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <input
        ref={inputRef}
        className="min-w-0 flex-1 rounded border border-[var(--da-border)] bg-[var(--da-panel)] px-1.5 py-1 text-xs text-[var(--da-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--da-accent)]/70"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onConfirm(value.trim());
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => {
          if (value.trim()) onConfirm(value.trim());
          else onCancel();
        }}
      />
    </div>
  );
}
