import { describe, expect, it } from "vitest";

import type { PathMove } from "../../../api/projects";
import {
  isDropTargetAllowed,
  remapMovedPath,
  remapMovedPathSet,
  resolveMoveSourcePaths,
} from "./moveUtils";

describe("resolveMoveSourcePaths", () => {
  it("uses selected paths when dragged node is part of selection", () => {
    const sources = resolveMoveSourcePaths(
      ["/stack/main.tf"],
      new Set(["/stack/main.tf", "/stack/vars.tf"]),
    );

    expect(sources).toEqual(["/stack/main.tf", "/stack/vars.tf"]);
  });

  it("falls back to dragged paths when drag starts outside selection", () => {
    const sources = resolveMoveSourcePaths(
      ["/ops/main.tf", "/ops/vars.tf"],
      new Set(["/stack/main.tf"]),
    );

    expect(sources).toEqual(["/ops/main.tf", "/ops/vars.tf"]);
  });
});

describe("isDropTargetAllowed", () => {
  it("rejects file drop targets and allows folder/root", () => {
    expect(isDropTargetAllowed("file")).toBe(false);
    expect(isDropTargetAllowed("folder")).toBe(true);
    expect(isDropTargetAllowed("root")).toBe(true);
  });
});

describe("remap moved paths", () => {
  const moved: PathMove[] = [{ from: "/stack", to: "/workspace/stack" }];

  it("remaps active path after folder move", () => {
    expect(remapMovedPath("/stack/main.tf", moved)).toBe("/workspace/stack/main.tf");
  });

  it("remaps selected path set after move", () => {
    const remapped = remapMovedPathSet(
      new Set(["/stack/main.tf", "/stack/vars.tf"]),
      moved,
    );
    expect(Array.from(remapped).sort()).toEqual([
      "/workspace/stack/main.tf",
      "/workspace/stack/vars.tf",
    ]);
  });
});
