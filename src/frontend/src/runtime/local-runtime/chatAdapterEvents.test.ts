import { describe, expect, it } from "vitest";

import {
  parsePolicyCheckResultEvent,
  parsePolicyCheckStartEvent,
  parseUsageEvent,
} from "./chatAdapterEvents";

describe("parseUsageEvent", () => {
  it("returns payload when all required token fields exist", () => {
    expect(
      parseUsageEvent({
        promptTokens: 10,
        completionTokens: 20,
        modelId: "gemini-2.5-flash",
        modelContextWindow: 1048576,
      }),
    ).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      modelId: "gemini-2.5-flash",
      modelContextWindow: 1048576,
    });
  });

  it("returns null when token fields are missing", () => {
    expect(parseUsageEvent({ modelId: "x" })).toBeNull();
  });
});

describe("policy check event parsers", () => {
  it("parses start event and keeps only string paths", () => {
    const parsed = parsePolicyCheckStartEvent({
      changedPaths: ["/a.tf", 123, "/b.tf"],
    });
    expect(parsed).toEqual({
      type: "policy.check.start",
      changedPaths: ["/a.tf", "/b.tf"],
    });
  });

  it("parses result event with issue mapping and scan error", () => {
    const parsed = parsePolicyCheckResultEvent({
      changedPaths: ["/modules/vpc/main.tf"],
      issues: [
        {
          source: "misconfig",
          severity: "HIGH",
          message: "Public S3 bucket",
          title: "S3 bucket policy",
          rule_id: "AVD-AWS-0001",
          path: "modules/vpc/main.tf",
          line: 12,
          end_line: 18,
          reference_url: "https://example.com/rule",
        },
      ],
      summary: {
        total: 1,
        bySeverity: { HIGH: 1 },
      },
      scanError: {
        code: "trivy_warning",
        message: "database update skipped",
      },
    });

    expect(parsed.type).toBe("policy.check.result");
    if (parsed.type !== "policy.check.result") {
      throw new Error("Expected policy.check.result event");
    }
    expect(parsed.changedPaths).toEqual(["/modules/vpc/main.tf"]);
    expect(parsed.summary).toEqual({ total: 1, bySeverity: { HIGH: 1 } });
    expect(parsed.scanError).toEqual({
      code: "trivy_warning",
      message: "database update skipped",
    });
    expect(parsed.issues).toEqual([
      {
        source: "misconfig",
        severity: "HIGH",
        message: "Public S3 bucket",
        title: "S3 bucket policy",
        ruleId: "AVD-AWS-0001",
        path: "modules/vpc/main.tf",
        line: 12,
        endLine: 18,
        referenceUrl: "https://example.com/rule",
      },
    ]);
  });
});
