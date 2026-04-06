from app.services.identity_project.models import Project
from app.services.workflow.db import runtime
from app.services.workflow.models import ProjectJob

get_session = runtime.get_session

__all__ = ["Project", "ProjectJob", "get_session"]
