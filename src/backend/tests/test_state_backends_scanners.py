from __future__ import annotations

from app.services.state_backends.scanners import scan_backend_candidates


def test_scan_backend_candidates_from_hcl_backend_block() -> None:
    files = [
        (
            "infra/main.tf",
            """
            terraform {
              backend "s3" {
                bucket = "aws-terraform-demo"
                key    = "states/prod.tfstate"
              }
            }
            """,
        )
    ]
    candidates = scan_backend_candidates(files)
    assert len(candidates) == 1
    assert candidates[0]["provider"] == "aws"
    assert candidates[0]["bucket"] == "aws-terraform-demo"
    assert candidates[0]["key"] == "states/prod.tfstate"


def test_scan_backend_candidates_regex_fallback_and_dedupe() -> None:
    files = [
        (
            "broken.tf",
            """
            terraform {
              backend "gcs" {
                bucket = "gcp-terraform-demo"
                prefix = "states"
            """,
        ),
        (
            "duplicate.tf",
            """
            terraform {
              backend "gcs" {
                bucket = "gcp-terraform-demo"
                prefix = "states"
              }
            }
            """,
        ),
    ]
    candidates = scan_backend_candidates(files)
    assert len(candidates) == 1
    assert candidates[0]["provider"] == "gcs"
    assert candidates[0]["bucket"] == "gcp-terraform-demo"
    assert candidates[0]["prefix"] == "states"


def test_scan_backend_candidates_infers_ci_vars() -> None:
    files = [
        (
            ".gitlab-ci.yml",
            """
            variables:
              TF_STATE_BUCKET: gcp-shared-state
              TF_STATE_PREFIX: states
            """,
        )
    ]
    candidates = scan_backend_candidates(files)
    assert len(candidates) == 1
    assert candidates[0]["provider"] == "gcs"
    assert candidates[0]["bucket"] == "gcp-shared-state"
    assert candidates[0]["prefix"] == "states"
    assert candidates[0]["source_path"] == "ci_vars"
