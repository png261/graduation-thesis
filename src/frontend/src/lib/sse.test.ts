import { describe, expect, it } from "vitest";

import { readSseJson } from "./sse";

function makeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
  return new Response(stream, { status: 200 });
}

async function collectEvents<T>(response: Response): Promise<T[]> {
  const events: T[] = [];
  for await (const event of readSseJson<T>(response)) {
    events.push(event);
  }
  return events;
}

describe("readSseJson", () => {
  it("parses multiple json events", async () => {
    const response = makeSseResponse([
      'data: {"type":"a","value":1}\n\n',
      'data: {"type":"b","value":2}\n\n',
    ]);
    const events = await collectEvents<Record<string, unknown>>(response);
    expect(events).toEqual([
      { type: "a", value: 1 },
      { type: "b", value: 2 },
    ]);
  });

  it("ignores malformed payloads and preserves valid events", async () => {
    const response = makeSseResponse([
      "data: not-json\n\n",
      'data: {"type":"ok"}\n\n',
    ]);
    const events = await collectEvents<Record<string, unknown>>(response);
    expect(events).toEqual([{ type: "ok" }]);
  });

  it("stops when DONE event appears", async () => {
    const response = makeSseResponse([
      'data: {"type":"first"}\n\n',
      "data: [DONE]\n\n",
      'data: {"type":"after"}\n\n',
    ]);
    const events = await collectEvents<Record<string, unknown>>(response);
    expect(events).toEqual([{ type: "first" }]);
  });

  it("parses trailing event without final delimiter", async () => {
    const response = makeSseResponse(['data: {"type":"tail"}']);
    const events = await collectEvents<Record<string, unknown>>(response);
    expect(events).toEqual([{ type: "tail" }]);
  });
});
