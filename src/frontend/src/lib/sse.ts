import { createParser, type EventSourceMessage } from "eventsource-parser";

export async function* readSseJson<T = unknown>(response: Response): AsyncGenerator<T> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const queue: string[] = [];
  let trailingBuffer = "";
  const parser = createParser({
    onEvent(event: EventSourceMessage) {
      queue.push(event.data);
    },
  });

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    const chunk = decoder.decode(value, { stream: true });
    trailingBuffer += chunk;
    const normalized = trailingBuffer.replace(/\r\n/g, "\n");
    const lastDelimiter = normalized.lastIndexOf("\n\n");
    trailingBuffer = lastDelimiter === -1 ? normalized : normalized.slice(lastDelimiter + 2);
    parser.feed(chunk);
    while (queue.length > 0) {
      const data = queue.shift();
      if (!data) continue;
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data) as T;
      } catch {
        // Ignore malformed payloads.
      }
    }
  }

  parser.feed(decoder.decode());
  while (queue.length > 0) {
    const data = queue.shift();
    if (!data) continue;
    if (data === "[DONE]") return;
    try {
      yield JSON.parse(data) as T;
    } catch {
      // Ignore malformed payloads.
    }
  }

  const trailing = trailingBuffer.trim().replace(/\r\n/g, "\n");
  if (!trailing.startsWith("data:")) return;
  const data = trailing.slice(5).trim();
  if (!data || data === "[DONE]") return;
  try {
    yield JSON.parse(data) as T;
  } catch {
    // Ignore malformed payloads.
  }
}
