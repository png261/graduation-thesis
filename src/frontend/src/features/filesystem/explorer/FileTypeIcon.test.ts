import { describe, expect, it } from "vitest";

import { resolveFileIconToken, type FileIconToken } from "./FileTypeIcon";

const iconCases: Array<[string, FileIconToken]> = [
  ["main.ts", "logo.typescript"],
  ["component.TSX", "logo.typescript"],
  ["index.js", "logo.javascript"],
  ["Widget.JSX", "logo.javascript"],
  ["app.py", "logo.python"],
  ["config.json", "logo.json"],
  ["manifest.yaml", "logo.yaml"],
  ["manifest.YML", "logo.yaml"],
  ["main.tf", "logo.terraform"],
  ["locals.HCL", "logo.terraform"],
  ["README.md", "logo.markdown"],
  ["script.sh", "logo.shell"],
  ["profile.BASH", "logo.shell"],
  ["zprofile.zsh", "logo.shell"],
  ["index.html", "logo.html"],
  ["styles.css", "logo.css"],
  ["styles.scss", "logo.css"],
  ["styles.less", "logo.css"],
];

describe("resolveFileIconToken", () => {
  it.each(iconCases)("maps %s to %s", (path, token) => {
    expect(resolveFileIconToken(path)).toBe(token);
  });

  it("falls back to default token for unknown extensions", () => {
    expect(resolveFileIconToken("notes.unknown")).toBe("default.file");
  });

  it("uses generic config token for .env dotfiles", () => {
    expect(resolveFileIconToken(".env")).toBe("generic.config");
  });

  it("uses default token for files without an extension", () => {
    expect(resolveFileIconToken("Dockerfile")).toBe("default.file");
  });
});
