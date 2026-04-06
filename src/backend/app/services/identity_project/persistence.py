from app.services.identity_project.db import runtime
from app.services.identity_project.models import Project, User

get_session = runtime.get_session

__all__ = ["Project", "User", "get_session"]
