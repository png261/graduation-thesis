from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import boto3
import os
import subprocess
import tempfile
import shutil
from git import Repo, InvalidGitRepositoryError, GitCommandError
from typing import Optional
from dotenv import dotenv_values

app = FastAPI()

AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
PROJECTS_DIR = os.getenv("PROJECTS_DIR", os.path.join(os.getcwd(), "projects"))
BLUEPRINTS_DIR = os.path.join(os.path.dirname(__file__), "blueprints")

class TofuRequest(BaseModel):
    files: dict[str, str] = {}
    chatId: str | None = None

class GitPendingRequest(BaseModel):
    files: dict[str, str] = {}
    message: str = "Agent changes"

class EnvRequest(BaseModel):
    env_content: str

class GitAcceptRequest(BaseModel):
    files: list[str] | None = None  # None = accept all

class GitCheckoutRequest(BaseModel):
    commit_hash: str

class DeletePathsRequest(BaseModel):
    paths: list[str]  # List of file or folder paths to delete (relative to project dir)

# ─── Helpers ───

def get_project_dir(chat_id: str):
    project_path = os.path.join(PROJECTS_DIR, chat_id)
    os.makedirs(project_path, exist_ok=True)
    return project_path

def write_files(target_dir, files):
    for filename, content in files.items():
        safe_filename = filename
        full_path = os.path.abspath(os.path.join(target_dir, safe_filename))
        if not full_path.startswith(os.path.abspath(target_dir)):
            continue
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)

def copy_blueprint_to_workspace(workspace_dir: str, blueprint_name: str = "default"):
    """Copy blueprint template files to a new workspace."""
    blueprint_path = os.path.join(BLUEPRINTS_DIR, blueprint_name)
    
    if not os.path.exists(blueprint_path):
        print(f"Warning: Blueprint '{blueprint_name}' not found at {blueprint_path}")
        return
    
    for root, dirs, files in os.walk(blueprint_path):
        # Calculate relative path from blueprint root
        rel_dir = os.path.relpath(root, blueprint_path)
        target_dir = workspace_dir if rel_dir == "." else os.path.join(workspace_dir, rel_dir)
        
        # Create target directory if needed
        os.makedirs(target_dir, exist_ok=True)
        
        # Copy files
        for file in files:
            src_file = os.path.join(root, file)
            dst_file = os.path.join(target_dir, file)
            
            # Don't overwrite existing files
            if not os.path.exists(dst_file):
                shutil.copy2(src_file, dst_file)
                print(f"Copied blueprint file: {file}")

def get_or_init_repo(chat_id: str) -> Repo:
    """Get existing repo or init a new one with current files committed."""
    project_dir = get_project_dir(chat_id)
    try:
        repo = Repo(project_dir)
        return repo
    except InvalidGitRepositoryError:
        repo = Repo.init(project_dir)
        # Configure git user for commits
        repo.config_writer().set_value("user", "name", "InfraAgent").release()
        repo.config_writer().set_value("user", "email", "agent@infra.dev").release()
        
        # Copy blueprint files to the new workspace
        copy_blueprint_to_workspace(project_dir, "default")
        
        # Create a .gitignore if it doesn't exist (blueprint should provide this)
        gitignore_path = os.path.join(project_dir, ".gitignore")
        if not os.path.exists(gitignore_path):
            with open(gitignore_path, "w") as f:
                f.write(".env\n.terraform\n.terraform.lock.hcl\nterraform.tfstate\nterraform.tfstate.backup\n")

        # Create a README.md if it doesn't exist (blueprint should provide this)
        readme_path = os.path.join(project_dir, "README.md")
        if not os.path.exists(readme_path):
            with open(readme_path, "w") as f:
                f.write(f"# Project: {chat_id}\n\nThis is a newly created infrastructure workspace.")
        
        # Initial commit with existing files
        _commit_all(repo, "initial")
        
        # Ensure branch is named 'main'
        if "main" not in [h.name for h in repo.heads]:
            repo.git.branch("-M", "main")
            
        return repo

def _commit_all(repo: Repo, message: str):
    """Stage all changes and commit."""
    repo.git.add(A=True)
    # Only commit if there are staged changes
    if repo.is_dirty(staged=True) or repo.untracked_files:
        repo.git.add(A=True)
        repo.index.commit(message)

def _read_all_files(project_dir: str) -> dict[str, str]:
    """Read all non-hidden, non-terraform files from project dir."""
    files = {}
    for root, dirs, filenames in os.walk(project_dir):
        # Skip hidden dirs and .terraform
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for filename in filenames:
            if filename.startswith('.'):
                continue
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, project_dir)
            try:
                with open(full_path, "r") as f:
                    files[rel_path] = f.read()
            except UnicodeDecodeError:
                pass
    return files


# ─── Existing Endpoints ───

@app.post("/project/{chat_id}/files")
async def save_project_files(chat_id: str, request: TofuRequest):
    try:
        project_dir = get_project_dir(chat_id)
        write_files(project_dir, request.files)
        return {"status": "success", "message": "Files saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/project/{chat_id}/files")
async def delete_project_paths(chat_id: str, request: DeletePathsRequest):
    """Delete files or folders from a project (safely, no path traversal)."""
    try:
        project_dir = get_project_dir(chat_id)
        deleted = []
        for path in request.paths:
            full_path = os.path.abspath(os.path.join(project_dir, path))
            # Guard against path traversal
            if not full_path.startswith(os.path.abspath(project_dir)):
                continue
            if os.path.isfile(full_path):
                os.remove(full_path)
                deleted.append(path)
            elif os.path.isdir(full_path):
                shutil.rmtree(full_path)
                deleted.append(path)
        return {"status": "success", "deleted": deleted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/project/{chat_id}/folders")
async def create_project_folder(chat_id: str, request: dict):
    """Create a folder in a project (adds .gitkeep if empty)."""
    try:
        folder = request.get("path", "")
        project_dir = get_project_dir(chat_id)
        full_path = os.path.abspath(os.path.join(project_dir, folder))
        if not full_path.startswith(os.path.abspath(project_dir)):
            raise HTTPException(status_code=400, detail="Invalid path")
        os.makedirs(full_path, exist_ok=True)
        # Add .gitkeep so the empty folder is tracked
        gitkeep = os.path.join(full_path, ".gitkeep")
        if not os.listdir(full_path):
            open(gitkeep, "w").close()
        return {"status": "success", "path": folder}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/project/{chat_id}/files")
async def get_project_files(chat_id: str):
    project_dir = os.path.join(PROJECTS_DIR, chat_id)
    if not os.path.exists(project_dir):
        return {"files": {}}
    files = _read_all_files(project_dir)
    return {"files": files}

@app.get("/project/{chat_id}/env")
async def get_project_env(chat_id: str):
    project_dir = get_project_dir(chat_id)
    env_file = os.path.join(project_dir, ".env")
    if os.path.exists(env_file):
        with open(env_file, "r") as f:
            return {"env": f.read()}
    return {"env": ""}

@app.post("/project/{chat_id}/env")
async def save_project_env(chat_id: str, request: EnvRequest):
    project_dir = get_project_dir(chat_id)
    env_file = os.path.join(project_dir, ".env")
    with open(env_file, "w") as f:
        f.write(request.env_content)
    return {"status": "success", "message": "Environment saved"}

@app.get("/blueprints")
async def list_blueprints():
    """List all available blueprint templates."""
    try:
        if not os.path.exists(BLUEPRINTS_DIR):
            return {"blueprints": []}
        
        blueprints = []
        for item in os.listdir(BLUEPRINTS_DIR):
            item_path = os.path.join(BLUEPRINTS_DIR, item)
            if os.path.isdir(item_path):
                # Get list of files in the blueprint
                files = []
                for root, dirs, filenames in os.walk(item_path):
                    for filename in filenames:
                        rel_path = os.path.relpath(os.path.join(root, filename), item_path)
                        files.append(rel_path)
                
                blueprints.append({
                    "name": item,
                    "files": files
                })
        
        return {"blueprints": blueprints}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tofu/plan")
async def tofu_plan(request: TofuRequest):
    if not request.chatId:
        raise HTTPException(status_code=400, detail="chatId is required")
    project_dir = get_project_dir(request.chatId)
    write_files(project_dir, request.files)

    async def run_tofu_in_dir(cwd):
        env = os.environ.copy()
        env_file = os.path.join(cwd, ".env")
        if os.path.exists(env_file):
            env.update(dotenv_values(env_file))
            
        init_proc = subprocess.run(
            ["tofu", "init", "-no-color"], cwd=cwd,
            capture_output=True, text=True, env=env
        )
        if init_proc.returncode != 0:
            return {"status": "error", "message": init_proc.stderr, "step": "init"}
        plan_proc = subprocess.run(
            ["tofu", "plan", "-no-color"], cwd=cwd,
            capture_output=True, text=True, env=env
        )
        if plan_proc.returncode != 0:
            return {"status": "error", "message": plan_proc.stderr, "step": "plan"}
        return {"status": "success", "output": plan_proc.stdout}

    return await run_tofu_in_dir(project_dir)

@app.post("/tofu/apply")
async def tofu_apply(request: TofuRequest):
    if not request.chatId:
        raise HTTPException(status_code=400, detail="chatId is required")
    project_dir = get_project_dir(request.chatId)

    async def run_apply_in_dir(cwd):
        env = os.environ.copy()
        env_file = os.path.join(cwd, ".env")
        if os.path.exists(env_file):
            env.update(dotenv_values(env_file))
            
        apply_proc = subprocess.run(
            ["tofu", "apply", "-auto-approve", "-no-color"], cwd=cwd,
            capture_output=True, text=True, env=env
        )
        if apply_proc.returncode != 0:
            return {"status": "error", "message": apply_proc.stderr, "step": "apply"}
        return {"status": "success", "output": apply_proc.stdout}

    return await run_apply_in_dir(project_dir)

@app.get("/tofu/state/{chat_id}")
async def tofu_state(chat_id: str):
    project_dir = get_project_dir(chat_id)
    state_file = os.path.join(project_dir, "terraform.tfstate")
    if os.path.exists(state_file):
        with open(state_file, "r") as f:
            return {"status": "success", "state": f.read()}
    return {"status": "error", "message": "State file not found"}


# ─── Git Version Control Endpoints ───

@app.post("/project/{chat_id}/git/init")
async def git_init(chat_id: str):
    """Initialize git repo for a project (idempotent)."""
    try:
        repo = get_or_init_repo(chat_id)
        head_commit = None
        try:
            head_commit = str(repo.head.commit)[:7]
        except ValueError:
            pass
        return {"status": "success", "head": head_commit}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/project/{chat_id}/git/pending")
async def git_create_pending(chat_id: str, request: GitPendingRequest):
    """Write agent changes to a 'pending' branch for review."""
    try:
        repo = get_or_init_repo(chat_id)
        project_dir = get_project_dir(chat_id)

        # Save current branch name
        try:
            current_branch = repo.active_branch.name
        except TypeError:
            current_branch = "main"

        # Ensure we're on main
        if current_branch != "main":
            repo.git.checkout("main")

        # Delete existing pending branch if exists
        if "pending" in [b.name for b in repo.branches]:
            repo.git.branch("-D", "pending")

        # Create pending branch from main
        repo.git.checkout("-b", "pending")

        # Write agent files
        write_files(project_dir, request.files)

        # Commit on pending
        _commit_all(repo, request.message)

        # Switch back to main (working dir stays on main)
        repo.git.checkout("main")

        return {"status": "success", "message": "Pending changes created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/project/{chat_id}/git/diff")
async def git_get_diff(chat_id: str):
    """Get diff between main and pending branch."""
    try:
        repo = get_or_init_repo(chat_id)

        if "pending" not in [b.name for b in repo.branches]:
            return {"status": "success", "changes": [], "hasPending": False}

        # Get diff between main and pending
        diff_output = repo.git.diff("main", "pending", "--stat")
        diff_details = repo.git.diff("main", "pending", "--unified=3")

        # Parse per-file diffs
        changes = []
        current_file = None
        current_hunks = []

        for line in diff_details.split("\n"):
            if line.startswith("diff --git"):
                if current_file:
                    changes.append({
                        "filePath": current_file,
                        "diff": "\n".join(current_hunks),
                        "additions": sum(1 for l in current_hunks if l.startswith("+") and not l.startswith("+++")),
                        "deletions": sum(1 for l in current_hunks if l.startswith("-") and not l.startswith("---")),
                    })
                # Extract file path from "diff --git a/file b/file"
                parts = line.split(" ")
                current_file = parts[-1][2:]  # remove "b/"
                current_hunks = [line]
            elif current_file:
                current_hunks.append(line)

        # Don't forget the last file
        if current_file:
            changes.append({
                "filePath": current_file,
                "diff": "\n".join(current_hunks),
                "additions": sum(1 for l in current_hunks if l.startswith("+") and not l.startswith("+++")),
                "deletions": sum(1 for l in current_hunks if l.startswith("-") and not l.startswith("---")),
            })

        # Get the new file contents from pending branch
        for change in changes:
            try:
                content = repo.git.show(f"pending:{change['filePath']}")
                change["newContent"] = content
            except GitCommandError:
                change["newContent"] = None  # File was deleted

            try:
                content = repo.git.show(f"main:{change['filePath']}")
                change["oldContent"] = content
            except GitCommandError:
                change["oldContent"] = None  # New file

        return {"status": "success", "changes": changes, "hasPending": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/project/{chat_id}/git/accept")
async def git_accept(chat_id: str, request: GitAcceptRequest):
    """Accept pending changes — merge to main. Optionally accept specific files only."""
    try:
        repo = get_or_init_repo(chat_id)
        project_dir = get_project_dir(chat_id)

        if "pending" not in [b.name for b in repo.branches]:
            raise HTTPException(status_code=400, detail="No pending changes")

        if request.files is None:
            # Accept all: merge pending into main
            repo.git.checkout("main")
            repo.git.merge("pending", "-m", "Accept all agent changes")
            repo.git.branch("-D", "pending")
        else:
            # Partial accept: checkout specific files from pending
            repo.git.checkout("main")
            for file_path in request.files:
                try:
                    repo.git.checkout("pending", "--", file_path)
                except GitCommandError:
                    pass
            _commit_all(repo, f"Accept changes: {', '.join(request.files)}")

            # Check if there are remaining diffs
            remaining = repo.git.diff("main", "pending", "--name-only").strip()
            if not remaining:
                repo.git.branch("-D", "pending")

        return {"status": "success", "message": "Changes accepted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/project/{chat_id}/git/reject")
async def git_reject(chat_id: str):
    """Reject all pending changes — delete pending branch."""
    try:
        repo = get_or_init_repo(chat_id)

        if "pending" in [b.name for b in repo.branches]:
            repo.git.checkout("main")
            repo.git.branch("-D", "pending")

        return {"status": "success", "message": "Pending changes rejected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/project/{chat_id}/git/history")
async def git_history(chat_id: str):
    """Get commit history on main branch."""
    try:
        repo = get_or_init_repo(chat_id)
        commits = []

        try:
            for commit in repo.iter_commits("main", max_count=50):
                # Get changed files for this commit
                changed_files = []
                if commit.parents:
                    diff = commit.parents[0].diff(commit)
                    changed_files = [d.b_path or d.a_path for d in diff]

                commits.append({
                    "hash": str(commit)[:7],
                    "fullHash": str(commit),
                    "message": commit.message.strip(),
                    "date": commit.committed_datetime.isoformat(),
                    "files": changed_files,
                    "fileCount": len(changed_files),
                })
        except (ValueError, GitCommandError):
            pass  # No commits yet or branch doesn't exist

        return {"status": "success", "commits": commits}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/project/{chat_id}/git/checkout")
async def git_checkout(chat_id: str, request: GitCheckoutRequest):
    """Restore files from a specific commit."""
    try:
        repo = get_or_init_repo(chat_id)
        project_dir = get_project_dir(chat_id)

        # Checkout the commit's files onto main
        repo.git.checkout("main")
        repo.git.checkout(request.commit_hash, "--", ".")
        _commit_all(repo, f"Restored to {request.commit_hash[:7]}")

        # Read the restored files
        files = _read_all_files(project_dir)

        return {"status": "success", "files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
