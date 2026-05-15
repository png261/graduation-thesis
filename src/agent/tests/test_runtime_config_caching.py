import importlib
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


AGENT_DIR = Path(__file__).resolve().parents[1]
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))


def _install_module(name: str, **attrs):
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


def _passthrough_decorator(*_args, **_kwargs):
    def decorator(fn):
        return fn

    return decorator


class RuntimeConfigCachingTests(unittest.TestCase):
    def setUp(self):
        self._clear_imports()

    def tearDown(self):
        self._clear_imports()

    def _clear_imports(self):
        for name in (
            "utils.auth",
            "utils.ssm",
            "boto3",
            "bedrock_agentcore",
            "bedrock_agentcore.identity",
            "bedrock_agentcore.identity.auth",
            "bedrock_agentcore.runtime",
        ):
            sys.modules.pop(name, None)

    def test_openai_provider_api_key_is_cached_within_ttl(self):
        client_calls = []

        class FakeControl:
            def get_api_key_credential_provider(self, name):
                return {"apiKeySecretArn": {"secretArn": f"arn:{name}"}}

        class FakeSecrets:
            def get_secret_value(self, SecretId):
                return {"SecretString": '{"api_key":"cached-key"}'}

        def fake_client(service_name, **_kwargs):
            client_calls.append(service_name)
            if service_name == "bedrock-agentcore-control":
                return FakeControl()
            if service_name == "secretsmanager":
                return FakeSecrets()
            raise AssertionError(service_name)

        _install_module("boto3", client=fake_client)
        _install_module("bedrock_agentcore")
        _install_module("bedrock_agentcore.identity")
        _install_module(
            "bedrock_agentcore.identity.auth",
            requires_access_token=_passthrough_decorator,
            requires_api_key=_passthrough_decorator,
        )
        _install_module("bedrock_agentcore.runtime", RequestContext=object)

        auth = importlib.import_module("utils.auth")

        with patch.object(auth.time, "monotonic", side_effect=[100.0, 110.0]):
            self.assertEqual(auth._get_api_key_from_provider("provider"), "cached-key")
            self.assertEqual(auth._get_api_key_from_provider("provider"), "cached-key")

        self.assertEqual(client_calls, ["bedrock-agentcore-control", "secretsmanager"])

    def test_ssm_parameter_is_cached_within_ttl(self):
        get_parameter_calls = []

        class FakeParameterNotFound(Exception):
            pass

        class FakeSsm:
            class exceptions:
                ParameterNotFound = FakeParameterNotFound

            def get_parameter(self, Name):
                get_parameter_calls.append(Name)
                return {"Parameter": {"Value": "https://gateway.example"}}

        def fake_client(service_name, **_kwargs):
            self.assertEqual(service_name, "ssm")
            return FakeSsm()

        _install_module("boto3", client=fake_client)
        ssm = importlib.import_module("utils.ssm")

        with patch.object(ssm.time, "monotonic", side_effect=[100.0, 110.0]):
            self.assertEqual(ssm.get_ssm_parameter("/stack/gateway_url"), "https://gateway.example")
            self.assertEqual(ssm.get_ssm_parameter("/stack/gateway_url"), "https://gateway.example")

        self.assertEqual(get_parameter_calls, ["/stack/gateway_url"])


if __name__ == "__main__":
    unittest.main()
