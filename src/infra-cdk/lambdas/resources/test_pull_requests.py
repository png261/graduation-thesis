import importlib.util
import os
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import Mock, patch


def load_index_module():
    os.environ.setdefault("TABLE_NAME", "test-table")
    os.environ.setdefault("CODEBUILD_PROJECT_NAME", "test-project")
    os.environ.setdefault("STACK_NAME_BASE", "test-stack")
    os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
    module_path = Path(__file__).with_name("index.py")
    spec = importlib.util.spec_from_file_location("resources_index_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    with patch("boto3.resource") as resource, patch("boto3.client") as client:
      resource.return_value.Table.return_value = Mock()
      client.return_value = Mock()
      assert spec.loader is not None
      spec.loader.exec_module(module)
    return module


class PullRequestFilteringTests(TestCase):
    def setUp(self):
        self.module = load_index_module()

    def test_renamed_github_app_bot_author_is_included(self):
        self.assertTrue(
            self.module._is_github_app_pull_request(
                "old-app-name[bot]",
                "feature/update",
                created_by_github_app=False,
                bot_logins={"new-app-name[bot]"},
            )
        )

    def test_pull_request_listing_reads_all_pages_and_keeps_bot_authored_prs(self):
        self.module._github_app_bot_logins = lambda: {"new-app-name[bot]"}
        self.module._list_live_github_pull_requests = Mock(return_value=[])
        self.module.table = Mock()
        self.module.table.query.side_effect = [
            {
                "Items": [
                    {
                        "number": 1,
                        "repository": "png261/hcp-terraform",
                        "author": "old-app-name[bot]",
                        "headBranch": "feature/one",
                        "state": "open",
                        "githubUpdatedAt": "2026-05-01T00:00:00Z",
                    }
                ],
                "LastEvaluatedKey": {"pk": "GITHUB#png261/hcp-terraform", "sk": "PR#1"},
            },
            {
                "Items": [
                    {
                        "number": 2,
                        "repository": "png261/hcp-terraform",
                        "author": "new-app-name[bot]",
                        "headBranch": "agentcore/session",
                        "state": "open",
                        "githubUpdatedAt": "2026-05-02T00:00:00Z",
                    },
                    {
                        "number": 3,
                        "repository": "png261/hcp-terraform",
                        "author": "human",
                        "headBranch": "feature/human",
                        "state": "open",
                        "githubUpdatedAt": "2026-05-03T00:00:00Z",
                    },
                ]
            },
        ]

        result = self.module._list_github_pull_requests("png261/hcp-terraform", "all")

        self.assertEqual([item["number"] for item in result], [2, 1])
        self.assertEqual(self.module.table.query.call_count, 2)

    def test_pull_request_listing_merges_live_github_bot_prs(self):
        self.module._github_app_bot_logins = lambda: {"new-app-name[bot]"}
        self.module._list_live_github_pull_requests = Mock(
            return_value=[
                {
                    "number": 4,
                    "repository": "png261/hcp-terraform",
                    "author": "renamed-app[bot]",
                    "authorType": "Bot",
                    "headBranch": "feature/live",
                    "state": "open",
                    "title": "Live bot PR",
                    "githubUpdatedAt": "2026-05-04T00:00:00Z",
                },
                {
                    "number": 5,
                    "repository": "png261/hcp-terraform",
                    "author": "human",
                    "authorType": "User",
                    "headBranch": "feature/human",
                    "state": "open",
                    "title": "Human PR",
                    "githubUpdatedAt": "2026-05-05T00:00:00Z",
                },
            ]
        )
        self.module.table = Mock()
        self.module.table.query.return_value = {"Items": []}

        result = self.module._list_github_pull_requests("png261/hcp-terraform", "all")

        self.assertEqual([item["number"] for item in result], [4])
        self.assertEqual(result[0]["title"], "Live bot PR")


if __name__ == "__main__":
    main()
