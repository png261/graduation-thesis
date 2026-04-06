import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";

type ChatAttachmentBase = {
  type: "document" | "image";
  name: string;
  contentType: string | null;
  sizeBytes: number;
};

export type ChatDocumentAttachmentPayload = ChatAttachmentBase & {
  type: "document";
  content: string;
};

export type ChatImageAttachmentPayload = ChatAttachmentBase & {
  type: "image";
  content: string;
};

export type ChatAttachmentPayload = ChatDocumentAttachmentPayload | ChatImageAttachmentPayload;

export const CHAT_ATTACHMENT_ERROR_EVENT = "chat-attachment-error";

const MAX_ATTACHMENTS = 3;
const MAX_DOCUMENT_BYTES = 128 * 1024;
const MAX_DOCUMENT_TEXT_CHARS = 8_000;
const MAX_TOTAL_DOCUMENT_TEXT_CHARS = 16_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const DOCUMENT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".xml",
  ".log",
  ".ini",
]);

const DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".log": "text/plain",
  ".ini": "text/plain",
};

const IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function dispatchAttachmentError(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_ATTACHMENT_ERROR_EVENT, { detail: { message } }));
}

export function readAttachmentErrorMessage(event: Event) {
  if (!(event instanceof CustomEvent)) return "Unable to attach file";
  const message = event.detail?.message;
  return typeof message === "string" && message.trim() ? message : "Unable to attach file";
}

function extensionFromName(name: string) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function inferDocumentContentType(name: string, contentType: string) {
  const normalized = contentType.trim();
  if (normalized) return normalized;
  return DOCUMENT_CONTENT_TYPES[extensionFromName(name)] ?? "text/plain";
}

function normalizeText(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

function ensureDocumentExtension(name: string) {
  if (DOCUMENT_EXTENSIONS.has(extensionFromName(name))) return;
  throw new Error("Supported documents: .txt, .md, .json, .yaml, .yml, .csv, .xml, .log, .ini");
}

function ensureDocumentSize(file: File) {
  if (file.size <= MAX_DOCUMENT_BYTES) return;
  throw new Error(`'${file.name}' exceeds the 128 KiB document limit`);
}

function ensureDocumentText(text: string, name: string) {
  if (!text.trim()) throw new Error(`'${name}' is empty`);
  if (text.includes("\u0000")) throw new Error(`'${name}' looks like a binary file`);
  if (text.length > MAX_DOCUMENT_TEXT_CHARS) {
    throw new Error(`'${name}' exceeds the 8,000 character document limit`);
  }
}

function ensureImageFile(file: File) {
  if (!IMAGE_CONTENT_TYPES.has(file.type)) {
    throw new Error("Supported images: PNG, JPEG, WEBP, GIF");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`'${file.name || "image"}' exceeds the 5 MiB image limit`);
  }
}

function preparedCharCount(prepared: ReadonlyMap<string, string>) {
  let total = 0;
  for (const attachment of prepared.values()) total += attachment.length;
  return total;
}

function imageDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

function documentPayload(attachment: CompleteAttachment): ChatDocumentAttachmentPayload {
  const content = normalizeText(
    attachment.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  );
  ensureDocumentExtension(attachment.name);
  ensureDocumentText(content, attachment.name);
  return {
    type: "document",
    name: attachment.name,
    content,
    contentType: inferDocumentContentType(attachment.name, attachment.contentType ?? ""),
    sizeBytes: attachment.file?.size ?? new TextEncoder().encode(content).length,
  };
}

function imagePayload(attachment: CompleteAttachment): ChatImageAttachmentPayload {
  const content = attachment.content
    .filter((part) => part.type === "image")
    .map((part) => part.image)
    .find((value): value is string => typeof value === "string");
  if (!content || !content.startsWith("data:image/")) {
    throw new Error(`'${attachment.name || "image"}' is not a valid pasted/uploaded image`);
  }
  const contentType = attachment.contentType ?? null;
  if (contentType && !IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new Error("Supported images: PNG, JPEG, WEBP, GIF");
  }
  return {
    type: "image",
    name: attachment.name,
    content,
    contentType,
    sizeBytes: attachment.file?.size ?? 0,
  };
}

export function serializeChatAttachments(attachments: readonly CompleteAttachment[]) {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error(`You can attach up to ${MAX_ATTACHMENTS} files per message`);
  }
  const payloads = attachments.map((attachment) =>
    attachment.type === "image" ? imagePayload(attachment) : documentPayload(attachment),
  );
  const totalDocumentChars = payloads.reduce(
    (sum, attachment) => sum + (attachment.type === "document" ? attachment.content.length : 0),
    0,
  );
  if (totalDocumentChars > MAX_TOTAL_DOCUMENT_TEXT_CHARS) {
    throw new Error("Attached documents exceed the 16,000 character total limit");
  }
  return payloads;
}

export class DocumentAttachmentAdapter implements AttachmentAdapter {
  public accept = ".txt,.md,.json,.yaml,.yml,.csv,.xml,.log,.ini";

  private readonly prepared = new Map<string, string>();

  public async add({ file }: { file: File }): Promise<PendingAttachment> {
    try {
      ensureDocumentExtension(file.name);
      ensureDocumentSize(file);
      const content = normalizeText(await file.text());
      ensureDocumentText(content, file.name);
      if (preparedCharCount(this.prepared) + content.length > MAX_TOTAL_DOCUMENT_TEXT_CHARS) {
        throw new Error("Attached documents exceed the 16,000 character total limit");
      }
      const id = crypto.randomUUID();
      const contentType = inferDocumentContentType(file.name, file.type);
      this.prepared.set(id, content);
      return {
        id,
        type: "document",
        name: file.name,
        contentType,
        file,
        status: { type: "requires-action", reason: "composer-send" },
      };
    } catch (error) {
      dispatchAttachmentError(error instanceof Error ? error.message : "Unable to attach document");
      throw error;
    }
  }

  public async remove(attachment: PendingAttachment | CompleteAttachment) {
    this.prepared.delete(attachment.id);
  }

  public async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const prepared = this.prepared.get(attachment.id);
    if (!prepared) throw new Error(`'${attachment.name}' is no longer available`);
    this.prepared.delete(attachment.id);
    return {
      ...attachment,
      status: { type: "complete" },
      content: [{ type: "text", text: prepared }],
    };
  }
}

export class ImageAttachmentAdapter implements AttachmentAdapter {
  public accept = "image/png,image/jpeg,image/webp,image/gif";

  public async add({ file }: { file: File }): Promise<PendingAttachment> {
    try {
      ensureImageFile(file);
      return {
        id: crypto.randomUUID(),
        type: "image",
        name: file.name || "Pasted image",
        contentType: file.type,
        file,
        status: { type: "requires-action", reason: "composer-send" },
      };
    } catch (error) {
      dispatchAttachmentError(error instanceof Error ? error.message : "Unable to attach image");
      throw error;
    }
  }

  public async remove() {}

  public async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    ensureImageFile(attachment.file);
    return {
      ...attachment,
      status: { type: "complete" },
      content: [{ type: "image", image: await imageDataUrl(attachment.file) }],
    };
  }
}
