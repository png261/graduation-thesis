from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import boto3
import os
import subprocess
import tempfile
import shutil
from python_terraform import Terraform

app = FastAPI()

# LocalStack configuration
LOCALSTACK_ENDPOINT = os.getenv("LOCALSTACK_ENDPOINT", "http://localstack:4566")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

PROJECTS_DIR = os.getenv("PROJECTS_DIR", os.path.join(os.getcwd(), "projects"))

class TerraformRequest(BaseModel):
    files: dict[str, str] = {}
    chatId: str | None = None

def get_project_dir(chat_id: str):
    project_path = os.path.join(PROJECTS_DIR, chat_id)
    os.makedirs(project_path, exist_ok=True)
    return project_path

def write_files(target_dir, files):
    # Write user-provided files
    for filename, content in files.items():
        # Prevent directory traversal
        safe_filename = filename # trusting the input for now, but in prod should be careful
        # Verify it doesn't go outside
        full_path = os.path.abspath(os.path.join(target_dir, safe_filename))
        if not full_path.startswith(os.path.abspath(target_dir)):
             continue
             
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)

    # Configure provider to use LocalStack
    # We always overwrite localstack_override.tf to ensure it's up to date
    with open(os.path.join(target_dir, "localstack_override.tf"), "w") as f:
        f.write(f"""
provider "aws" {{
  access_key = "test"
  secret_key = "test"
  region     = "{AWS_REGION}"
  s3_use_path_style           = true
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  endpoints {{
    s3             = "{LOCALSTACK_ENDPOINT}"
    dynamodb       = "{LOCALSTACK_ENDPOINT}"
    lambda         = "{LOCALSTACK_ENDPOINT}"
    iam            = "{LOCALSTACK_ENDPOINT}"
    sts            = "{LOCALSTACK_ENDPOINT}"
    # Add other services as needed
  }}
}}
""")

@app.post("/project/{chat_id}/files")
async def save_project_files(chat_id: str, request: TerraformRequest):
    try:
        project_dir = get_project_dir(chat_id)
        write_files(project_dir, request.files)
        return {"status": "success", "message": "Files saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/project/{chat_id}/files")
async def get_project_files(chat_id: str):
    project_dir = os.path.join(PROJECTS_DIR, chat_id)
    if not os.path.exists(project_dir):
         return {"files": {}}
    
    files = {}
    # Walk the directory
    for root, _, filenames in os.walk(project_dir):
        for filename in filenames:
            if filename == ".terraform.lock.hcl" or filename.startswith(".terraform") or filename == "localstack_override.tf":
                continue
            
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, project_dir)
            
            with open(full_path, "r") as f:
                try:
                    content = f.read()
                    files[rel_path] = content
                except UnicodeDecodeError:
                    pass # Skip binary files
                    
    return {"files": files}

@app.post("/terraform/plan")
async def terraform_plan(request: TerraformRequest):
    if request.chatId:
        work_dir = get_project_dir(request.chatId)
        # Update any files if provided
        if request.files:
            write_files(work_dir, request.files)
    else:
        # Fallback to temp dir if no chatId (legacy support)
        # We can't really do this easily with context manager across return
        # So providing files is mandatory if no chatId for ephemeral run
        # But we really want to enforce chatId usage.
        # For now, let's create a temp dir that we clean up?
        # Actually logic is complex to mix. Let's assume chatId is provided or use temp.
        pass

    # Logic to run terraform
    # If chatId is present, use that dir. If not, use temp dir.
    
    async def run_terraform_in_dir(cwd):
        # Init
        init_proc = subprocess.run(
            ["terraform", "init", "-no-color"], 
            cwd=cwd, 
            capture_output=True, 
            text=True
        )
        if init_proc.returncode != 0:
             return {"status": "error", "message": "Init failed", "details": init_proc.stderr or init_proc.stdout}

        # Plan
        plan_proc = subprocess.run(
            ["terraform", "plan", "-no-color", "-input=false"], 
            cwd=cwd, 
            capture_output=True, 
            text=True
        )
        
        if plan_proc.returncode != 0 and plan_proc.returncode != 2:
             return {"status": "error", "message": "Plan failed", "details": plan_proc.stderr or plan_proc.stdout}
        
        return {"status": "success", "output": plan_proc.stdout}

    if request.chatId:
        work_dir = get_project_dir(request.chatId)
        if request.files:
            write_files(work_dir, request.files)
        return await run_terraform_in_dir(work_dir)
    else:
        with tempfile.TemporaryDirectory() as temp_dir:
            write_files(temp_dir, request.files)
            return await run_terraform_in_dir(temp_dir)

class FileRequest(BaseModel):
    path: str
    content: str | None = None

@app.post("/project/{chat_id}/file")
async def create_file(chat_id: str, request: FileRequest):
    try:
        project_dir = get_project_dir(chat_id)
        
        # Security check
        full_path = os.path.abspath(os.path.join(project_dir, request.path))
        if not full_path.startswith(os.path.abspath(project_dir)):
             raise HTTPException(status_code=400, detail="Invalid path")
             
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(request.content or "")
            
        return {"status": "success", "message": "File created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/project/{chat_id}/folder")
async def create_folder(chat_id: str, request: FileRequest):
    try:
        project_dir = get_project_dir(chat_id)
        
        # Security check
        full_path = os.path.abspath(os.path.join(project_dir, request.path))
        if not full_path.startswith(os.path.abspath(project_dir)):
             raise HTTPException(status_code=400, detail="Invalid path")
             
        os.makedirs(full_path, exist_ok=True)
        return {"status": "success", "message": "Folder created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/project/{chat_id}/file")
async def delete_file(chat_id: str, request: FileRequest):
    try:
        project_dir = get_project_dir(chat_id)
        full_path = os.path.abspath(os.path.join(project_dir, request.path))
        if not full_path.startswith(os.path.abspath(project_dir)):
             raise HTTPException(status_code=400, detail="Invalid path")
        
        if os.path.exists(full_path) and os.path.isfile(full_path):
            os.remove(full_path)
            
        return {"status": "success", "message": "File deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/project/{chat_id}/folder")
async def delete_folder(chat_id: str, request: FileRequest):
    try:
        project_dir = get_project_dir(chat_id)
        full_path = os.path.abspath(os.path.join(project_dir, request.path))
        if not full_path.startswith(os.path.abspath(project_dir)):
             raise HTTPException(status_code=400, detail="Invalid path")
             
        if os.path.exists(full_path) and os.path.isdir(full_path):
            shutil.rmtree(full_path)
            
        return {"status": "success", "message": "Folder deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class FileRequest(BaseModel):
    path: str
    content: str | None = None

@app.post("/project/{chat_id}/file")
async def create_file(chat_id: str, request: FileRequest):
    try:
        project_dir = get_project_dir(chat_id)
        
        # Security check
        full_path = os.path.abspath(os.path.join(project_dir, request.path))
        if not full_path.startswith(os.path.abspath(project_dir)):
             raise HTTPException(status_code=400, detail="Invalid path")
             
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(request.content or "")
            
        return {"status": "success", "message": "File created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/project/{chat_id}/folder")
async def create_folder(chat_id: str, request: FileRequest):
    try:
        project_dir = get_project_dir(chat_id)
        
        # Security check
        full_path = os.path.abspath(os.path.join(project_dir, request.path))
        if not full_path.startswith(os.path.abspath(project_dir)):
             raise HTTPException(status_code=400, detail="Invalid path")
             
        os.makedirs(full_path, exist_ok=True)
        return {"status": "success", "message": "Folder created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/project/{chat_id}/file")
async def delete_file(chat_id: str, request: FileRequest):
    try:
        project_dir = get_project_dir(chat_id)
        full_path = os.path.abspath(os.path.join(project_dir, request.path))
        if not full_path.startswith(os.path.abspath(project_dir)):
             raise HTTPException(status_code=400, detail="Invalid path")
        
        if os.path.exists(full_path) and os.path.isfile(full_path):
            os.remove(full_path)
            
        return {"status": "success", "message": "File deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/project/{chat_id}/folder")
async def delete_folder(chat_id: str, request: FileRequest):
    try:
        project_dir = get_project_dir(chat_id)
        full_path = os.path.abspath(os.path.join(project_dir, request.path))
        if not full_path.startswith(os.path.abspath(project_dir)):
             raise HTTPException(status_code=400, detail="Invalid path")
             
        if os.path.exists(full_path) and os.path.isdir(full_path):
            shutil.rmtree(full_path)
            
        return {"status": "success", "message": "Folder deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/terraform/apply")
async def terraform_apply(request: TerraformRequest):
    async def run_apply_in_dir(cwd):
        # Init
        init_proc = subprocess.run(
            ["terraform", "init", "-no-color"], 
            cwd=cwd, 
            capture_output=True, 
            text=True
        )
        if init_proc.returncode != 0:
             return {"status": "error", "message": "Init failed", "details": init_proc.stderr or init_proc.stdout}

        # Apply
        apply_proc = subprocess.run(
            ["terraform", "apply", "-auto-approve", "-no-color", "-input=false"], 
            cwd=cwd, 
            capture_output=True, 
            text=True
        )
        
        if apply_proc.returncode != 0:
             return {"status": "error", "message": "Apply failed", "details": apply_proc.stderr or apply_proc.stdout}
        
        return {"status": "success", "output": apply_proc.stdout}

    if request.chatId:
        work_dir = get_project_dir(request.chatId)
        if request.files:
             write_files(work_dir, request.files)
        return await run_apply_in_dir(work_dir)
    else:
        with tempfile.TemporaryDirectory() as temp_dir:
            write_files(temp_dir, request.files)
            return await run_apply_in_dir(temp_dir)
