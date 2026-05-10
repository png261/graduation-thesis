"""
Custom Resource Lambda for creating/deleting OpenAI API Key Credential Provider.

This Lambda manages the lifecycle of an AgentCore Identity API Key Credential Provider
that stores OpenAI API credentials (api_key, base_url, model_id) in the Token Vault.
"""

import json
import logging
import os

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

agentcore_client = boto3.client("bedrock-agentcore-control")
secrets_client = boto3.client("secretsmanager")


def handler(event, context):
    """
    CloudFormation Custom Resource handler for OpenAI API Key Credential Provider.

    Creates/updates/deletes an ApiKeyCredentialProvider and stores credentials in Token Vault.
    """
    logger.info(f"Received event: {json.dumps(event, default=str)}")

    request_type = event["RequestType"]
    properties = event["ResourceProperties"]

    provider_name = properties["ProviderName"]
    api_key_secret_arn = properties["ApiKeySecretArn"]
    base_url = properties["BaseUrl"]
    model_id = properties["ModelId"]
    api_key_format = properties.get("ApiKeyFormat", "field")

    try:
        if request_type == "Create":
            return create_provider(provider_name, api_key_secret_arn, base_url, model_id, api_key_format)
        elif request_type == "Update":
            return update_provider(provider_name, api_key_secret_arn, base_url, model_id, api_key_format)
        elif request_type == "Delete":
            return delete_provider(provider_name)
        else:
            raise ValueError(f"Unknown request type: {request_type}")

    except Exception as e:
        logger.exception(f"Error handling {request_type} request")
        raise


def resolve_api_key_value(api_key_secret_arn, api_key_format):
    secret_string = get_secret_value(api_key_secret_arn)
    if api_key_format == "raw_json":
        credentials = get_secret_json(api_key_secret_arn)
        private_key = (
            credentials.get("api_key")
            or credentials.get("private_key")
            or credentials.get("private_key_pem")
            or ""
        )
        if not private_key:
            raise ValueError("api_key, private_key, or private_key_pem is required in the secret JSON")
        return secret_string

    credentials = get_secret_json(api_key_secret_arn)
    api_key = credentials.get("api_key", "")
    if not api_key:
        raise ValueError("api_key is required in the secret JSON")
    return api_key


def create_provider(provider_name, api_key_secret_arn, base_url, model_id, api_key_format):
    """Create API Key Credential Provider and Token Vault."""
    logger.info(f"Creating API Key Credential Provider: {provider_name}")

    # The AgentCore service supports tags in newer SDK models, but the Lambda
    # runtime boto3 version may lag. Keep provider creation to the stable fields
    # required by all currently deployed runtimes.
    api_key = resolve_api_key_value(api_key_secret_arn, api_key_format)

    # Create Token Vault if it doesn't exist
    ensure_token_vault_exists()

    # Create API Key Credential Provider
    response = agentcore_client.create_api_key_credential_provider(
        name=provider_name,
        apiKey=api_key,
    )

    provider_arn = response["credentialProviderArn"]
    logger.info(f"Created API Key Credential Provider: {provider_arn}")

    return {
        "Status": "SUCCESS",
        "PhysicalResourceId": provider_name,
        "Data": {
            "ProviderArn": provider_arn,
            "ProviderName": provider_name,
        },
    }


def update_provider(provider_name, api_key_secret_arn, base_url, model_id, api_key_format):
    """Update API Key Credential Provider."""
    logger.info(f"Updating API Key Credential Provider: {provider_name}")

    api_key = resolve_api_key_value(api_key_secret_arn, api_key_format)

    # Update the provider, or create it if a previous custom resource run failed before creation.
    try:
        response = agentcore_client.update_api_key_credential_provider(
            name=provider_name,
            apiKey=api_key,
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceNotFoundException":
            return create_provider(provider_name, api_key_secret_arn, base_url, model_id, api_key_format)
        raise

    provider_arn = response["credentialProviderArn"]
    logger.info(f"Updated API Key Credential Provider: {provider_arn}")

    return {
        "Status": "SUCCESS",
        "PhysicalResourceId": provider_name,
        "Data": {
            "ProviderArn": provider_arn,
            "ProviderName": provider_name,
        },
    }


def delete_provider(provider_name):
    """Delete API Key Credential Provider."""
    logger.info(f"Deleting API Key Credential Provider: {provider_name}")

    try:
        agentcore_client.delete_api_key_credential_provider(name=provider_name)
        logger.info(f"Deleted API Key Credential Provider: {provider_name}")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceNotFoundException":
            logger.info(f"Provider {provider_name} not found, skipping deletion")
        else:
            raise

    return {
        "Status": "SUCCESS",
        "PhysicalResourceId": provider_name,
    }


def ensure_token_vault_exists():
    """Ensure Token Vault exists (create if needed)."""
    try:
        agentcore_client.get_token_vault(tokenVaultId="default")
        logger.info("Token Vault 'default' already exists")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceNotFoundException":
            logger.info("Token Vault 'default' does not exist yet")
        else:
            raise


def get_secret_value(secret_arn):
    """Retrieve secret value from Secrets Manager."""
    response = secrets_client.get_secret_value(SecretId=secret_arn)
    return response["SecretString"]


def get_secret_json(secret_arn):
    """Retrieve secret as JSON from Secrets Manager."""
    import json

    secret_string = get_secret_value(secret_arn)
    try:
        return json.loads(secret_string)
    except json.JSONDecodeError:
        # If it's not JSON, treat it as a plain API key for backward compatibility
        return {"api_key": secret_string}
