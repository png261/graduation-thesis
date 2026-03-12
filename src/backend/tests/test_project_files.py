from __future__ import annotations

import pytest

from app.services.project import files as project_files


@pytest.fixture
def project_id(tmp_path, monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setattr(project_files, "PROJECTS_ROOT", tmp_path)
    return "project-1"


def test_normalize_virtual_path_rejects_traversal() -> None:
    with pytest.raises(ValueError):
        project_files.normalize_virtual_path("../secrets.txt")


def test_move_paths_moves_file_and_returns_mapping(project_id: str) -> None:
    project_files.write_text(project_id, "/a/main.tf", "resource")
    project_files.write_text(project_id, "/modules/vpc/vars.tf", "variable")
    moved = project_files.move_paths(project_id, ["/a/main.tf"], "/modules/vpc")
    assert moved == [{"from": "/a/main.tf", "to": "/modules/vpc/main.tf"}]
    assert project_files.read_text(project_id, "/modules/vpc/main.tf") == "resource"


def test_rename_path_renames_file(project_id: str) -> None:
    project_files.write_text(project_id, "/modules/vpc/main.tf", "resource")
    moved = project_files.rename_path(project_id, "/modules/vpc/main.tf", "network.tf")
    assert moved == {"from": "/modules/vpc/main.tf", "to": "/modules/vpc/network.tf"}
    assert project_files.read_text(project_id, "/modules/vpc/network.tf") == "resource"
