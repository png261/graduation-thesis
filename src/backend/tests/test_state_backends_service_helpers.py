from __future__ import annotations

from types import SimpleNamespace

from app.services.state_backends import service


def test_extract_resource_instances_builds_addresses_and_provider() -> None:
    state = {
        "resources": [
            {
                "module": "module.network",
                "type": "aws_subnet",
                "name": "private",
                "provider": 'provider["registry.terraform.io/hashicorp/aws"]',
                "instances": [
                    {"attributes": {"id": "subnet-1", "region": "us-east-1"}},
                    {"attributes": {"id": "subnet-2", "region": "us-east-1"}},
                ],
            }
        ]
    }
    items = service._extract_resource_instances(state)
    assert [row["address"] for row in items] == [
        "module.network.aws_subnet.private[0]",
        "module.network.aws_subnet.private[1]",
    ]
    assert all(row["provider"] == "aws" for row in items)


def test_resource_diff_tracks_added_deleted_changed() -> None:
    previous = [
        SimpleNamespace(address="aws_vpc.main", attributes_json={"id": "vpc-1", "cidr_block": "10.0.0.0/16"}),
        SimpleNamespace(address="aws_subnet.private", attributes_json={"id": "subnet-1"}),
    ]
    current = [
        {"address": "aws_vpc.main", "attributes": {"id": "vpc-1", "cidr_block": "10.1.0.0/16"}},
        {"address": "aws_internet_gateway.main", "attributes": {"id": "igw-1"}},
    ]
    assert service._resource_diff(previous, current) == {"added": 1, "deleted": 1, "changed": 1}


def test_parse_opa_output_handles_nested_payload() -> None:
    payload = {
        "result": [
            {
                "expressions": [
                    {
                        "value": [
                            {"rule_id": "deny_public_bucket", "severity": "high"},
                        ]
                    }
                ]
            }
        ]
    }
    assert service._parse_opa_output(payload) == [{"rule_id": "deny_public_bucket", "severity": "high"}]


def test_resolve_console_urls_for_supported_resources() -> None:
    aws = service._resolve_console_url("aws", "aws_instance", {"id": "i-123", "region": "us-east-1"})
    gcs = service._resolve_console_url("gcs", "google_storage_bucket", {"name": "my-bucket"})
    assert aws is not None and "InstanceDetails" in aws
    assert gcs == "https://console.cloud.google.com/storage/browser/my-bucket"


def test_severity_for_status_mapping() -> None:
    assert service._severity_for_status("drifted") == "high"
    assert service._severity_for_status("unverifiable") == "medium"
    assert service._severity_for_status("active") == "low"
