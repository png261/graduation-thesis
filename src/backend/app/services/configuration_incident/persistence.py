from app.services.configuration_incident.db import runtime
from app.services.configuration_incident.models import IncidentSummary

get_session = runtime.get_session

__all__ = ["IncidentSummary", "get_session"]
