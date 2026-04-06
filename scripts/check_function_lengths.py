#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


FUNCTION_START_PATTERNS = (
    re.compile(r"^\s*export\s+function\s+(?P<name>[A-Za-z0-9_]+)\s*\("),
    re.compile(r"^\s*function\s+(?P<name>[A-Za-z0-9_]+)\s*\("),
    re.compile(r"^\s*(?:export\s+)?const\s+(?P<name>[A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\("),
)

SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx"}


@dataclass(frozen=True)
class FunctionSpan:
    file: Path
    name: str
    start_line: int
    end_line: int

    @property
    def length(self) -> int:
        return self.end_line - self.start_line + 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check frontend/backend function length limits.")
    parser.add_argument("--target", required=True, choices=("frontend", "backend"))
    parser.add_argument("--max-lines", required=True, type=int)
    parser.add_argument("--strict", action="store_true")
    return parser.parse_args()


def target_root(repo_root: Path, target: str) -> Path:
    if target == "frontend":
        return repo_root / "src" / "frontend" / "src"
    return repo_root / "src" / "backend" / "app"


def iter_source_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*") if path.suffix in SOURCE_EXTENSIONS and path.is_file())


def changed_source_files(repo_root: Path, root: Path) -> list[Path]:
    result = subprocess.run(
        ["git", "status", "--short", "--untracked-files=all"],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    changed: list[Path] = []
    for raw_line in result.stdout.splitlines():
        if not raw_line:
            continue
        path_text = raw_line[3:].strip()
        if not path_text:
            continue
        path = (repo_root / path_text).resolve()
        try:
            path.relative_to(root.resolve())
        except ValueError:
            continue
        if path.suffix not in SOURCE_EXTENSIONS or not path.is_file():
            continue
        changed.append(path)
    unique = sorted(set(changed))
    return unique


def function_name(line: str) -> str | None:
    for pattern in FUNCTION_START_PATTERNS:
        match = pattern.match(line)
        if match:
            return match.group("name")
    return None


def first_brace_index(lines: list[str], start_index: int) -> tuple[int, int] | None:
    for line_index in range(start_index, len(lines)):
        brace_index = lines[line_index].find("{")
        if brace_index >= 0:
            return line_index, brace_index
    return None


def extract_function_spans(path: Path) -> list[FunctionSpan]:
    lines = path.read_text(encoding="utf-8").splitlines()
    spans: list[FunctionSpan] = []
    line_index = 0
    while line_index < len(lines):
        name = function_name(lines[line_index])
        if not name:
            line_index += 1
            continue
        brace_position = first_brace_index(lines, line_index)
        if brace_position is None:
            line_index += 1
            continue
        brace_line, _brace_column = brace_position
        balance = 0
        end_line = brace_line
        started = False
        for scan_index in range(brace_line, len(lines)):
            for char in lines[scan_index]:
                if char == "{":
                    balance += 1
                    started = True
                elif char == "}":
                    balance -= 1
            if started and balance <= 0:
                end_line = scan_index
                break
        spans.append(
            FunctionSpan(
                file=path,
                name=name,
                start_line=line_index + 1,
                end_line=end_line + 1,
            )
        )
        line_index = end_line + 1
    return spans


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    root = target_root(repo_root, args.target)
    files = changed_source_files(repo_root, root) or iter_source_files(root)
    violations: list[FunctionSpan] = []
    for source_file in files:
        for span in extract_function_spans(source_file):
            if span.length > args.max_lines:
                violations.append(span)

    if not violations:
        print(f"PASS: no {args.target} functions exceed {args.max_lines} lines")
        return 0

    print(f"FAIL: {len(violations)} function(s) exceed {args.max_lines} lines")
    for span in violations:
        rel = span.file.relative_to(repo_root)
        print(f"{rel}:{span.start_line} {span.name} ({span.length} lines)")
    return 1 if args.strict else 0


if __name__ == "__main__":
    raise SystemExit(main())
