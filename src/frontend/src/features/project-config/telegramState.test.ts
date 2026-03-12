import { describe, expect, it } from "vitest";

import { formatTelegramTime, telegramPhase } from "./telegramState";

describe("telegramPhase", () => {
  it("returns loading when status is null", () => {
    expect(telegramPhase(null)).toBe("loading");
  });

  it("returns connected when status is connected", () => {
    expect(
      telegramPhase({
        connected: true,
        chat_id: "123",
        topic_id: "99",
        topic_title: "demo-topic",
        requires_reconnect: false,
        connected_at: "2026-03-11T10:00:00Z",
        pending: false,
        pending_expires_at: null,
      }),
    ).toBe("connected");
  });

  it("returns pending when status is pending", () => {
    expect(
      telegramPhase({
        connected: false,
        chat_id: null,
        topic_id: null,
        topic_title: null,
        requires_reconnect: false,
        connected_at: null,
        pending: true,
        pending_expires_at: "2026-03-11T10:05:00Z",
      }),
    ).toBe("pending");
  });

  it("returns disconnected when not connected and not pending", () => {
    expect(
      telegramPhase({
        connected: false,
        chat_id: null,
        topic_id: null,
        topic_title: null,
        requires_reconnect: false,
        connected_at: null,
        pending: false,
        pending_expires_at: null,
      }),
    ).toBe("disconnected");
  });
});

describe("formatTelegramTime", () => {
  it("returns placeholder for empty values", () => {
    expect(formatTelegramTime(null)).toBe("-");
  });

  it("returns original value when date cannot be parsed", () => {
    expect(formatTelegramTime("not-a-date")).toBe("not-a-date");
  });
});
