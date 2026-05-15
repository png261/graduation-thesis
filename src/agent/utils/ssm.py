"""
SSM Parameter Store utilities for the agent.

Provides a single shared function for fetching parameters from AWS SSM
Parameter Store, used by agents to retrieve configuration values like
Gateway URLs that are set during deployment.
"""

import logging
import os
import time

import boto3

logger = logging.getLogger(__name__)

_SSM_PARAMETER_CACHE: dict[tuple[str, str], tuple[float, str]] = {}
_DEFAULT_SSM_PARAMETER_CACHE_TTL_SECONDS = 300


def get_ssm_parameter(parameter_name: str) -> str:
    """
    Fetch a parameter value from AWS SSM Parameter Store.

    SSM Parameter Store is AWS's service for storing configuration values
    securely. This function retrieves values like Gateway URLs and other
    stack-specific configuration that are set during CDK deployment.

    Args:
        parameter_name (str): The full SSM parameter name/path
            (e.g. '/my-stack/gateway_url').

    Returns:
        str: The parameter value.

    Raises:
        ValueError: If the parameter is not found or cannot be retrieved.
    """
    region = os.environ.get(
        "AWS_REGION",
        os.environ.get("AWS_DEFAULT_REGION", "ap-southeast-1"),
    )
    cache_key = (region, parameter_name)
    cached_value = _get_cached_parameter(cache_key)
    if cached_value:
        return cached_value

    ssm = boto3.client("ssm", region_name=region)
    try:
        response = ssm.get_parameter(Name=parameter_name)
        value = response["Parameter"]["Value"]
        if value:
            _SSM_PARAMETER_CACHE[cache_key] = (time.monotonic(), value)
        return value
    except ssm.exceptions.ParameterNotFound:
        raise ValueError(f"SSM parameter not found: {parameter_name}")
    except Exception as e:
        raise ValueError(f"Failed to retrieve SSM parameter {parameter_name}: {e}")


def _get_cached_parameter(cache_key: tuple[str, str]) -> str:
    cached = _SSM_PARAMETER_CACHE.get(cache_key)
    if cached is None:
        return ""
    cached_at, value = cached
    if time.monotonic() - cached_at <= _ssm_parameter_cache_ttl_seconds():
        return value
    _SSM_PARAMETER_CACHE.pop(cache_key, None)
    return ""


def _ssm_parameter_cache_ttl_seconds() -> int:
    raw_value = os.environ.get(
        "SSM_PARAMETER_CACHE_TTL_SECONDS",
        str(_DEFAULT_SSM_PARAMETER_CACHE_TTL_SECONDS),
    )
    try:
        return max(0, int(raw_value))
    except ValueError:
        logger.warning(
            "Invalid SSM_PARAMETER_CACHE_TTL_SECONDS=%r; using %s",
            raw_value,
            _DEFAULT_SSM_PARAMETER_CACHE_TTL_SECONDS,
        )
        return _DEFAULT_SSM_PARAMETER_CACHE_TTL_SECONDS
