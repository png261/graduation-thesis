from __future__ import annotations


class JobsError(Exception):
    def __init__(self, message: str, *, code: str = "jobs_error", status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


class JobConflictError(JobsError):
    def __init__(self, message: str = "Another mutating job is already active for this project") -> None:
        super().__init__(message, code="job_conflict", status_code=409)


class JobNotFoundError(JobsError):
    def __init__(self, message: str = "Job not found") -> None:
        super().__init__(message, code="job_not_found", status_code=404)


class JobValidationError(JobsError):
    def __init__(self, message: str) -> None:
        super().__init__(message, code="invalid_job_payload", status_code=400)
