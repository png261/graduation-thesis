import logging


def _configure_noisy_dependency_loggers() -> None:
    logging.getLogger("langchain_google_genai._function_utils").setLevel(logging.ERROR)


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    _configure_noisy_dependency_loggers()
