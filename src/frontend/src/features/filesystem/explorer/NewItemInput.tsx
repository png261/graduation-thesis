import { useEffect, useRef, useState, type Ref } from "react";

function commitInputValue(value: string, onConfirm: (name: string) => void, onCancel: () => void) {
  const next = value.trim();
  if (next) {
    onConfirm(next);
    return;
  }
  onCancel();
}

function EditableInput({
  inputRef,
  placeholder,
  value,
  onChangeValue,
  onKeyDown,
  onBlur,
}: {
  inputRef: Ref<HTMLInputElement>;
  placeholder: string;
  value: string;
  onChangeValue: (next: string) => void;
  onKeyDown: (key: string) => void;
  onBlur: () => void;
}) {
  return (
    <input
      ref={inputRef}
      className="min-w-0 flex-1 rounded border border-[var(--da-border)] bg-[var(--da-panel)] px-1.5 py-1 text-xs text-[var(--da-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--da-accent)]/70"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChangeValue(e.target.value)}
      onKeyDown={(e) => onKeyDown(e.key)}
      onBlur={onBlur}
    />
  );
}

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
  const handleKeyDown = (key: string) => {
    if (key === "Enter") commitInputValue(value, onConfirm, onCancel);
    if (key === "Escape") onCancel();
  };
  const handleBlur = () => commitInputValue(value, onConfirm, onCancel);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <EditableInput inputRef={inputRef} placeholder={placeholder} value={value} onChangeValue={setValue} onKeyDown={handleKeyDown} onBlur={handleBlur} />
    </div>
  );
}
