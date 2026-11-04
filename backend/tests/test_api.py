from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlsplit

_temp_dir = tempfile.TemporaryDirectory()
os.environ["LIFE_LOGGER_DB"] = str(Path(_temp_dir.name) / "test.db")
for _name in ("SMTP_HOST", "SMTP_FROM"):
    os.environ.pop(_name, None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

import database  # noqa: E402
import main  # noqa: E402

PASSWORD = "correct-horse"


def register(client: TestClient, email: str, name: str = "測試者"):
    return client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "display_name": name},
    )


def new_user(email: str, name: str = "測試者") -> TestClient:
    client = TestClient(main.app)
    assert register(client, email, name).status_code == 201
    return client


REAL_REGION_AT = main.region_at
REGION_LOOKUP_PATCH = mock.patch.object(main, "region_at", return_value=(None, None))


def setUpModule() -> None:
    # Saving a located stop looks up its region; tests must not reach the network.
    REGION_LOOKUP_PATCH.start()


def tearDownModule() -> None:
    REGION_LOOKUP_PATCH.stop()


class ApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app_client = TestClient(main.app)
        cls.app_client.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.app_client.__exit__(None, None, None)

    def setUp(self) -> None:
        main._login_failures.clear()


class AuthTests(ApiTestCase):
    def test_register_cannot_take_over_passwordless_account(self) -> None:
        with main.get_connection() as conn:
            conn.execute(
                "INSERT INTO users (email, password_hash, display_name) "
                "VALUES ('oauth@example.com', NULL, 'OAuth User')"
            )
            conn.commit()

        response = register(TestClient(main.app), "oauth@example.com", "Attacker")

        self.assertEqual(response.status_code, 409)
        self.assertNotIn("set-cookie", response.headers)
        with main.get_connection() as conn:
            row = conn.execute(
                "SELECT password_hash, display_name FROM users WHERE email = ?",
                ("oauth@example.com",),
            ).fetchone()
        self.assertIsNone(row["password_hash"])
        self.assertEqual(row["display_name"], "OAuth User")

    def test_register_rejects_short_password(self) -> None:
        response = TestClient(main.app).post(
            "/api/auth/register",
            json={
                "email": "short@example.com",
                "password": "1234567",
                "display_name": "短密碼",
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_login_locks_after_repeated_failures_only_for_that_account(self) -> None:
        new_user("locked@example.com")
        new_user("other@example.com")
        client = TestClient(main.app)
        wrong = {"email": "locked@example.com", "password": "wrong-password"}

        for _ in range(main.LOGIN_MAX_FAILURES):
            self.assertEqual(client.post("/api/auth/login", json=wrong).status_code, 401)
        self.assertEqual(client.post("/api/auth/login", json=wrong).status_code, 429)
        correct = {"email": "locked@example.com", "password": PASSWORD}
        self.assertEqual(client.post("/api/auth/login", json=correct).status_code, 429)

        other = {"email": "other@example.com", "password": PASSWORD}
        self.assertEqual(client.post("/api/auth/login", json=other).status_code, 200)

    def test_successful_login_resets_failure_count(self) -> None:
        new_user("reset@example.com")
        client = TestClient(main.app)
        wrong = {"email": "reset@example.com", "password": "wrong-password"}
        correct = {"email": "reset@example.com", "password": PASSWORD}

        for _ in range(main.LOGIN_MAX_FAILURES - 1):
            client.post("/api/auth/login", json=wrong)
        self.assertEqual(client.post("/api/auth/login", json=correct).status_code, 200)
        self.assertEqual(client.post("/api/auth/login", json=wrong).status_code, 401)
        self.assertEqual(client.post("/api/auth/login", json=correct).status_code, 200)

    def test_logout_invalidates_session(self) -> None:
        client = new_user("logout@example.com")
        self.assertEqual(client.get("/api/auth/me").status_code, 200)
        client.post("/api/auth/logout")
        self.assertEqual(client.get("/api/auth/me").status_code, 401)


class EntryTests(ApiTestCase):
    def test_entries_require_login(self) -> None:
        response = TestClient(main.app).post(
            "/api/entries", json={"title": "標題", "content": "內容"}
        )
        self.assertEqual(response.status_code, 401)

    def test_create_entry_accepts_every_privacy_option(self) -> None:
        client = new_user("privacy@example.com")
        for privacy in ("private", "friends", "followers", "public"):
            response = client.post(
                "/api/entries",
                json={"title": "標題", "content": "內容", "privacy": privacy},
            )
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()["privacy"], privacy)

    def test_create_entry_validates_input(self) -> None:
        client = new_user("validate@example.com")
        invalid_payloads = [
            {"title": "   ", "content": "內容"},
            {"title": "標題", "content": "  "},
            {"title": "標題", "content": "內" * 12001},
            {"title": "標題", "content": "內容", "privacy": "shared"},
        ]
        for payload in invalid_payloads:
            self.assertEqual(
                client.post("/api/entries", json=payload).status_code, 422
            )

    def test_entries_stay_hidden_from_followers_at_every_privacy_level(self) -> None:
        author = new_user("author@example.com")
        follower = new_user("follower@example.com")
        for privacy in ("private", "friends", "followers", "public"):
            author.post(
                "/api/entries",
                json={"title": privacy, "content": "內容", "privacy": privacy},
            )
        follow = follower.post("/api/friends", json={"email": "author@example.com"})
        self.assertEqual(follow.status_code, 201)

        titles = {
            entry["title"]
            for entry in follower.get("/api/entries").json()
            if not entry["is_owner"]
        }

        self.assertEqual(titles, set())

    def test_entry_read_and_privacy_routes_persist_to_sqlite(self) -> None:
        client = new_user("entry-read@example.com")
        created = client.post(
            "/api/entries",
            json={
                "title": "夕陽散步",
                "content": "今天沿著河岸散步。",
                "privacy": "private",
            },
        )
        self.assertEqual(created.status_code, 201)
        entry_id = created.json()["id"]

        fetched = client.get(f"/api/entries/{entry_id}")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["title"], "夕陽散步")
        self.assertEqual(
            client.patch(
                f"/api/entries/{entry_id}/privacy",
                json={"privacy": "public"},
            ).json()["privacy"],
            "public",
        )
        listed = client.get("/api/entries")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(
            next(entry for entry in listed.json() if entry["id"] == entry_id)[
                "privacy"
            ],
            "public",
        )

    def test_entry_can_be_edited_and_deleted_by_owner(self) -> None:
        owner = new_user("entry-edit@example.com")
        other = new_user("entry-other@example.com")
        created = owner.post(
            "/api/entries",
            json={
                "title": "原標題",
                "content": "原內容",
                "mood": "平靜",
                "location": "河岸",
                "privacy": "private",
                "tags": "散步",
            },
        )
        entry_id = created.json()["id"]

        forbidden = other.put(
            f"/api/entries/{entry_id}",
            json={"title": "不該改", "content": "他人的日記"},
        )
        self.assertEqual(forbidden.status_code, 404)

        updated = owner.put(
            f"/api/entries/{entry_id}",
            json={
                "title": "更新標題",
                "content": "更新內容",
                "mood": "開心",
                "location": None,
                "privacy": "friends",
                "tags": "生活,記錄",
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["title"], "更新標題")
        self.assertEqual(updated.json()["privacy"], "friends")

        deleted = owner.delete(f"/api/entries/{entry_id}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(owner.get(f"/api/entries/{entry_id}").status_code, 404)

    def test_entry_edit_window_is_enforced_by_server_but_old_entries_can_be_deleted(self) -> None:
        client = new_user("entry-window@example.com")
        created = client.post(
            "/api/entries", json={"title": "舊日記", "content": "內容"}
        )
        entry_id = created.json()["id"]
        with main.get_connection() as conn:
            conn.execute(
                "UPDATE entries SET created_at = '2020-01-01 00:00:00' WHERE id = ?",
                (entry_id,),
            )
            conn.commit()

        blocked = client.put(
            f"/api/entries/{entry_id}",
            json={"title": "不能修改", "content": "內容"},
        )
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()["detail"], "發布已超過 24 小時，無法變更內容")
        self.assertEqual(client.delete(f"/api/entries/{entry_id}").status_code, 204)

    def test_entry_mutations_require_login(self) -> None:
        client = TestClient(main.app)
        self.assertEqual(
            client.put("/api/entries/1", json={"title": "標題", "content": "內容"}).status_code,
            401,
        )
        self.assertEqual(client.delete("/api/entries/1").status_code, 401)


class SocialProfileTests(ApiTestCase):
    def test_account_search_returns_safe_matching_profiles(self) -> None:
        viewer = new_user("zzlife-viewer@example.com", "搜尋者")
        target = new_user("zzlife-friend@example.com", "旅行好友")
        private = new_user("zzlife-private@example.com", "私人好友")
        private.patch("/api/user/profile", json={"is_private": True})

        response = viewer.get("/api/users/search", params={"q": "@zzlife"})

        self.assertEqual(response.status_code, 200)
        results = response.json()
        self.assertEqual(
            {person["username"] for person in results},
            {"zzlife_friend", "zzlife_private"},
        )
        self.assertTrue(results[0]["username"].startswith("zzlife"))
        self.assertTrue(any(person["is_private"] for person in results))
        self.assertTrue(all("email" not in person for person in results))
        self.assertNotIn(
            viewer.get("/api/auth/me").json()["user"]["id"],
            {person["id"] for person in results},
        )

    def private_account(self, email: str) -> tuple[TestClient, int]:
        client = new_user(email, "私人作者")
        client.patch("/api/user/profile", json={"is_private": True})
        client.post(
            "/api/map-points",
            json={
                "name": f"私帳貼文 {email}",
                "latitude": 22.6,
                "longitude": 120.2,
                "privacy": "public",
            },
        )
        return client, client.get("/api/auth/me").json()["user"]["id"]

    def test_following_a_private_account_waits_for_approval(self) -> None:
        author, author_id = self.private_account("request-author@example.com")
        fan = new_user("request-fan@example.com", "想追蹤的人")
        fan_id = fan.get("/api/auth/me").json()["user"]["id"]

        def sees() -> bool:
            name = "私帳貼文 request-author@example.com"
            return name in {p["name"] for p in fan.get("/api/map-points").json()}

        requested = fan.post(f"/api/users/{author_id}/follow").json()
        self.assertFalse(requested["is_following"])
        self.assertTrue(requested["is_requested"])
        self.assertFalse(sees())
        self.assertEqual(author.get("/api/user/relations/followers").json(), [])
        profile = fan.get(f"/api/users/{author_id}/profile").json()
        self.assertTrue(profile["profile"]["is_requested"])
        self.assertEqual(profile["posts"], [])
        self.assertEqual(author.get("/api/user/profile").json()["follow_requests_count"], 1)
        pending = author.get("/api/user/follow-requests").json()
        self.assertEqual([person["id"] for person in pending], [fan_id])
        self.assertNotIn("email", pending[0])

        # Asking again changes nothing, and neither does the follow-by-email route.
        fan.post(f"/api/users/{author_id}/follow")
        by_email = fan.post("/api/friends", json={"email": "request-author@example.com"})
        self.assertTrue(by_email.json()["is_requested"])
        self.assertEqual(len(author.get("/api/user/follow-requests").json()), 1)
        self.assertFalse(sees())

        self.assertEqual(
            author.post(f"/api/user/follow-requests/{fan_id}/accept").status_code, 204
        )
        self.assertTrue(sees())
        self.assertEqual(author.get("/api/user/follow-requests").json(), [])
        self.assertEqual(author.get("/api/user/profile").json()["followers_count"], 1)
        self.assertTrue(fan.post(f"/api/users/{author_id}/follow").json()["is_following"])

    def test_only_the_target_can_answer_a_request_and_requests_can_be_withdrawn(self) -> None:
        author, author_id = self.private_account("answer-author@example.com")
        fan = new_user("answer-fan@example.com")
        other = new_user("answer-other@example.com")
        fan_id = fan.get("/api/auth/me").json()["user"]["id"]
        fan.post(f"/api/users/{author_id}/follow")

        # A requester cannot approve themselves, and a stranger has nothing to answer.
        self.assertEqual(fan.post(f"/api/user/follow-requests/{fan_id}/accept").status_code, 404)
        self.assertEqual(other.post(f"/api/user/follow-requests/{fan_id}/accept").status_code, 404)
        self.assertEqual(fan.delete(f"/api/user/follow-requests/{fan_id}").status_code, 404)

        self.assertEqual(author.delete(f"/api/user/follow-requests/{fan_id}").status_code, 204)
        self.assertEqual(author.get("/api/user/follow-requests").json(), [])
        self.assertEqual(author.get("/api/user/relations/followers").json(), [])

        fan.post(f"/api/users/{author_id}/follow")
        self.assertEqual(fan.delete(f"/api/users/{author_id}/follow-request").status_code, 204)
        self.assertEqual(fan.delete(f"/api/users/{author_id}/follow-request").status_code, 404)
        self.assertEqual(author.get("/api/user/follow-requests").json(), [])

    def test_going_public_approves_waiting_requests(self) -> None:
        author, author_id = self.private_account("open-author@example.com")
        fan = new_user("open-fan@example.com")
        fan.post(f"/api/users/{author_id}/follow")

        author.patch("/api/user/profile", json={"bio": "仍是私人"})
        self.assertEqual(len(author.get("/api/user/follow-requests").json()), 1)

        author.patch("/api/user/profile", json={"is_private": False})

        self.assertEqual(author.get("/api/user/follow-requests").json(), [])
        self.assertEqual(author.get("/api/user/profile").json()["followers_count"], 1)

    def test_going_private_keeps_followers_and_public_accounts_follow_at_once(self) -> None:
        author = new_user("keep-author@example.com")
        author_id = author.get("/api/auth/me").json()["user"]["id"]
        fan = new_user("keep-fan@example.com")
        later = new_user("keep-later@example.com")
        self.assertTrue(fan.post(f"/api/users/{author_id}/follow").json()["is_following"])

        author.patch("/api/user/profile", json={"is_private": True})

        self.assertEqual(author.get("/api/user/profile").json()["followers_count"], 1)
        self.assertTrue(later.post(f"/api/users/{author_id}/follow").json()["is_requested"])

    def test_removing_a_follower_takes_their_access_away(self) -> None:
        author, author_id = self.private_account("kick-author@example.com")
        fan = new_user("kick-fan@example.com")
        fan_id = fan.get("/api/auth/me").json()["user"]["id"]
        fan.post(f"/api/users/{author_id}/follow")
        author.post(f"/api/user/follow-requests/{fan_id}/accept")
        author.patch(f"/api/friends/{fan_id}", json={"is_close_friend": True})
        author.post(
            "/api/map-points",
            json={"name": "摯友貼文", "latitude": 22.6, "longitude": 120.2, "privacy": "friends"},
        )
        self.assertIn("摯友貼文", {p["name"] for p in fan.get("/api/map-points").json()})

        self.assertEqual(author.delete(f"/api/user/followers/{fan_id}").status_code, 204)
        self.assertEqual(author.delete(f"/api/user/followers/{fan_id}").status_code, 404)

        names = {p["name"] for p in fan.get("/api/map-points").json()}
        self.assertFalse(names & {"摯友貼文", "私帳貼文 kick-author@example.com"})
        # Coming back goes through approval and does not restore the star.
        self.assertTrue(fan.post(f"/api/users/{author_id}/follow").json()["is_requested"])
        author.post(f"/api/user/follow-requests/{fan_id}/accept")
        self.assertNotIn("摯友貼文", {p["name"] for p in fan.get("/api/map-points").json()})

    def test_search_finds_an_exact_email_but_not_part_of_one(self) -> None:
        viewer = new_user("qqsearch-viewer@example.com")
        target = new_user("qqsearch-hidden@example.com", "顯示名稱")
        target.patch("/api/user/profile", json={"username": "renamed_id"})

        by_part = viewer.get("/api/users/search", params={"q": "qqsearch-hidden"})
        by_email = viewer.get(
            "/api/users/search", params={"q": "qqsearch-hidden@example.com"}
        )

        self.assertEqual(by_part.json(), [])
        self.assertEqual(by_email.json()[0]["username"], "renamed_id")

    def test_profile_page_is_reached_by_current_username_only(self) -> None:
        viewer = new_user("page-viewer@example.com")
        target = new_user("page-target@example.com", "主頁")
        target.post(
            "/api/map-points",
            json={"name": "看得到", "latitude": 22.6, "longitude": 120.2, "privacy": "public"},
        )
        target.post(
            "/api/map-points",
            json={"name": "看不到", "latitude": 22.6, "longitude": 120.2, "privacy": "private"},
        )
        target.post(
            "/api/entries",
            json={"title": "公開日記也看不到", "content": "內容", "privacy": "public"},
        )

        self.assertEqual(TestClient(main.app).get("/api/profiles/page_target").status_code, 401)
        page = viewer.get("/api/profiles/PAGE_TARGET").json()
        self.assertEqual(page["profile"]["display_name"], "主頁")
        self.assertFalse(page["profile"]["is_self"])
        self.assertFalse(page["profile"]["is_following"])
        self.assertEqual([post["title"] for post in page["posts"]], ["看得到"])
        self.assertTrue(target.get("/api/profiles/page_target").json()["profile"]["is_self"])

        viewer.post("/api/users/%d/follow" % page["profile"]["id"])
        self.assertTrue(viewer.get("/api/profiles/page_target").json()["profile"]["is_following"])

        target.patch("/api/user/profile", json={"username": "new_page"})
        self.assertEqual(viewer.get("/api/profiles/page_target").status_code, 404)
        self.assertEqual(viewer.get("/api/profiles/new_page").status_code, 200)

    def test_own_posts_are_all_marked_as_owned(self) -> None:
        client = new_user("own-posts@example.com")
        client.post(
            "/api/entries",
            json={"title": "我的日記", "content": "內容", "privacy": "public"},
        )
        client.post(
            "/api/map-points",
            json={"name": "我的足跡", "points": [{"name": "駁二", "order": 1}]},
        )
        posts = client.get("/api/user/posts").json()
        self.assertEqual({post["type"] for post in posts}, {"entry", "footprint"})
        self.assertTrue(all(post["is_owner"] for post in posts))

    def test_feeds_say_who_owns_each_post(self) -> None:
        owner = new_user("owner-link@example.com", "作者")
        owner.post(
            "/api/entries",
            json={"title": "日記", "content": "內容", "privacy": "public"},
        )
        owner.post(
            "/api/map-points",
            json={"name": "足跡", "points": [{"name": "駁二", "order": 1}], "privacy": "public"},
        )
        entry = next(
            item for item in owner.get("/api/entries").json() if item["title"] == "日記"
        )
        point = next(
            item for item in owner.get("/api/map-points").json() if item["name"] == "足跡"
        )
        self.assertEqual(entry["owner_username"], "owner_link")
        self.assertEqual(point["owner_username"], "owner_link")
        self.assertIn("owner_avatar_url", point)

    def test_account_search_requires_login_and_valid_query(self) -> None:
        client = TestClient(main.app)
        self.assertEqual(client.get("/api/users/search", params={"q": "friend"}).status_code, 401)

        viewer = new_user("find-query-viewer@example.com")
        self.assertEqual(
            viewer.get("/api/users/search", params={"q": "a"}).status_code,
            422,
        )
        self.assertEqual(
            viewer.get("/api/users/search", params={"q": "x" * 81}).status_code,
            422,
        )

    def test_follow_search_result_by_user_id(self) -> None:
        viewer = new_user("follow-id-viewer@example.com")
        target = new_user("follow-id-target@example.com", "追蹤目標")
        target_id = target.get("/api/auth/me").json()["user"]["id"]
        viewer_id = viewer.get("/api/auth/me").json()["user"]["id"]

        followed = viewer.post(f"/api/users/{target_id}/follow")
        repeated = viewer.post(f"/api/users/{target_id}/follow")

        self.assertEqual(followed.status_code, 200)
        self.assertTrue(followed.json()["is_following"])
        self.assertTrue(repeated.json()["is_following"])
        self.assertEqual(
            [person["id"] for person in viewer.get("/api/user/relations/following").json()],
            [target_id],
        )
        self.assertEqual(viewer.post(f"/api/users/{viewer_id}/follow").status_code, 400)
        self.assertEqual(viewer.post("/api/users/999999/follow").status_code, 404)
        self.assertEqual(
            TestClient(main.app).post(f"/api/users/{target_id}/follow").status_code,
            401,
        )

    def test_followers_and_following_lists_include_profile_fields(self) -> None:
        author = new_user("relation-author@example.com")
        follower = new_user("relation-follower@example.com", "粉絲")
        self.assertEqual(
            follower.post(
                "/api/friends", json={"email": "relation-author@example.com"}
            ).status_code,
            201,
        )

        author_followers = author.get("/api/user/relations/followers")
        follower_following = follower.get("/api/user/relations/following")

        self.assertEqual(author_followers.status_code, 200)
        self.assertEqual(author_followers.json()[0]["display_name"], "粉絲")
        self.assertEqual(author_followers.json()[0]["username"], "relation_follower")
        self.assertFalse(author_followers.json()[0]["is_close_friend"])
        author_id = author.get("/api/auth/me").json()["user"]["id"]
        self.assertEqual(follower_following.json()[0]["id"], author_id)

    def test_profile_close_friend_toggle_is_limited_to_followers(self) -> None:
        author = new_user("close-author@example.com")
        follower = new_user("close-follower@example.com")
        not_follower = new_user("close-other@example.com")
        follower.post("/api/friends", json={"email": "close-author@example.com"})

        added = author.patch(
            f"/api/friends/{follower.get('/api/auth/me').json()['user']['id']}",
            json={"is_close_friend": True},
        )
        self.assertEqual(added.status_code, 200)
        self.assertTrue(author.get("/api/user/relations/followers").json()[0]["is_close_friend"])
        self.assertEqual(
            author.patch(
                f"/api/friends/{not_follower.get('/api/auth/me').json()['user']['id']}",
                json={"is_close_friend": True},
            ).status_code,
            404,
        )

    def test_public_profile_only_returns_content_visible_to_viewer(self) -> None:
        author = new_user("public-profile@example.com", "公開作者")
        follower = new_user("public-viewer@example.com")
        entries = {}
        for privacy in ("public", "friends", "private"):
            result = author.post(
                "/api/entries",
                json={"title": privacy, "content": "日記內容", "privacy": privacy},
            )
            self.assertEqual(result.status_code, 201)
            entries[privacy] = result.json()["id"]
        follower.post("/api/friends", json={"email": "public-profile@example.com"})

        profile = follower.get(
            f"/api/users/{author.get('/api/auth/me').json()['user']['id']}/profile"
        )
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json()["profile"]["display_name"], "公開作者")
        self.assertEqual(profile.json()["posts"], [])
        self.assertEqual(profile.json()["profile"]["posts_count"], 0)
        for entry_id in entries.values():
            self.assertEqual(follower.get(f"/api/entries/{entry_id}").status_code, 404)

        author.patch(
            f"/api/friends/{follower.get('/api/auth/me').json()['user']['id']}",
            json={"is_close_friend": True},
        )
        close_profile = follower.get(
            f"/api/users/{author.get('/api/auth/me').json()['user']['id']}/profile"
        )
        self.assertEqual(close_profile.json()["posts"], [])
        own_profile = author.get(
            f"/api/users/{author.get('/api/auth/me').json()['user']['id']}/profile"
        )
        self.assertEqual(
            {post["title"] for post in own_profile.json()["posts"]},
            {"public", "friends", "private"},
        )

    def test_public_account_shows_public_posts_to_everyone_signed_in(self) -> None:
        author = new_user("profile-stranger-author@example.com")
        stranger = new_user("profile-stranger@example.com")
        for privacy in ("public", "friends", "private"):
            author.post(
                "/api/entries",
                json={"title": f"entry-{privacy}", "content": "內容", "privacy": privacy},
            )
            author.post(
                "/api/map-points",
                json={
                    "name": f"point-{privacy}",
                    "latitude": 22.6,
                    "longitude": 120.2,
                    "privacy": privacy,
                },
            )
        author_id = author.get("/api/auth/me").json()["user"]["id"]

        posts = stranger.get(f"/api/users/{author_id}/profile").json()["posts"]

        self.assertEqual({post["title"] for post in posts}, {"point-public"})
        entry_titles = {item["title"] for item in stranger.get("/api/entries").json()}
        point_names = {item["name"] for item in stranger.get("/api/map-points").json()}
        self.assertEqual(entry_titles, set())
        self.assertIn("point-public", point_names)
        self.assertFalse(point_names & {"point-friends", "point-private"})

    def test_private_account_limits_public_posts_to_followers(self) -> None:
        author = new_user("private-author@example.com")
        follower = new_user("private-follower@example.com")
        stranger = new_user("private-stranger@example.com")
        follower.post("/api/friends", json={"email": "private-author@example.com"})
        author_id = author.get("/api/auth/me").json()["user"]["id"]
        self.assertTrue(
            author.patch("/api/user/profile", json={"is_private": True}).json()[
                "is_private"
            ]
        )
        self.assertTrue(author.get("/api/user/profile").json()["is_private"])
        entry = author.post(
            "/api/entries",
            json={"title": "私帳公開", "content": "內容", "privacy": "public"},
        ).json()
        author.post(
            "/api/map-points",
            json={
                "name": "私帳足跡",
                "latitude": 22.6,
                "longitude": 120.2,
                "privacy": "public",
            },
        )

        def sees(client: TestClient) -> tuple[bool, bool, int, int]:
            profile = client.get(f"/api/users/{author_id}/profile").json()
            self.assertTrue(profile["profile"]["is_private"])
            return (
                "私帳公開" in {item["title"] for item in client.get("/api/entries").json()},
                "私帳足跡" in {item["name"] for item in client.get("/api/map-points").json()},
                len(profile["posts"]),
                client.get(f"/api/entries/{entry['id']}").status_code,
            )

        self.assertEqual(sees(follower), (False, True, 1, 404))
        self.assertEqual(sees(stranger), (False, False, 0, 404))
        self.assertEqual(sees(author), (True, True, 2, 200))

        author.patch("/api/user/profile", json={"is_private": False})
        self.assertEqual(
            stranger.get(f"/api/entries/{entry['id']}").status_code, 404
        )
        self.assertEqual(
            len(stranger.get(f"/api/users/{author_id}/profile").json()["posts"]), 1
        )

    def test_private_account_setting_rejects_null(self) -> None:
        client = new_user("private-null@example.com")
        client.patch("/api/user/profile", json={"is_private": True})
        self.assertEqual(
            client.patch("/api/user/profile", json={"is_private": None}).status_code,
            422,
        )
        self.assertTrue(client.get("/api/user/profile").json()["is_private"])

    def test_private_account_public_trip_link_stops_working(self) -> None:
        author = new_user("private-trip@example.com")
        point = author.post(
            "/api/map-points",
            json={
                "name": "分享點",
                "latitude": 22.6,
                "longitude": 120.2,
                "privacy": "public",
            },
        ).json()
        trip = author.post(
            "/api/trips",
            json={"title": "分享行程", "is_public": True, "point_ids": [point["id"]]},
        )
        self.assertEqual(trip.status_code, 201, trip.text)
        anonymous = TestClient(main.app)
        share = f"/api/trips/{trip.json()['id']}/share"
        self.assertEqual(anonymous.get(share).status_code, 200)

        author.patch("/api/user/profile", json={"is_private": True})

        self.assertEqual(anonymous.get(share).status_code, 404)

    def test_close_friend_content_follows_the_grant_through_the_feeds(self) -> None:
        author = new_user("grant-author@example.com")
        follower = new_user("grant-follower@example.com")
        other = new_user("grant-other@example.com")
        for client in (follower, other):
            client.post("/api/friends", json={"email": "grant-author@example.com"})
        follower_id = follower.get("/api/auth/me").json()["user"]["id"]
        for privacy in ("public", "friends", "private"):
            author.post(
                "/api/entries",
                json={"title": privacy, "content": "內容", "privacy": privacy},
            )
            author.post(
                "/api/map-points",
                json={
                    "name": privacy,
                    "latitude": 22.6,
                    "longitude": 120.2,
                    "privacy": privacy,
                },
            )
        author.patch(f"/api/friends/{follower_id}", json={"is_close_friend": True})

        levels = {"public", "friends", "private"}

        def visible(client: TestClient) -> tuple[set[str], set[str]]:
            return (
                levels & {entry["title"] for entry in client.get("/api/entries").json()},
                levels & {point["name"] for point in client.get("/api/map-points").json()},
            )

        both = {"public", "friends"}
        self.assertEqual(visible(follower), (set(), both))
        self.assertEqual(visible(other), (set(), {"public"}))

        author.patch(f"/api/friends/{follower_id}", json={"is_close_friend": False})
        self.assertEqual(visible(follower), (set(), {"public"}))

    def test_unfollowing_revokes_only_the_grant_from_that_author(self) -> None:
        author = new_user("revoke-author@example.com")
        follower = new_user("revoke-follower@example.com")
        author_id = author.get("/api/auth/me").json()["user"]["id"]
        follower_id = follower.get("/api/auth/me").json()["user"]["id"]
        follower.post("/api/friends", json={"email": "revoke-author@example.com"})
        author.post("/api/friends", json={"email": "revoke-follower@example.com"})
        author.patch(f"/api/friends/{follower_id}", json={"is_close_friend": True})
        follower.patch(f"/api/friends/{author_id}", json={"is_close_friend": True})
        author.post(
            "/api/map-points",
            json={"name": "author-friends", "latitude": 22.6, "longitude": 120.2, "privacy": "friends"},
        )
        follower.post(
            "/api/map-points",
            json={"name": "follower-friends", "latitude": 22.6, "longitude": 120.2, "privacy": "friends"},
        )

        self.assertEqual(follower.delete(f"/api/friends/{author_id}").status_code, 204)
        follower.post("/api/friends", json={"email": "revoke-author@example.com"})

        self.assertNotIn(
            "author-friends",
            {point["name"] for point in follower.get("/api/map-points").json()},
        )
        self.assertIn(
            "follower-friends",
            {point["name"] for point in author.get("/api/map-points").json()},
        )

    def test_following_again_keeps_the_close_friend_star(self) -> None:
        author = new_user("star-author@example.com")
        follower = new_user("star-follower@example.com")
        follower_id = follower.get("/api/auth/me").json()["user"]["id"]
        follower.post("/api/friends", json={"email": "star-author@example.com"})
        author.post("/api/friends", json={"email": "star-follower@example.com"})
        author.patch(f"/api/friends/{follower_id}", json={"is_close_friend": True})

        author.post("/api/friends", json={"email": "star-follower@example.com"})

        following = author.get("/api/user/relations/following").json()
        self.assertTrue(following[0]["is_close_friend"])
        self.assertTrue(following[0]["follows_you"])
        self.assertTrue(author.get("/api/friends").json()[0]["follows_you"])

    def test_following_list_marks_who_follows_back(self) -> None:
        viewer = new_user("back-viewer@example.com")
        new_user("back-target@example.com")
        viewer.post("/api/friends", json={"email": "back-target@example.com"})
        self.assertFalse(
            viewer.get("/api/user/relations/following").json()[0]["follows_you"]
        )


class UsernameTests(ApiTestCase):
    def test_new_accounts_get_a_unique_default_username(self) -> None:
        first = new_user("same.name@example.com")
        second = new_user("same.name@example.org")
        third = new_user("Dash-Name..x.@example.com")
        numeric = new_user("12345678@example.com")

        names = [
            client.get("/api/user/profile").json()["username"]
            for client in (first, second, third, numeric)
        ]

        self.assertEqual(names[:3], ["same.name", "same.name2", "dash_name.x"])
        self.assertRegex(names[3], r"^user\d+$")

    def test_username_can_be_changed_and_is_shown_to_others(self) -> None:
        owner = new_user("rename-owner@example.com")
        viewer = new_user("rename-viewer@example.com")
        owner_id = owner.get("/api/auth/me").json()["user"]["id"]

        changed = owner.patch("/api/user/profile", json={"username": " @My.New_ID1 "})

        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json()["username"], "my.new_id1")
        self.assertEqual(
            owner.get("/api/user/profile").json()["username"], "my.new_id1"
        )
        self.assertEqual(
            viewer.get(f"/api/users/{owner_id}/profile").json()["profile"]["username"],
            "my.new_id1",
        )
        found = viewer.get("/api/users/search", params={"q": "@my.new"}).json()
        self.assertEqual([person["id"] for person in found], [owner_id])
        viewer.post("/api/friends", json={"email": "rename-owner@example.com"})
        self.assertEqual(
            owner.get("/api/user/relations/followers").json()[0]["username"],
            "rename_viewer",
        )
        self.assertEqual(
            viewer.get("/api/user/relations/following").json()[0]["username"],
            "my.new_id1",
        )

    def test_invalid_usernames_are_rejected(self) -> None:
        client = new_user("rename-invalid@example.com")
        for username in ("", "有中文", "has space", "a-b", ".start", "end.", "a..b", "123456", "x" * 31):
            response = client.patch("/api/user/profile", json={"username": username})
            self.assertEqual(response.status_code, 422, username)
        self.assertEqual(
            client.patch("/api/user/profile", json={"username": None}).status_code, 422
        )
        self.assertEqual(
            client.get("/api/user/profile").json()["username"], "rename_invalid"
        )

    def test_a_taken_username_is_refused_ignoring_case(self) -> None:
        owner = new_user("taken-owner@example.com")
        other = new_user("taken-other@example.com")
        owner.patch("/api/user/profile", json={"username": "taken_name"})

        response = other.patch(
            "/api/user/profile", json={"username": "TAKEN_NAME", "bio": "不該存入"}
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(other.get("/api/user/profile").json()["bio"], "")
        self.assertEqual(
            owner.patch("/api/user/profile", json={"username": "taken_name"}).status_code,
            200,
        )


class AvatarTests(ApiTestCase):
    JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64

    def upload(self, client: TestClient, data: bytes):
        return client.post(
            "/api/user/avatar", content=data, headers={"Content-Type": "image/jpeg"}
        )

    def test_upload_is_served_and_replaced_without_leaving_files(self) -> None:
        client = new_user("avatar-owner@example.com")
        viewer = new_user("avatar-viewer@example.com")
        owner_id = client.get("/api/auth/me").json()["user"]["id"]

        first = self.upload(client, self.JPEG)
        self.assertEqual(first.status_code, 200, first.text)
        url = first.json()["avatar_url"]
        self.assertEqual(client.get("/api/user/profile").json()["avatar_url"], url)
        self.assertEqual(
            viewer.get(f"/api/users/{owner_id}/profile").json()["profile"]["avatar_url"],
            url,
        )
        served = TestClient(main.app).get(url)
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served.content, self.JPEG)
        self.assertEqual(served.headers["content-type"], "image/jpeg")
        self.assertEqual(served.headers["x-content-type-options"], "nosniff")

        second = self.upload(client, b"\x89PNG\r\n\x1a\n" + b"1" * 32).json()["avatar_url"]
        self.assertTrue(second.endswith(".png"))
        self.assertEqual(TestClient(main.app).get(url).status_code, 404)

        self.assertEqual(client.delete("/api/user/avatar").status_code, 204)
        self.assertIsNone(client.get("/api/user/profile").json()["avatar_url"])
        self.assertEqual(TestClient(main.app).get(second).status_code, 404)

    def test_only_real_images_within_the_limit_are_accepted(self) -> None:
        client = new_user("avatar-reject@example.com")
        for data in (b"", b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"<html>", b"GIF89a"):
            self.assertEqual(self.upload(client, data).status_code, 415, data)
        too_big = self.JPEG + b"0" * main.MAX_IMAGE_BYTES
        self.assertEqual(self.upload(client, too_big).status_code, 413)
        self.assertIsNone(client.get("/api/user/profile").json()["avatar_url"])

    def test_upload_requires_login_and_paths_cannot_escape(self) -> None:
        anonymous = TestClient(main.app)
        self.assertEqual(self.upload(anonymous, self.JPEG).status_code, 401)
        self.assertEqual(anonymous.delete("/api/user/avatar").status_code, 401)
        for name in ("..%2Flife_app.db", "life_app.db", "x.svg"):
            self.assertEqual(anonymous.get(f"/api/avatars/{name}").status_code, 404)

    def test_avatar_url_cannot_be_set_directly(self) -> None:
        client = new_user("avatar-direct@example.com")
        self.assertEqual(
            client.patch(
                "/api/user/profile", json={"avatar_url": "https://evil.example/x.png"}
            ).status_code,
            422,
        )
        self.assertIsNone(client.get("/api/user/profile").json()["avatar_url"])


class MapPointTests(ApiTestCase):
    def entry_with_photo(self, client: TestClient, image: bytes):
        entry = client.post(
            "/api/entries", json={"title": "有照片", "content": "夕陽"}
        ).json()
        uploaded = client.post(
            f"/api/entries/{entry['id']}/photo",
            content=image,
            headers={"Content-Type": "image/jpeg"},
        )
        self.assertEqual(uploaded.status_code, 200)
        return entry["id"], uploaded.json()["photo_url"]

    def test_entry_photo_is_saved_and_visible_to_its_owner_only(self) -> None:
        owner = new_user("entry-photo@example.com")
        image = b"\xff\xd8\xfftest-entry-photo"
        entry_id, photo_url = self.entry_with_photo(owner, image)
        self.assertEqual(owner.get(photo_url).content, image)
        self.assertEqual(owner.get(f"/api/entries/{entry_id}").json()["photo_url"], photo_url)
        listed = {entry["id"]: entry for entry in owner.get("/api/entries").json()}
        self.assertEqual(listed[entry_id]["photo_url"], photo_url)
        posts = owner.get("/api/user/posts").json()
        post = next(p for p in posts if p["type"] == "entry" and p["id"] == entry_id)
        self.assertEqual(post["photo_url"], photo_url)

        other = new_user("entry-photo-viewer@example.com")
        self.assertEqual(other.get(photo_url).status_code, 404)
        self.assertEqual(
            other.post(
                f"/api/entries/{entry_id}/photo",
                content=image,
                headers={"Content-Type": "image/jpeg"},
            ).status_code,
            404,
        )
        self.assertEqual(other.delete(f"/api/entries/{entry_id}/photo").status_code, 404)

    def test_entry_photo_rejects_non_images(self) -> None:
        owner = new_user("entry-photo-svg@example.com")
        entry = owner.post("/api/entries", json={"title": "t", "content": "c"}).json()
        self.assertEqual(
            owner.post(
                f"/api/entries/{entry['id']}/photo",
                content=b"<svg onload=alert(1)>",
                headers={"Content-Type": "image/jpeg"},
            ).status_code,
            415,
        )

    def test_entry_photo_files_go_when_replaced_removed_or_deleted(self) -> None:
        owner = new_user("entry-photo-cleanup@example.com")
        entry_id, first_url = self.entry_with_photo(owner, b"\xff\xd8\xfffirst")
        stored = lambda url: main.ENTRY_PHOTO_DIR / url.rsplit("/", 1)[1]
        self.assertTrue(stored(first_url).is_file())

        second_url = owner.post(
            f"/api/entries/{entry_id}/photo",
            content=b"\xff\xd8\xffsecond",
            headers={"Content-Type": "image/jpeg"},
        ).json()["photo_url"]
        self.assertFalse(stored(first_url).exists())

        self.assertEqual(owner.delete(f"/api/entries/{entry_id}/photo").status_code, 204)
        self.assertFalse(stored(second_url).exists())
        self.assertIsNone(owner.get(f"/api/entries/{entry_id}").json()["photo_url"])

        entry_id, third_url = self.entry_with_photo(owner, b"\xff\xd8\xffthird")
        self.assertEqual(owner.delete(f"/api/entries/{entry_id}").status_code, 204)
        self.assertFalse(stored(third_url).exists())

    def test_entry_photo_follows_the_edit_window(self) -> None:
        owner = new_user("entry-photo-locked@example.com")
        entry_id, photo_url = self.entry_with_photo(owner, b"\xff\xd8\xffold")
        with main.get_connection() as conn:
            conn.execute(
                "UPDATE entries SET created_at = '2020-01-01 00:00:00' WHERE id = ?",
                (entry_id,),
            )
            conn.commit()
        self.assertEqual(owner.delete(f"/api/entries/{entry_id}/photo").status_code, 403)
        self.assertEqual(
            owner.post(
                f"/api/entries/{entry_id}/photo",
                content=b"\xff\xd8\xffnew",
                headers={"Content-Type": "image/jpeg"},
            ).status_code,
            403,
        )
        self.assertEqual(owner.get(photo_url).status_code, 200)

    def test_installable_app_files_are_served(self) -> None:
        client = TestClient(main.app)
        manifest = client.get("/manifest.webmanifest")
        self.assertEqual(manifest.status_code, 200)
        self.assertIn("application/manifest+json", manifest.headers["content-type"])
        for icon in manifest.json()["icons"]:
            self.assertEqual(client.get(f"/{icon['src']}").status_code, 200)
        worker = client.get("/sw.js")
        self.assertIn("javascript", worker.headers["content-type"])
        self.assertEqual(worker.headers["cache-control"], "no-cache")
        self.assertIn("worker-src 'self'", worker.headers["content-security-policy"])

    def test_footprint_cover_upload_is_private_and_can_be_removed(self) -> None:
        owner = new_user("footprint-cover@example.com")
        point = owner.post(
            "/api/map-points",
            json={
                "name": "海邊散步",
                "points": [{"name": "海岸", "order": 1}],
            },
        ).json()
        image = b"\xff\xd8\xfftest-footprint-cover"

        uploaded = owner.post(
            f"/api/map-points/{point['id']}/cover",
            content=image,
            headers={"Content-Type": "image/jpeg"},
        )
        self.assertEqual(uploaded.status_code, 200)
        cover_url = uploaded.json()["cover_url"]
        self.assertTrue(cover_url.startswith("/api/footprint-covers/"))
        own_posts = owner.get("/api/user/posts").json()
        self.assertEqual(
            next(post for post in own_posts if post["id"] == point["id"])[
                "cover_url"
            ],
            cover_url,
        )
        image_path = cover_url.removeprefix("/api/footprint-covers/")
        self.assertEqual(
            owner.get(f"/api/footprint-covers/{image_path}").content,
            image,
        )

        another_user = new_user("footprint-cover-viewer@example.com")
        self.assertEqual(
            another_user.get(f"/api/footprint-covers/{image_path}").status_code,
            404,
        )
        self.assertEqual(
            owner.patch(
                f"/api/map-points/{point['id']}/privacy",
                json={"privacy": "public"},
            ).status_code,
            200,
        )
        self.assertEqual(
            another_user.get(f"/api/footprint-covers/{image_path}").status_code,
            200,
        )
        self.assertEqual(
            TestClient(main.app).get(
                f"/api/footprint-covers/{image_path}"
            ).status_code,
            401,
        )
        self.assertEqual(
            another_user.delete(f"/api/map-points/{point['id']}/cover").status_code,
            404,
        )

        self.assertEqual(
            owner.delete(f"/api/map-points/{point['id']}/cover").status_code,
            204,
        )
        self.assertIsNone(
            next(
                post
                for post in owner.get("/api/user/posts").json()
                if post["id"] == point["id"]
            )["cover_url"]
        )
        self.assertEqual(
            owner.get(f"/api/footprint-covers/{image_path}").status_code,
            404,
        )

    def test_created_map_point_is_listed_with_coordinates(self) -> None:
        client = new_user("map@example.com")
        created = client.post(
            "/api/map-points",
            json={"name": "旗津", "latitude": 22.61, "longitude": 120.27},
        )
        self.assertEqual(created.status_code, 201)

        point = next(
            point
            for point in client.get("/api/map-points").json()
            if point["name"] == "旗津"
        )

        self.assertEqual(point["latitude"], 22.61)
        self.assertEqual(point["longitude"], 120.27)

    def test_map_point_route_stores_all_ordered_stops(self) -> None:
        client = new_user("route-map@example.com")
        created = client.post(
            "/api/map-points",
            json={
                "name": "海邊散步",
                "privacy": "friends",
                "points": [
                    {"name": "車站", "lat": 22.62, "lng": 120.30, "order": 8},
                    {"name": "海岸", "lat": 22.61, "lng": 120.28, "order": 3},
                ],
            },
        )
        self.assertEqual(created.status_code, 201)

        point = created.json()
        self.assertEqual(point["privacy"], "friends")
        self.assertEqual(
            [(stop["name"], stop["order"]) for stop in point["points"]],
            [("車站", 1), ("海岸", 2)],
        )
        self.assertEqual((point["latitude"], point["longitude"]), (22.62, 120.30))

        updated = client.put(
            f"/api/map-points/{point['id']}",
            json={
                "name": "海岸散步（更新）",
                "note": "更新後的小記",
                "points": [
                    {"name": "海岸", "lat": 22.61, "lng": 120.28, "order": 1},
                ],
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["name"], "海岸散步（更新）")
        self.assertEqual(updated.json()["note"], "更新後的小記")

        privacy_update = client.patch(
            f"/api/map-points/{point['id']}/privacy",
            json={"privacy": "public"},
        )
        self.assertEqual(privacy_update.status_code, 200)
        self.assertEqual(privacy_update.json()["privacy"], "public")

    def test_editing_a_route_keeps_the_submitted_stop_order(self) -> None:
        client = new_user("map-reorder@example.com")
        stops = [
            {"name": "甲", "lat": 22.1, "lng": 120.1, "order": 1},
            {"name": "乙", "lat": 22.2, "lng": 120.2, "order": 2},
            {"name": "丙", "lat": 22.3, "lng": 120.3, "order": 3},
        ]
        point = client.post(
            "/api/map-points", json={"name": "路線", "points": stops}
        ).json()

        updated = client.put(
            f"/api/map-points/{point['id']}",
            json={
                "name": "路線",
                "points": [
                    {**stop, "order": index}
                    for index, stop in enumerate([stops[2], stops[0], stops[1]], start=1)
                ],
            },
        ).json()

        self.assertEqual(
            [(stop["name"], stop["order"]) for stop in updated["points"]],
            [("丙", 1), ("甲", 2), ("乙", 3)],
        )
        self.assertEqual((updated["latitude"], updated["longitude"]), (22.3, 120.3))

    def test_stops_can_be_saved_by_name_or_address_alone(self) -> None:
        client = new_user("map-text@example.com")
        stops = [
            {"name": "駁二藝術特區", "order": 1},
            {"name": "高雄市旗津區旗津三路", "order": 2},
        ]
        created = client.post(
            "/api/map-points", json={"name": "文字路線", "points": stops}
        )
        self.assertEqual(created.status_code, 201, created.text)
        point = created.json()
        self.assertIsNone(point["latitude"])
        self.assertEqual(
            [(stop["name"], stop["lat"], stop["lng"]) for stop in point["points"]],
            [("駁二藝術特區", None, None), ("高雄市旗津區旗津三路", None, None)],
        )
        listed = next(
            item
            for item in client.get("/api/map-points").json()
            if item["id"] == point["id"]
        )
        self.assertEqual(listed["points"][1]["name"], "高雄市旗津區旗津三路")

        mixed = client.put(
            f"/api/map-points/{point['id']}",
            json={
                "name": "文字路線",
                "points": [{"name": "目前位置", "lat": 22.6, "lng": 120.2, "order": 1}, stops[0]],
            },
        )
        self.assertEqual(mixed.status_code, 200)
        self.assertEqual(mixed.json()["latitude"], 22.6)

    def test_a_stop_cannot_have_only_half_of_its_coordinates(self) -> None:
        client = new_user("map-half@example.com")
        response = client.post(
            "/api/map-points",
            json={"name": "壞資料", "points": [{"name": "甲", "lat": 22.6, "order": 1}]},
        )
        self.assertEqual(response.status_code, 422)

    def test_old_table_keeps_its_rows_when_coordinates_become_optional(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(
            """
            CREATE TABLE users (id INTEGER PRIMARY KEY);
            CREATE TABLE map_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                privacy TEXT NOT NULL DEFAULT 'private',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                owner_id INTEGER,
                points_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE INDEX idx_kept ON map_points(owner_id);
            INSERT INTO map_points (id, name, latitude, longitude) VALUES (7, '舊足跡', 22.6, 120.2);
            """
        )

        main.upgrade_map_points_table(conn)
        main.upgrade_map_points_table(conn)

        row = conn.execute("SELECT id, name, latitude FROM map_points").fetchone()
        self.assertEqual(tuple(row), (7, "舊足跡", 22.6))
        conn.execute("INSERT INTO map_points (name) VALUES ('只有名稱')")
        self.assertEqual(
            conn.execute("SELECT id FROM map_points WHERE name = '只有名稱'").fetchone()[0],
            8,
        )
        self.assertIsNotNone(
            conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_kept'"
            ).fetchone()
        )

    def test_only_the_owner_can_delete_a_footprint(self) -> None:
        owner = new_user("map-delete@example.com")
        other = new_user("map-delete-other@example.com")
        point = owner.post(
            "/api/map-points",
            json={"name": "要刪除", "latitude": 22.6, "longitude": 120.2, "privacy": "public"},
        ).json()
        kept = owner.post(
            "/api/map-points",
            json={"name": "要保留", "latitude": 22.7, "longitude": 120.3},
        ).json()
        trip = owner.post(
            "/api/trips",
            json={"title": "行程", "point_ids": [point["id"], kept["id"]]},
        ).json()

        self.assertEqual(
            other.delete(f"/api/map-points/{point['id']}").status_code, 404
        )
        self.assertEqual(
            owner.delete(f"/api/map-points/{point['id']}").status_code, 204
        )

        self.assertEqual(
            owner.delete(f"/api/map-points/{point['id']}").status_code, 404
        )
        names = {item["name"] for item in owner.get("/api/map-points").json()}
        self.assertIn("要保留", names)
        self.assertNotIn("要刪除", names)
        self.assertEqual(
            [item["name"] for item in owner.get(f"/api/trips/{trip['id']}").json()["points"]],
            ["要保留"],
        )

    def test_map_points_only_show_public_or_close_friend_content(self) -> None:
        author = new_user("map-author@example.com")
        follower = new_user("map-follower@example.com")
        for privacy in ("private", "friends", "followers", "public"):
            created = author.post(
                "/api/map-points",
                json={
                    "name": privacy,
                    "privacy": privacy,
                    "latitude": 22.61,
                    "longitude": 120.27,
                },
            )
            self.assertEqual(created.status_code, 201)
        self.assertEqual(
            author.post(
                "/api/friends",
                json={
                    "email": "map-follower@example.com",
                    "is_close_friend": True,
                },
            ).status_code,
            201,
        )
        self.assertEqual(
            follower.post(
                "/api/friends",
                json={"email": "map-author@example.com"},
            ).status_code,
            201,
        )

        visible_names = {
            point["name"] for point in follower.get("/api/map-points").json()
        }
        self.assertLessEqual({"friends", "public"}, visible_names)
        self.assertNotIn("private", visible_names)


class TripTests(ApiTestCase):
    def test_trip_list_matches_each_trip_detail(self) -> None:
        owner = new_user("trip-list@example.com")
        first, second = (
            owner.post(
                "/api/map-points",
                json={"name": name, "points": [{"name": name, "order": 1}]},
            ).json()["id"]
            for name in ("第一站", "第二站")
        )
        older = owner.post(
            "/api/trips", json={"title": "舊", "point_ids": [second, first]}
        ).json()["id"]
        newer = owner.post("/api/trips", json={"title": "新"}).json()["id"]

        self.assertEqual(
            owner.get("/api/trips").json(),
            [owner.get(f"/api/trips/{trip_id}").json() for trip_id in (newer, older)],
        )
        self.assertEqual(
            [
                point["id"]
                for point in owner.get(f"/api/trips/{older}").json()["points"]
            ],
            [second, first],
        )
        self.assertEqual(
            new_user("trip-list-other@example.com").get("/api/trips").json(), []
        )

    def test_deleting_a_trip_keeps_its_footprints_and_only_owner_can(self) -> None:
        owner = new_user("trip-delete@example.com")
        point = owner.post(
            "/api/map-points",
            json={"name": "保留的足跡", "points": [{"name": "車站", "order": 1}]},
        ).json()
        trip = owner.post(
            "/api/trips",
            json={"title": "要刪的行程", "is_public": True, "point_ids": [point["id"]]},
        ).json()
        path = f"/api/trips/{trip['id']}"

        other = new_user("trip-delete-other@example.com")
        self.assertEqual(other.delete(path).status_code, 404)
        self.assertEqual(owner.get(path).status_code, 200)
        self.assertEqual(TestClient(main.app).delete(path).status_code, 401)

        self.assertEqual(owner.delete(path).status_code, 204)
        self.assertEqual(owner.get(path).status_code, 404)
        self.assertEqual(owner.get(f"{path}/share").status_code, 404)
        self.assertEqual(owner.delete(path).status_code, 404)
        self.assertEqual(owner.get("/api/trips").json(), [])
        self.assertIn(
            point["id"],
            [item["id"] for item in owner.get("/api/map-points").json()],
        )
        with main.get_connection() as conn:
            links = conn.execute(
                "SELECT COUNT(*) FROM trip_map_points WHERE trip_id = ?",
                (trip["id"],),
            ).fetchone()[0]
        self.assertEqual(links, 0)

    def test_trip_can_be_edited_and_replace_its_footprints(self) -> None:
        owner = new_user("trip-edit@example.com")
        first = owner.post(
            "/api/map-points",
            json={"name": "第一站", "points": [{"name": "第一站", "order": 1}]},
        ).json()
        second = owner.post(
            "/api/map-points",
            json={"name": "第二站", "points": [{"name": "第二站", "order": 1}]},
        ).json()
        trip = owner.post(
            "/api/trips",
            json={"title": "原行程", "point_ids": [first["id"]]},
        ).json()

        updated = owner.put(
            f"/api/trips/{trip['id']}",
            json={
                "title": "更新後的行程",
                "description": "先規劃，之後出發",
                "is_public": True,
                "point_ids": [second["id"], second["id"], first["id"]],
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["title"], "更新後的行程")
        self.assertEqual(updated.json()["description"], "先規劃，之後出發")
        self.assertTrue(updated.json()["is_public"])
        self.assertEqual(
            [point["id"] for point in updated.json()["points"]],
            [second["id"], first["id"]],
        )

        empty = owner.put(
            f"/api/trips/{trip['id']}",
            json={"title": "尚未決定行程", "point_ids": []},
        )
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.json()["points"], [])

        another_user = new_user("trip-edit-other@example.com")
        self.assertEqual(
            another_user.put(
                f"/api/trips/{trip['id']}",
                json={"title": "不應更新"},
            ).status_code,
            404,
        )

    def test_trip_can_create_and_add_a_planned_footprint(self) -> None:
        client = new_user("trip-planning@example.com")
        trip = client.post(
            "/api/trips",
            json={"title": "下個月東京行"},
        ).json()

        created_point = client.post(
            f"/api/trips/{trip['id']}/points",
            json={
                "name": "淺草一日遊",
                "note": "預計出發前再確認營業時間",
                "points": [
                    {"name": "淺草寺", "lat": 35.7148, "lng": 139.7967, "order": 1},
                    {"name": "晴空塔", "lat": 35.7101, "lng": 139.8107, "order": 2},
                ],
            },
        )
        self.assertEqual(created_point.status_code, 201)
        self.assertEqual(created_point.json()["name"], "淺草一日遊")
        self.assertEqual(
            [stop["name"] for stop in created_point.json()["points"]],
            ["淺草寺", "晴空塔"],
        )

        listed_trip = client.get(f"/api/trips/{trip['id']}").json()
        self.assertEqual(
            [point["name"] for point in listed_trip["points"]],
            ["淺草一日遊"],
        )
        self.assertIn(
            created_point.json()["id"],
            [point["id"] for point in client.get("/api/map-points").json()],
        )

        another_user = new_user("another-trip-planning@example.com")
        self.assertEqual(
            another_user.post(
                f"/api/trips/{trip['id']}/points",
                json={"name": "無權限地點", "points": [{"name": "無權限地點", "order": 1}]},
            ).status_code,
            404,
        )

    def test_trip_routes_create_and_list_with_selected_map_points(self) -> None:
        client = new_user("trip@example.com")
        map_point = client.post(
            "/api/map-points",
            json={
                "name": "港邊行程",
                "privacy": "public",
                "points": [
                    {"name": "港口", "lat": 22.61, "lng": 120.27, "order": 1},
                    {"name": "燈塔", "lat": 22.60, "lng": 120.26, "order": 2},
                ],
            },
        )
        self.assertEqual(map_point.status_code, 201)

        created = client.post(
            "/api/trips",
            json={
                "title": "週末旅行",
                "description": "沿著港口慢慢散步",
                "is_public": True,
                "point_ids": [map_point.json()["id"]],
            },
        )
        self.assertEqual(created.status_code, 201)
        trip = created.json()
        self.assertEqual(trip["title"], "週末旅行")
        self.assertTrue(trip["is_public"])
        self.assertEqual(
            [point["id"] for point in trip["points"]],
            [map_point.json()["id"]],
        )

        listed = client.get("/api/trips")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in listed.json()], [trip["id"]])
        detail = client.get(f"/api/trips/{trip['id']}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["id"], trip["id"])

        shared = client.get(f"/api/trips/{trip['id']}/share")
        self.assertEqual(shared.status_code, 200)
        self.assertEqual(
            [point["id"] for point in shared.json()["trip"]["points"]],
            [map_point.json()["id"]],
        )

    def test_entries_map_points_and_trips_routes_require_login(self) -> None:
        client = TestClient(main.app)
        for path in ("/api/entries", "/api/map-points", "/api/trips"):
            self.assertEqual(client.get(path).status_code, 401, path            )


class MeetupTests(ApiTestCase):
    def meetup_payload(self, **overrides):
            payload = {
                "title": "週末九份散步",
                "starts_at": (datetime.now() + timedelta(days=2))
                .replace(microsecond=0)
                .isoformat(),
                "departure_city": "新北市",
                "origin": "板橋車站",
                "destinations": ["十分老街", "九份老街"],
            }
            return {**payload, **overrides}

    def test_public_meetup_can_be_created_joined_and_left(self) -> None:
            host = new_user("meetup-host@example.com", "揪團者")
            attendee = new_user("meetup-attendee@example.com", "參加者")
            created = host.post("/api/meetups", json=self.meetup_payload())
            self.assertEqual(created.status_code, 201)
            meetup = created.json()
            self.addCleanup(host.delete, f"/api/meetups/{meetup['id']}")
            self.assertEqual(meetup["host_name"], "揪團者")
            self.assertEqual(meetup["departure_city"], "新北市")
            self.assertEqual(meetup["origin"]["name"], "板橋車站")
            self.assertEqual(
                [stop["name"] for stop in meetup["destinations"]],
                ["十分老街", "九份老街"],
            )
            # Without a Google key the stops stay unlocated but keep every field.
            for stop in [meetup["origin"], *meetup["destinations"]]:
                self.assertEqual(
                    set(stop), {"name", "lat", "lng", "city", "district"}
                )
                self.assertIsNone(stop["lat"])
                self.assertIsNone(stop["lng"])
            self.assertEqual(meetup["participant_count"], 1)
            self.assertTrue(meetup["is_owner"])
            self.assertTrue(meetup["is_participating"])

            public_list = TestClient(main.app).get("/api/meetups")
            self.assertEqual(public_list.status_code, 200)
            self.assertEqual([item["id"] for item in public_list.json()], [meetup["id"]])

            joined = attendee.post(
                f"/api/meetups/{meetup['id']}/participants"
            )
            self.assertEqual(joined.status_code, 200)
            self.assertEqual(joined.json()["participant_count"], 2)
            self.assertTrue(joined.json()["is_participating"])
            self.assertEqual(
                attendee.post(f"/api/meetups/{meetup['id']}/participants").json()[
                    "participant_count"
                ],
                2,
            )
            left = attendee.delete(
                f"/api/meetups/{meetup['id']}/participants"
            )
            self.assertEqual(left.status_code, 200)
            self.assertEqual(left.json()["participant_count"], 1)
            self.assertFalse(left.json()["is_participating"])
            self.assertEqual(
                host.delete(f"/api/meetups/{meetup['id']}/participants").status_code,
                409,
            )

    def test_meetup_limit_edit_permissions_and_cancel(self) -> None:
            host = new_user("meetup-limit-host@example.com")
            created = host.post("/api/meetups", json=self.meetup_payload())
            meetup_id = created.json()["id"]
            outsider = new_user("meetup-limit-outsider@example.com")
            self.assertEqual(
                outsider.put(
                    f"/api/meetups/{meetup_id}",
                    json=self.meetup_payload(title="無權編輯"),
                ).status_code,
                404,
            )
            self.assertEqual(
                outsider.delete(f"/api/meetups/{meetup_id}").status_code,
                404,
            )

            for index in range(2, 11):
                attendee = new_user(f"meetup-cap-{index}@example.com")
                joined = attendee.post(f"/api/meetups/{meetup_id}/participants")
                self.assertEqual(joined.status_code, 200)
                self.assertEqual(joined.json()["participant_count"], index)

            extra = new_user("meetup-cap-extra@example.com")
            self.assertEqual(
                extra.post(f"/api/meetups/{meetup_id}/participants").status_code,
                409,
            )

            updated_payload = self.meetup_payload(
                title="週末路線更新",
                destinations=["十分瀑布", "九份老街", "基隆夜市"],
            )
            updated = host.put(
                f"/api/meetups/{meetup_id}", json=updated_payload
            )
            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.json()["title"], "週末路線更新")
            self.assertEqual(
                [stop["name"] for stop in updated.json()["destinations"]],
                ["十分瀑布", "九份老街", "基隆夜市"],
            )
            self.assertEqual(updated.json()["participant_count"], 10)

            self.assertEqual(host.delete(f"/api/meetups/{meetup_id}").status_code, 204)
            self.assertEqual(host.get("/api/meetups").json(), [])

    def test_legacy_string_destinations_are_normalized(self) -> None:
            # Meetups created before located stops stored plain name strings.
            host = new_user("meetup-legacy@example.com")
            created = host.post("/api/meetups", json=self.meetup_payload())
            meetup_id = created.json()["id"]
            with main.get_connection() as conn:
                # A pre-origin row: name strings, empty origin, a departure district.
                conn.execute(
                    "UPDATE meetups SET destinations_json = ?, origin_json = '{}', "
                    "departure_district = ? WHERE id = ?",
                    (json.dumps(["十分老街", "九份老街"]), "板橋區", meetup_id),
                )
                conn.commit()
            meetup = host.get("/api/meetups").json()[0]
            stops = meetup["destinations"]
            self.assertEqual([stop["name"] for stop in stops], ["十分老街", "九份老街"])
            for stop in stops:
                self.assertEqual(set(stop), {"name", "lat", "lng", "city", "district"})
                self.assertIsNone(stop["lat"])
            # With no stored origin, it falls back to the old departure area.
            self.assertEqual(meetup["origin"]["name"], "新北市板橋區")
            self.assertEqual(host.delete(f"/api/meetups/{meetup_id}").status_code, 204)

    def test_meetup_creates_and_removes_public_footprint(self) -> None:
            host = new_user("meetup-footprint@example.com", "揪團者")
            viewer = new_user("meetup-footprint-viewer@example.com")
            created = host.post(
                "/api/meetups", json=self.meetup_payload(title="九份一日遊")
            )
            self.assertEqual(created.status_code, 201)
            meetup_id = created.json()["id"]

            def footprint_for(client):
                return next(
                    (
                        point
                        for point in client.get("/api/map-points").json()
                        if point["name"] == "九份一日遊"
                    ),
                    None,
                )

            point = footprint_for(host)
            self.assertIsNotNone(point)
            self.assertEqual(point["privacy"], "public")
            # The route is the typed start point followed by every destination.
            self.assertEqual(
                [stop["name"] for stop in point["points"]],
                ["板橋車站", "十分老街", "九份老街"],
            )
            # Being public, it is visible to other people too.
            self.assertIsNotNone(footprint_for(viewer))

            # Editing the meetup updates the same footprint, not a new one.
            host.put(
                f"/api/meetups/{meetup_id}",
                json=self.meetup_payload(title="九份一日遊", destinations=["菁桐老街"]),
            )
            point = footprint_for(host)
            self.assertEqual(
                [stop["name"] for stop in point["points"]],
                ["板橋車站", "菁桐老街"],
            )

            # Cancelling the meetup removes its footprint.
            self.assertEqual(
                host.delete(f"/api/meetups/{meetup_id}").status_code, 204
            )
            self.assertIsNone(footprint_for(host))

    def test_validation_message_reads_as_plain_language(self) -> None:
        client = new_user("meetup-message@example.com")
        response = client.post(
            "/api/meetups",
            json=self.meetup_payload(starts_at="2020-01-01T09:00:00+08:00"),
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"][0]["msg"], "出發時間需晚於現在")

    def test_meetup_says_which_footprint_is_its_route(self) -> None:
        client = new_user("meetup-footprint-id@example.com")
        created = client.post("/api/meetups", json=self.meetup_payload()).json()
        self.addCleanup(client.delete, f"/api/meetups/{created['id']}")
        points = client.get("/api/map-points").json()
        self.assertIn(created["map_point_id"], [point["id"] for point in points])

    def test_meetup_requires_future_time_and_route(self) -> None:
            host = new_user("meetup-validation@example.com")
            self.assertEqual(
                host.post(
                    "/api/meetups",
                    json=self.meetup_payload(
                        starts_at=(datetime.now() - timedelta(days=1)).isoformat()
                    ),
                ).status_code,
                422,
            )
            self.assertEqual(
                host.post(
                    "/api/meetups",
                    json=self.meetup_payload(destinations=[]),
                ).status_code,
                422,
            )
            self.assertEqual(
                TestClient(main.app).post(
                    "/api/meetups",
                    json=self.meetup_payload(),
                ).status_code,
                401,
            )


class DiaryChatTests(ApiTestCase):
    def test_ai_diary_structures_and_saves_entry(self) -> None:
        client = new_user("ai-diary@example.com")
        ai_result = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "title": "河岸的晚霞",
                                "content": "AI 改寫後漏字的內容",
                                "mood": "放鬆",
                                "tags": ["散步", "#晚霞"],
                                "reply": "這段黃昏聽起來很療癒。",
                            },
                            ensure_ascii=False,
                        )
                    }
                }
            ]
        }
        response_context = mock.MagicMock()
        response_context.__enter__.return_value.read.return_value = json.dumps(
            ai_result
        ).encode("utf-8")

        with mock.patch.dict(
            os.environ,
            {"AI_API_KEY": "test-key", "AI_MODEL": "test-model"},
        ), mock.patch.object(main, "urlopen", return_value=response_context):
            response = client.post(
                "/api/diary-chat",
                json={"message": "下班後沿河散步，看見晚霞。", "privacy": "friends"},
            )

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["reply"], "這段黃昏聽起來很療癒。")
        self.assertEqual(result["entry"]["privacy"], "friends")
        self.assertEqual(result["entry"]["tags"], "散步, 晚霞")
        saved = client.get(f"/api/entries/{result['entry']['id']}")
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["content"], "下班後沿河散步，看見晚霞。")

    def test_ai_diary_reports_unconfigured_provider_without_saving(self) -> None:
        client = new_user("ai-unconfigured@example.com")
        with mock.patch.dict(
            os.environ,
            {"AI_API_KEY": "", "AI_MODEL": ""},
        ):
            response = client.post(
                "/api/diary-chat",
                json={"message": "今天去散步", "privacy": "private"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertFalse(
            [entry for entry in client.get("/api/entries").json() if entry["is_owner"]]
        )


class SentMail:
    """Captures verification mail instead of talking to an SMTP server."""

    def __init__(self) -> None:
        self.messages = []
        self.smtp = mock.MagicMock()
        self.smtp.return_value.__enter__.return_value.send_message.side_effect = (
            self.messages.append
        )

    def token(self, index: int = -1) -> str:
        body = self.messages[index].get_content()
        match = re.search(r"(?:verify_email|reset_password)=([\w-]+)", body)
        return match.group(1)

    def reset_token(self, index: int = -1) -> str:
        body = self.messages[index].get_content()
        return re.search(r"reset_password=([\w-]+)", body).group(1)


class EmailVerificationTests(ApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.mail = SentMail()
        patches = [
            mock.patch.dict(
                os.environ,
                {"SMTP_HOST": "mail.test", "SMTP_FROM": "noreply@example.com"},
            ),
            mock.patch.object(main.smtplib, "SMTP", self.mail.smtp),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def login(self, email: str, password: str = PASSWORD):
        return TestClient(main.app).post(
            "/api/auth/login", json={"email": email, "password": password}
        )

    def test_register_requires_verification_before_login(self) -> None:
        email = "verify-flow@example.com"
        client = TestClient(main.app)

        registered = register(client, email)
        self.assertEqual(registered.status_code, 202)
        self.assertTrue(registered.json()["verification_required"])
        self.assertNotIn("set-cookie", registered.headers)
        self.assertEqual(self.mail.messages[0]["To"], email)
        self.assertEqual(self.login(email).status_code, 403)

        verified = client.post(
            "/api/auth/verify-email", json={"token": self.mail.token()}
        )
        self.assertEqual(verified.status_code, 200)
        self.assertEqual(self.login(email).status_code, 200)

    def test_unverified_login_with_wrong_password_reveals_nothing(self) -> None:
        email = "verify-wrong@example.com"
        register(TestClient(main.app), email)
        self.assertEqual(self.login(email, "wrong-password").status_code, 401)

    def test_verification_token_is_single_use_and_expires(self) -> None:
        email = "verify-once@example.com"
        client = TestClient(main.app)
        register(client, email)
        token = self.mail.token()
        self.assertEqual(
            client.post("/api/auth/verify-email", json={"token": token}).status_code, 200
        )
        self.assertEqual(
            client.post("/api/auth/verify-email", json={"token": token}).status_code, 400
        )

        other = "verify-expired@example.com"
        register(client, other)
        with mock.patch.object(main.time, "time", return_value=4102444800):
            expired = client.post(
                "/api/auth/verify-email", json={"token": self.mail.token()}
            )
        self.assertEqual(expired.status_code, 400)

    def test_owner_can_reclaim_a_squatted_address(self) -> None:
        email = "squatted@example.com"
        client = TestClient(main.app)
        register(client, email, "Attacker")
        owner_password = "owner-password"

        reclaimed = client.post(
            "/api/auth/register",
            json={"email": email, "password": owner_password, "display_name": "Owner"},
        )
        self.assertEqual(reclaimed.status_code, 202)
        client.post("/api/auth/verify-email", json={"token": self.mail.token()})

        self.assertEqual(self.login(email, PASSWORD).status_code, 401)
        logged_in = self.login(email, owner_password)
        self.assertEqual(logged_in.status_code, 200)
        self.assertEqual(logged_in.json()["user"]["display_name"], "Owner")

    def test_re_registering_cannot_lock_out_before_the_link_is_followed(self) -> None:
        email = "no-lockout@example.com"
        client = TestClient(main.app)
        register(client, email, "Owner")
        owner_token = self.mail.token()
        client.post(
            "/api/auth/register",
            json={"email": email, "password": "attacker-pass", "display_name": "Attacker"},
        )

        client.post("/api/auth/verify-email", json={"token": owner_token})

        self.assertEqual(self.login(email, PASSWORD).status_code, 200)
        self.assertEqual(self.login(email, "attacker-pass").status_code, 401)

    def test_verified_address_cannot_be_registered_again(self) -> None:
        email = "taken@example.com"
        client = TestClient(main.app)
        register(client, email)
        client.post("/api/auth/verify-email", json={"token": self.mail.token()})
        sent = len(self.mail.messages)

        self.assertEqual(register(client, email).status_code, 409)
        self.assertEqual(len(self.mail.messages), sent)

    def test_resend_is_throttled_and_does_not_reveal_accounts(self) -> None:
        email = "resend@example.com"
        client = TestClient(main.app)
        register(client, email)
        sent = len(self.mail.messages)

        for address in (email, "nobody@example.com"):
            response = client.post(
                "/api/auth/resend-verification", json={"email": address}
            )
            self.assertEqual(response.json(), {"sent": True})
        self.assertEqual(len(self.mail.messages), sent)

        later = main.time.time() + main.EMAIL_RESEND_INTERVAL_SECONDS + 1
        with mock.patch.object(main.time, "time", return_value=later):
            client.post("/api/auth/resend-verification", json={"email": email})
        self.assertEqual(len(self.mail.messages), sent + 1)

    def test_send_failure_reports_error_and_can_be_retried(self) -> None:
        email = "smtp-down@example.com"
        client = TestClient(main.app)
        self.mail.smtp.side_effect = OSError("connection refused")
        self.assertEqual(register(client, email).status_code, 503)

        self.mail.smtp.side_effect = None
        self.assertEqual(register(client, email).status_code, 202)

    def test_password_reset_is_single_use_and_revokes_sessions(self) -> None:
        email = "password-reset@example.com"
        client = TestClient(main.app)
        register(client, email)
        client.post("/api/auth/verify-email", json={"token": self.mail.token()})
        logged_in = self.login(email)
        self.assertEqual(logged_in.status_code, 200)

        response = client.post("/api/auth/forgot-password", json={"email": email})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"message": "若帳號存在，重設連結會寄到該信箱，請一併查看垃圾郵件匣。"},
        )
        self.assertEqual(self.mail.messages[-1]["To"], email)
        token = self.mail.reset_token()

        reset = client.post(
            "/api/auth/reset-password",
            json={"token": token, "password": "new-strong-password"},
        )
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(
            client.get("/api/user/profile", cookies=logged_in.cookies).status_code,
            401,
        )
        self.assertEqual(self.login(email).status_code, 401)
        self.assertEqual(self.login(email, "new-strong-password").status_code, 200)
        self.assertEqual(
            client.post(
                "/api/auth/reset-password",
                json={"token": token, "password": "another-new-password"},
            ).status_code,
            400,
        )

    def test_password_reset_does_not_reveal_unknown_accounts(self) -> None:
        client = TestClient(main.app)
        known = client.post(
            "/api/auth/forgot-password",
            json={"email": "known-password-reset@example.com"},
        )
        unknown = client.post(
            "/api/auth/forgot-password",
            json={"email": "unknown-password-reset@example.com"},
        )
        self.assertEqual(known.status_code, 200)
        self.assertEqual(known.json(), unknown.json())
        self.assertEqual(len(self.mail.messages), 0)

    def test_password_reset_rejects_short_password_and_expired_token(self) -> None:
        email = "password-reset-expired@example.com"
        client = TestClient(main.app)
        register(client, email)
        client.post("/api/auth/verify-email", json={"token": self.mail.token()})
        client.post("/api/auth/forgot-password", json={"email": email})
        token = self.mail.reset_token()

        self.assertEqual(
            client.post(
                "/api/auth/reset-password",
                json={"token": token, "password": "short"},
            ).status_code,
            422,
        )
        with mock.patch.object(
            main.time, "time", return_value=main.time.time() + main.PASSWORD_RESET_TTL_SECONDS + 1
        ):
            expired = client.post(
                "/api/auth/reset-password",
                json={"token": token, "password": "new-strong-password"},
            )
        self.assertEqual(expired.status_code, 400)

    def test_password_reset_request_is_throttled(self) -> None:
        email = "password-reset-throttle@example.com"
        client = TestClient(main.app)
        register(client, email)
        sent_before = len(self.mail.messages)

        for _ in range(2):
            response = client.post("/api/auth/forgot-password", json={"email": email})
            self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.mail.messages), sent_before + 1)


class OAuthTests(ApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        environment = {
            "GOOGLE_CLIENT_ID": "google-id",
            "GOOGLE_CLIENT_SECRET": "google-secret",
            "APPLE_CLIENT_ID": "apple-id",
            "APPLE_TEAM_ID": "team",
            "APPLE_KEY_ID": "key",
            "APPLE_PRIVATE_KEY": "private",
        }
        patch = mock.patch.dict(os.environ, environment)
        patch.start()
        self.addCleanup(patch.stop)

    def provider_login(self, client: TestClient, email: str, subject: str, **query):
        """Runs the redirect flow with the provider's token checks stubbed out."""
        with mock.patch.object(
            main, "exchange_oauth_code", return_value={"id_token": "token"}
        ), mock.patch.object(
            main,
            "verify_provider_id_token",
            return_value={"sub": subject, "email": email, "email_verified": True},
        ):
            start = client.get(
                "/api/auth/google", params=query, follow_redirects=False
            )
            state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
            return client.get(
                "/api/auth/google/callback",
                params={"code": "code", "state": state},
                follow_redirects=False,
            )

    def test_provider_login_evicts_whoever_pre_registered_the_address(self) -> None:
        email = "pre-hijack@example.com"
        attacker = new_user(email)
        self.assertEqual(attacker.get("/api/auth/me").status_code, 200)

        victim = TestClient(main.app)
        response = self.provider_login(victim, email, "victim-subject")

        self.assertEqual(response.status_code, 303)
        self.assertEqual(victim.get("/api/auth/me").json()["user"]["email"], email)
        self.assertEqual(attacker.get("/api/auth/me").status_code, 401)
        self.assertEqual(
            TestClient(main.app)
            .post("/api/auth/login", json={"email": email, "password": PASSWORD})
            .status_code,
            401,
        )

    def test_provider_login_keeps_password_on_a_verified_account(self) -> None:
        email = "verified-link@example.com"
        new_user(email)
        with main.get_connection() as conn:
            conn.execute(
                "UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE email = ?",
                (email,),
            )
            conn.commit()

        self.provider_login(TestClient(main.app), email, "verified-subject")

        self.assertEqual(
            TestClient(main.app)
            .post("/api/auth/login", json={"email": email, "password": PASSWORD})
            .status_code,
            200,
        )

    def _app_flow(self, email: str, subject: str) -> tuple[str, str]:
        verifier = base64.urlsafe_b64encode(os.urandom(48)).decode().rstrip("=")
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .decode()
            .rstrip("=")
        )
        response = self.provider_login(
            TestClient(main.app), email, subject, app_challenge=challenge
        )
        self.assertEqual(response.status_code, 303)
        location = response.headers["location"]
        self.assertTrue(location.startswith("lifelogger://auth?"))
        self.assertNotIn(main.SESSION_COOKIE, response.headers.get("set-cookie", ""))
        return parse_qs(urlsplit(location).query)["code"][0], verifier

    def test_app_flow_exchanges_code_for_a_session_once(self) -> None:
        email = "app-flow@example.com"
        code, verifier = self._app_flow(email, "app-subject")
        client = TestClient(main.app)

        exchanged = client.post(
            "/api/auth/app-exchange", json={"code": code, "verifier": verifier}
        )

        self.assertEqual(exchanged.status_code, 200)
        self.assertEqual(client.get("/api/auth/me").json()["user"]["email"], email)
        self.assertEqual(
            TestClient(main.app)
            .post("/api/auth/app-exchange", json={"code": code, "verifier": verifier})
            .status_code,
            400,
        )

    def test_intercepted_app_code_is_useless_without_the_verifier(self) -> None:
        code, verifier = self._app_flow("app-intercept@example.com", "intercept-subject")
        attacker = TestClient(main.app)

        stolen = attacker.post(
            "/api/auth/app-exchange", json={"code": code, "verifier": "x" * 64}
        )

        self.assertEqual(stolen.status_code, 400)
        self.assertEqual(attacker.get("/api/auth/me").status_code, 401)
        self.assertEqual(
            TestClient(main.app)
            .post("/api/auth/app-exchange", json={"code": code, "verifier": verifier})
            .status_code,
            400,
        )

    def test_app_code_expires(self) -> None:
        code, verifier = self._app_flow("app-expired@example.com", "expired-subject")
        later = main.time.time() + main.APP_AUTH_CODE_TTL_SECONDS + 1
        with mock.patch.object(main.time, "time", return_value=later):
            response = TestClient(main.app).post(
                "/api/auth/app-exchange", json={"code": code, "verifier": verifier}
            )
        self.assertEqual(response.status_code, 400)

    def test_malformed_app_challenge_is_rejected(self) -> None:
        response = TestClient(main.app).get(
            "/api/auth/google",
            params={"app_challenge": "short"},
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 422)

    def test_cancelled_app_login_returns_to_the_app(self) -> None:
        client = TestClient(main.app)
        start = client.get(
            "/api/auth/google",
            params={"app_challenge": "a" * 43},
            follow_redirects=False,
        )
        state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]

        response = client.get(
            "/api/auth/google/callback",
            params={"error": "access_denied", "state": state},
            follow_redirects=False,
        )

        self.assertTrue(response.headers["location"].startswith("lifelogger://auth?error="))

    def test_apple_uses_form_post_and_accepts_the_post_callback(self) -> None:
        client = TestClient(main.app)
        email = "apple-user@example.com"
        with mock.patch.object(
            main, "exchange_oauth_code", return_value={"id_token": "token"}
        ), mock.patch.object(
            main,
            "verify_provider_id_token",
            return_value={"sub": "apple-subject", "email": email, "email_verified": "true"},
        ):
            start = client.get("/api/auth/apple", follow_redirects=False)
            query = parse_qs(urlsplit(start.headers["location"]).query)
            self.assertEqual(query["response_mode"], ["form_post"])
            callback = client.post(
                "/api/auth/apple/callback",
                data={"code": "code", "state": query["state"][0]},
                follow_redirects=False,
            )

        self.assertEqual(callback.status_code, 303)
        self.assertEqual(client.get("/api/auth/me").json()["user"]["email"], email)


class MigrationTests(unittest.TestCase):
    def test_existing_accounts_are_grandfathered_as_verified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "old.db"
            conn = sqlite3.connect(path)
            conn.execute(
                """
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE,
                    password_hash TEXT,
                    display_name TEXT NOT NULL,
                    bio TEXT NOT NULL DEFAULT '',
                    avatar_url TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE oauth_states (
                    state_hash TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    nonce TEXT NOT NULL,
                    code_verifier TEXT NOT NULL,
                    expires_at INTEGER NOT NULL
                )
                """
            )
            conn.execute(
                "INSERT INTO users (email, password_hash, display_name) "
                "VALUES ('old@example.com', 'hash', '舊帳號')"
            )
            conn.commit()
            conn.close()

            with mock.patch.object(database, "DB_PATH", path):
                database.init_db()
                main.init_feature_tables()
                main.init_feature_tables()

                with main.get_connection() as check:
                    row = check.execute(
                        "SELECT email_verified_at, password_hash FROM users"
                    ).fetchone()
                    columns = {
                        column["name"]
                        for column in check.execute("PRAGMA table_info(oauth_states)")
                    }
            self.assertIsNotNone(row["email_verified_at"])
            self.assertEqual(row["password_hash"], "hash")
            self.assertIn("app_challenge", columns)


class MapsProxyTests(ApiTestCase):
    def google_replies(self, *replies: dict) -> mock.MagicMock:
        contexts = []
        for reply in replies:
            context = mock.MagicMock()
            context.__enter__.return_value.read.return_value = json.dumps(
                reply
            ).encode("utf-8")
            contexts.append(context)
        return mock.MagicMock(side_effect=contexts)

    def call_google(self, client: TestClient, urlopen: mock.MagicMock, *request):
        with mock.patch.dict(
            os.environ, {"GOOGLE_MAPS_SERVER_KEY": "server-key"}
        ), mock.patch.object(main, "urlopen", urlopen):
            method, path, *body = request
            return client.request(method, path, json=body[0] if body else None)

    def photon_lookup(self, client: TestClient, features: list, **body):
        main.photon_search.cache_clear()
        urlopen = self.google_replies(
            {
                "features": [
                    {
                        "properties": {"countrycode": "TW", **properties},
                        "geometry": {"coordinates": [lng, lat]},
                    }
                    for properties, lat, lng in features
                ]
            }
        )
        with mock.patch.dict(
            os.environ, {"GOOGLE_MAPS_SERVER_KEY": ""}
        ), mock.patch.object(main, "urlopen", urlopen):
            return client.post("/api/maps/lookup", json=body), urlopen

    def test_lookup_picks_the_same_name_place_nearest_the_other_stops(self) -> None:
        client = new_user("lookup-near@example.com")
        response, _ = self.photon_lookup(
            client,
            [
                ({"name": "中山公園", "city": "花蓮市"}, 23.98, 121.6),
                ({"name": "中山公園", "city": "高雄市", "district": "鼓山區"}, 22.62, 120.27),
            ],
            query="中山公園",
            center={"latitude": 22.6, "longitude": 120.3},
        )
        best = response.json()["places"][0]
        self.assertEqual(response.json()["source"], "photon")
        self.assertEqual(best["address"], "高雄市鼓山區")
        self.assertTrue(best["matched"])

    def test_lookup_drops_far_namesakes_when_a_nearby_place_exists(self) -> None:
        client = new_user("lookup-nearby@example.com")
        response, _ = self.photon_lookup(
            client,
            [
                ({"name": "淡水二街", "city": "广州市"}, 23.13, 113.26),
                ({"name": "淡水老街", "city": "新北市"}, 25.17, 121.44),
            ],
            query="淡水老街",
        )
        self.assertEqual(
            [place["name"] for place in response.json()["places"]], ["淡水老街"]
        )

    def test_lookup_keeps_far_places_when_nothing_is_nearby(self) -> None:
        client = new_user("lookup-overseas@example.com")
        response, _ = self.photon_lookup(
            client,
            [({"name": "東京鐵塔", "city": "東京都"}, 35.66, 139.75)],
            query="東京鐵塔",
        )
        self.assertEqual(response.json()["places"][0]["name"], "東京鐵塔")

    def test_lookup_writes_taiwan_addresses_from_county_down(self) -> None:
        client = new_user("lookup-address@example.com")
        response, _ = self.photon_lookup(
            client,
            [({"name": "中山公園", "city": "潮州鎮", "county": "屏東縣"}, 22.55, 120.54)],
            query="中山公園",
        )
        self.assertEqual(response.json()["places"][0]["address"], "屏東縣潮州鎮")

    def test_lookup_returns_the_county_and_district(self) -> None:
        client = new_user("lookup-region@example.com")
        response, _ = self.photon_lookup(
            client,
            [
                ({"name": "中山公園", "city": "潮州鎮", "county": "屏東縣"}, 22.55, 120.54),
                ({"name": "中山公園", "city": "臺北市", "district": "信義區"}, 25.04, 121.56),
                ({"name": "中山公園", "city": "新竹市", "district": "南市里"}, 24.8, 120.97),
            ],
            query="中山公園",
        )
        regions = {(p["city"], p["district"]) for p in response.json()["places"]}
        self.assertEqual(
            regions,
            {("屏東縣", "潮州鎮"), ("台北市", "信義區"), ("新竹市", None)},
        )

    def test_meetup_list_says_whose_followed(self) -> None:
        host = new_user("filter-host@example.com")
        host_id = host.get("/api/auth/me").json()["user"]["id"]
        reader = new_user("filter-meetup-reader@example.com")
        starts_at = (datetime.now() + timedelta(days=2)).astimezone().isoformat()
        created = host.post(
            "/api/meetups",
            json={
                "title": "好友揪團",
                "starts_at": starts_at,
                "departure_city": "新北市",
                "origin": "板橋車站",
                "destinations": ["九份老街"],
            },
        )
        self.assertEqual(created.status_code, 201)
        self.addCleanup(host.delete, f"/api/meetups/{created.json()['id']}")

        def listed(client):
            return next(
                meetup
                for meetup in client.get("/api/meetups").json()
                if meetup["id"] == created.json()["id"]
            )

        self.assertFalse(listed(reader)["is_following"])
        self.assertFalse(listed(TestClient(main.app))["is_following"])
        reader.post(f"/api/users/{host_id}/follow")
        self.assertTrue(listed(reader)["is_following"])

    def test_footprint_list_says_whose_followed(self) -> None:
        author = new_user("filter-author@example.com")
        author_id = author.get("/api/auth/me").json()["user"]["id"]
        stranger = new_user("filter-stranger@example.com")
        reader = new_user("filter-reader@example.com")
        stop = {"name": "公園", "order": 1}
        for client, name in ((author, "作者"), (stranger, "路人"), (reader, "自己")):
            client.post(
                "/api/map-points",
                json={"name": name, "points": [stop], "privacy": "public"},
            )
        self.assertTrue(reader.post(f"/api/users/{author_id}/follow").json()["is_following"])
        listed = {
            point["name"]: (point["is_owner"], point["is_following"])
            for point in reader.get("/api/map-points").json()
        }
        self.assertEqual(listed["作者"], (False, True))
        self.assertEqual(listed["路人"], (False, False))
        self.assertEqual(listed["自己"], (True, False))

    def test_saved_stops_are_filed_by_region(self) -> None:
        client = new_user("region-save@example.com")
        located = self.google_replies(
            {
                "features": [
                    {
                        "properties": {
                            "countrycode": "TW",
                            "city": "高雄市",
                            "district": "旗津區",
                        }
                    }
                ]
            }
        )
        with mock.patch.object(main, "region_at", REAL_REGION_AT), mock.patch.object(
            main, "urlopen", located
        ):
            point = client.post(
                "/api/map-points",
                json={
                    "name": "分類",
                    "points": [
                        {"name": "目前位置", "lat": 22.60123, "lng": 120.27456, "order": 1},
                        {"name": "中山公園（臺北市信義區）", "order": 2},
                        {"name": "士林夜市", "order": 3},
                        {
                            "name": "小店",
                            "lat": 24.1,
                            "lng": 120.6,
                            "city": "台中市",
                            "district": "西屯區",
                            "order": 4,
                        },
                    ],
                },
            ).json()
        self.assertEqual(
            [(stop["city"], stop["district"]) for stop in point["points"]],
            [
                ("高雄市", "旗津區"),
                ("台北市", "信義區"),
                (None, None),
                ("台中市", "西屯區"),
            ],
        )
        located.assert_called_once()
        self.assertIn("lat=22.601&lon=120.275", located.call_args.args[0].full_url)

    def test_a_failed_region_lookup_still_saves_the_footprint(self) -> None:
        client = new_user("region-down@example.com")
        with mock.patch.object(main, "region_at", REAL_REGION_AT), mock.patch.object(
            main, "urlopen", mock.MagicMock(side_effect=main.URLError("down"))
        ):
            response = client.post(
                "/api/map-points",
                json={
                    "name": "離線",
                    "points": [{"name": "這裡", "lat": 22.6, "lng": 120.2, "order": 1}],
                },
            )
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["points"][0]["city"])

    def test_district_names_are_not_cut_at_their_first_suffix(self) -> None:
        for text, expected in (
            ("高雄市前鎮區", ("高雄市", "前鎮區")),
            ("桃園市平鎮區", ("桃園市", "平鎮區")),
            ("臺南市新市區", ("台南市", "新市區")),
            ("彰化縣鹿港鎮", ("彰化縣", "鹿港鎮")),
            ("苗栗縣頭份市", ("苗栗縣", "頭份市")),
            ("新竹市東區", ("新竹市", "東區")),
            ("台北市信義路五段", ("台北市", None)),
            ("士林夜市", (None, None)),
        ):
            self.assertEqual(main.region_from_text(text), expected, text)

    def test_only_the_first_stop_looks_up_its_region(self) -> None:
        client = new_user("region-first@example.com")
        with mock.patch.object(main, "region_at", return_value=("高雄市", "旗津區")) as found:
            point = client.post(
                "/api/map-points",
                json={
                    "name": "兩站",
                    "points": [
                        {"name": "甲", "lat": 22.6, "lng": 120.2, "order": 1},
                        {"name": "乙", "lat": 25.0, "lng": 121.5, "order": 2},
                    ],
                },
            ).json()
        found.assert_called_once()
        self.assertEqual(point["points"][0]["city"], "高雄市")
        self.assertIsNone(point["points"][1]["city"])

    def test_lookup_uses_the_area_in_the_keyword(self) -> None:
        client = new_user("lookup-area@example.com")
        response, _ = self.photon_lookup(
            client,
            [
                ({"name": "中山公園", "city": "花蓮市"}, 23.98, 121.6),
                ({"name": "中山公園", "city": "高雄市"}, 22.62, 120.27),
            ],
            query="高雄中山公園",
            center={"latitude": 23.98, "longitude": 121.6},
        )
        self.assertEqual(response.json()["places"][0]["address"], "高雄市")

    def test_lookup_does_not_trust_a_different_place(self) -> None:
        client = new_user("lookup-miss@example.com")
        response, _ = self.photon_lookup(
            client,
            [
                (
                    {
                        "name": "高雄市旗津區旗津國民小學",
                        "city": "高雄市",
                        "district": "旗津區",
                        "street": "中洲三路",
                        "housenumber": "623",
                    },
                    22.59,
                    120.28,
                )
            ],
            query="高雄市旗津區旗津三路",
        )
        place = response.json()["places"][0]
        self.assertEqual(place["address"], "高雄市旗津區中洲三路623號")
        self.assertFalse(place["matched"])

    def test_lookup_tolerates_a_typo_and_merges_duplicates(self) -> None:
        client = new_user("lookup-typo@example.com")
        response, _ = self.photon_lookup(
            client,
            [
                ({"name": "旗津海岸公園", "city": "高雄市"}, 22.61, 120.27),
                ({"name": "旗津海岸公園", "city": "高雄市"}, 22.61, 120.27),
            ],
            query="旗津海岸公圓",
        )
        places = response.json()["places"]
        self.assertEqual(len(places), 1)
        self.assertTrue(places[0]["matched"])

    def test_lookup_requires_login_and_reports_an_outage(self) -> None:
        anonymous = TestClient(main.app)
        self.assertEqual(
            anonymous.post("/api/maps/lookup", json={"query": "公園"}).status_code, 401
        )
        client = new_user("lookup-down@example.com")
        main.photon_search.cache_clear()
        with mock.patch.dict(
            os.environ, {"GOOGLE_MAPS_SERVER_KEY": ""}
        ), mock.patch.object(
            main, "urlopen", mock.MagicMock(side_effect=main.URLError("down"))
        ):
            response = client.post("/api/maps/lookup", json={"query": "公園"})
        self.assertEqual(response.status_code, 502)

    def test_lookup_prefers_google_when_a_key_is_set(self) -> None:
        client = new_user("lookup-google@example.com")
        urlopen = self.google_replies(
            {
                "places": [
                    {
                        "id": "abc",
                        "displayName": {"text": "旗津海岸公園"},
                        "formattedAddress": "805台灣高雄市旗津區旗津三路990號",
                        "location": {"latitude": 22.61, "longitude": 120.27},
                    }
                ]
            }
        )
        response = self.call_google(
            client, urlopen, "POST", "/api/maps/lookup", {"query": "高雄旗津海岸公園"}
        )
        self.assertEqual(response.json()["source"], "google")
        self.assertTrue(response.json()["places"][0]["matched"])

    def test_requires_login_and_a_configured_key(self) -> None:
        anonymous = TestClient(main.app)
        self.assertEqual(
            anonymous.post("/api/maps/search", json={"query": "咖啡"}).status_code, 401
        )
        client = new_user("maps-key@example.com")
        with mock.patch.dict(os.environ, {"GOOGLE_MAPS_SERVER_KEY": ""}):
            self.assertEqual(
                client.post("/api/maps/search", json={"query": "咖啡"}).status_code, 503
            )

    def test_search_sends_key_only_to_google_and_normalizes_places(self) -> None:
        client = new_user("maps-search@example.com")
        urlopen = self.google_replies(
            {
                "places": [
                    {
                        "id": "abc",
                        "displayName": {"text": "咖啡店"},
                        "formattedAddress": "台北市",
                        "location": {"latitude": 25.0, "longitude": 121.5},
                        "rating": 4.5,
                        "userRatingCount": 10,
                    }
                ]
            }
        )
        response = self.call_google(
            client,
            urlopen,
            "POST",
            "/api/maps/search",
            {"query": "咖啡", "center": {"latitude": 25, "longitude": 121}},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["name"], "咖啡店")
        self.assertNotIn("server-key", response.text)
        sent = urlopen.call_args.args[0]
        self.assertEqual(sent.get_header("X-goog-api-key"), "server-key")
        self.assertIn("places.displayName", sent.get_header("X-goog-fieldmask"))
        self.assertIn("locationBias", json.loads(sent.data))

    def test_place_details_fetch_photos_and_reject_unsafe_ids(self) -> None:
        client = new_user("maps-place@example.com")
        urlopen = self.google_replies(
            {
                "id": "abc",
                "displayName": {"text": "店"},
                "currentOpeningHours": {"openNow": True, "weekdayDescriptions": ["一"]},
                "photos": [
                    {
                        "name": "places/abc/photos/p1",
                        "authorAttributions": [{"displayName": "攝影者"}],
                    }
                ],
                "reviews": [
                    {
                        "authorAttribution": {"displayName": "小林"},
                        "rating": 5,
                        "text": {"text": "好吃"},
                        "relativePublishTimeDescription": "1 週前",
                    }
                ],
            },
            {"name": "places/abc/photos/p1", "photoUri": "https://photo.test/1"},
        )
        response = self.call_google(client, urlopen, "GET", "/api/maps/places/abc")
        self.assertEqual(response.status_code, 200)
        place = response.json()
        self.assertTrue(place["open_now"])
        self.assertEqual(
            place["photos"],
            [{"url": "https://photo.test/1", "attributions": ["攝影者"]}],
        )
        self.assertEqual(place["reviews"][0]["author"], "小林")
        self.assertIn("skipHttpRedirect=true", urlopen.call_args.args[0].full_url)

        rejected = self.call_google(
            client, self.google_replies(), "GET", "/api/maps/places/abc%2E%2E%3Fx"
        )
        self.assertEqual(rejected.status_code, 422)

    def test_routes_map_travel_modes_and_only_drive_gets_traffic(self) -> None:
        client = new_user("maps-route@example.com")
        reply = {
            "routes": [
                {
                    "description": "國道1號",
                    "distanceMeters": 1000,
                    "duration": "1680s",
                    "polyline": {"encodedPolyline": "abc"},
                    "legs": [
                        {
                            "steps": [
                                {
                                    "distanceMeters": 100,
                                    "navigationInstruction": {"instructions": "直行"},
                                    "transitDetails": {
                                        "headsign": "淡水",
                                        "transitLine": {"nameShort": "紅線"},
                                    },
                                }
                            ]
                        }
                    ],
                }
            ]
        }
        urlopen = self.google_replies(reply, reply)
        response = self.call_google(
            client,
            urlopen,
            "POST",
            "/api/maps/routes",
            {
                "origin": {"location": {"latitude": 25, "longitude": 121}},
                "destination": {"address": "板橋"},
                "avoid_tolls": True,
            },
        )
        self.assertEqual(response.status_code, 200)
        route = response.json()[0]
        self.assertEqual(route["duration_seconds"], 1680)
        self.assertEqual(route["steps"][0]["transit_line"], "紅線")
        body = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual(body["travelMode"], "DRIVE")
        self.assertEqual(body["routingPreference"], "TRAFFIC_AWARE")
        self.assertTrue(body["routeModifiers"]["avoidTolls"])
        self.assertTrue(body["computeAlternativeRoutes"])

        self.call_google(
            client,
            urlopen,
            "POST",
            "/api/maps/routes",
            {
                "origin": {"address": "台北"},
                "destination": {"address": "板橋"},
                "travel_mode": "WALKING",
                "intermediates": [{"address": "萬華"}],
            },
        )
        body = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual(body["travelMode"], "WALK")
        self.assertNotIn("routingPreference", body)
        self.assertNotIn("computeAlternativeRoutes", body)
        self.assertEqual(body["intermediates"], [{"address": "萬華"}])

    def test_route_stop_without_location_is_rejected_and_google_failure_is_502(
        self,
    ) -> None:
        client = new_user("maps-errors@example.com")
        urlopen = mock.MagicMock(side_effect=main.URLError("down"))
        bad = self.call_google(
            client,
            urlopen,
            "POST",
            "/api/maps/routes",
            {"origin": {}, "destination": {"address": "板橋"}},
        )
        self.assertEqual(bad.status_code, 422)
        down = self.call_google(
            client, urlopen, "POST", "/api/maps/search", {"query": "咖啡"}
        )
        self.assertEqual(down.status_code, 502)
        self.assertNotIn("server-key", down.text)


class SessionPurgeTests(ApiTestCase):
    def test_expired_sessions_are_refused_and_purged_without_writing_on_every_request(
        self,
    ) -> None:
        client = new_user("purge@example.com")
        self.assertEqual(client.get("/api/auth/me").status_code, 200)
        with main.get_connection() as conn:
            conn.execute("UPDATE auth_sessions SET expires_at = 0")
            conn.commit()

        # Between purges the row stays, and it still must not authenticate anyone.
        with mock.patch.object(main, "_next_session_purge", float("inf")):
            self.assertEqual(client.get("/api/auth/me").status_code, 401)
            with main.get_connection() as conn:
                remaining = conn.execute(
                    "SELECT COUNT(*) FROM auth_sessions WHERE expires_at = 0"
                ).fetchone()[0]
            self.assertGreater(remaining, 0)

        with mock.patch.object(main, "_next_session_purge", 0.0):
            self.assertEqual(client.get("/api/auth/me").status_code, 401)
            with main.get_connection() as conn:
                remaining = conn.execute(
                    "SELECT COUNT(*) FROM auth_sessions WHERE expires_at = 0"
                ).fetchone()[0]
        self.assertEqual(remaining, 0)


class WebAssetTests(ApiTestCase):
    def test_page_and_assets_are_served_with_security_headers(self) -> None:
        client = TestClient(main.app)
        page = client.get("/")
        self.assertIn("script-src 'self'", page.headers["content-security-policy"])
        self.assertNotIn(
            "unsafe-inline",
            page.headers["content-security-policy"].split(";")[1],
        )
        self.assertEqual(page.headers["referrer-policy"], "strict-origin")
        self.assertEqual(
            client.get("/api/health").headers["referrer-policy"], "no-referrer"
        )
        references = re.findall(r'(?:src|href)="((?:css|js)/[^"]+)"', page.text)
        self.assertGreater(len(references), 10)
        for reference in references:
            self.assertEqual(client.get(f"/{reference}").status_code, 200, reference)
        self.assertNotIn("cdn.tailwindcss.com", page.text)
        self.assertNotIn("unpkg.com", page.text)
        self.assertNotIn("leaflet", page.text)

    def test_maps_config_reports_key_from_environment(self) -> None:
        client = TestClient(main.app)
        with mock.patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": ""}):
            self.assertEqual(client.get("/api/maps/config").json()["api_key"], "")
        with mock.patch.dict(
            os.environ,
            {"GOOGLE_MAPS_API_KEY": "browser-key", "GOOGLE_MAPS_MAP_ID": "map-1"},
        ):
            self.assertEqual(
                client.get("/api/maps/config").json(),
                {"api_key": "browser-key", "map_id": "map-1"},
            )


class MapPointReactionTests(ApiTestCase):
    def footprint(self, client: TestClient, privacy: str = "public") -> int:
        response = client.post(
            "/api/map-points",
            json={"name": "海邊", "latitude": 22.6, "longitude": 120.2, "privacy": privacy},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def listed(self, client: TestClient, point_id: int) -> dict:
        return next(
            point
            for point in client.get("/api/map-points").json()
            if point["id"] == point_id
        )

    def test_likes_count_everyone_but_saves_stay_personal(self) -> None:
        author = new_user("react-author@example.com")
        fan = new_user("react-fan@example.com")
        point_id = self.footprint(author)

        self.assertEqual(
            fan.put(f"/api/map-points/{point_id}/like").json(),
            {"like_count": 1, "is_liked": True, "is_saved": False},
        )
        # Tapping twice from two tabs must not count twice.
        self.assertEqual(
            fan.put(f"/api/map-points/{point_id}/like").json()["like_count"], 1
        )
        self.assertTrue(fan.put(f"/api/map-points/{point_id}/save").json()["is_saved"])

        seen_by_author = self.listed(author, point_id)
        self.assertEqual(seen_by_author["like_count"], 1)
        self.assertFalse(seen_by_author["is_liked"])
        self.assertFalse(seen_by_author["is_saved"])
        seen_by_fan = self.listed(fan, point_id)
        self.assertTrue(seen_by_fan["is_liked"])
        self.assertTrue(seen_by_fan["is_saved"])

        self.assertEqual(
            fan.delete(f"/api/map-points/{point_id}/like").json(),
            {"like_count": 0, "is_liked": False, "is_saved": True},
        )
        self.assertFalse(
            fan.delete(f"/api/map-points/{point_id}/save").json()["is_saved"]
        )

    def test_hidden_footprints_cannot_be_liked_or_saved(self) -> None:
        author = new_user("react-hidden@example.com")
        stranger = new_user("react-stranger@example.com")
        point_id = self.footprint(author, "private")
        for kind in ("like", "save"):
            self.assertEqual(
                stranger.put(f"/api/map-points/{point_id}/{kind}").status_code, 404
            )
        self.assertEqual(self.listed(author, point_id)["like_count"], 0)

    def test_saved_footprint_disappears_when_it_turns_private(self) -> None:
        author = new_user("react-turns@example.com")
        fan = new_user("react-turns-fan@example.com")
        point_id = self.footprint(author)
        fan.put(f"/api/map-points/{point_id}/save")
        author.patch(
            f"/api/map-points/{point_id}/privacy", json={"privacy": "private"}
        )
        self.assertNotIn(
            point_id, {point["id"] for point in fan.get("/api/map-points").json()}
        )

    def test_deleting_a_footprint_clears_its_reactions(self) -> None:
        author = new_user("react-delete@example.com")
        point_id = self.footprint(author)
        author.put(f"/api/map-points/{point_id}/like")
        author.put(f"/api/map-points/{point_id}/save")
        self.assertEqual(author.delete(f"/api/map-points/{point_id}").status_code, 204)
        with main.get_connection() as conn:
            for table in main.MAP_POINT_REACTION_TABLES.values():
                count = conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE map_point_id = ?", (point_id,)
                ).fetchone()[0]
                self.assertEqual(count, 0)

    def test_signed_out_visitors_cannot_react(self) -> None:
        author = new_user("react-anon@example.com")
        point_id = self.footprint(author)
        response = TestClient(main.app).put(f"/api/map-points/{point_id}/like")
        self.assertEqual(response.status_code, 401)


class FollowersPrivacyTests(ApiTestCase):
    def names(self, client: TestClient) -> set[str]:
        return {point["name"] for point in client.get("/api/map-points").json()}

    def post(self, client: TestClient, name: str) -> int:
        response = client.post(
            "/api/map-points",
            json={"name": name, "latitude": 22.6, "longitude": 120.2, "privacy": "followers"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["privacy"], "followers")
        return response.json()["id"]

    def test_only_current_followers_see_it(self) -> None:
        author = new_user("followers-author@example.com")
        fan = new_user("followers-fan@example.com")
        stranger = new_user("followers-stranger@example.com")
        self.post(author, "只給追蹤者")
        author_id = author.get("/api/auth/me").json()["user"]["id"]

        self.assertIn("只給追蹤者", self.names(author))
        self.assertNotIn("只給追蹤者", self.names(fan))
        # No close-friend grant: following is enough at this level.
        fan.post(f"/api/users/{author_id}/follow")
        self.assertIn("只給追蹤者", self.names(fan))
        self.assertNotIn("只給追蹤者", self.names(stranger))
        fan.delete(f"/api/friends/{author_id}")
        self.assertNotIn("只給追蹤者", self.names(fan))

    def test_private_account_needs_an_approved_follow(self) -> None:
        author = new_user("followers-private@example.com")
        author.patch("/api/user/profile", json={"is_private": True})
        fan = new_user("followers-pending@example.com")
        self.post(author, "私帳追蹤者")
        author_id = author.get("/api/auth/me").json()["user"]["id"]
        fan_id = fan.get("/api/auth/me").json()["user"]["id"]

        fan.post(f"/api/users/{author_id}/follow")
        self.assertNotIn("私帳追蹤者", self.names(fan))
        author.post(f"/api/user/follow-requests/{fan_id}/accept")
        self.assertIn("私帳追蹤者", self.names(fan))

    def test_public_rule_for_private_accounts_is_unchanged(self) -> None:
        author = new_user("followers-public@example.com")
        author.patch("/api/user/profile", json={"is_private": True})
        stranger = new_user("followers-public-s@example.com")
        author.post(
            "/api/map-points",
            json={"name": "私帳公開", "latitude": 22.6, "longitude": 120.2, "privacy": "public"},
        )
        self.assertNotIn("私帳公開", self.names(stranger))

    def test_old_table_is_upgraded_without_losing_rows(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            conn = sqlite3.connect(Path(folder) / "old.db")
            conn.row_factory = sqlite3.Row
            conn.execute(
                """
                CREATE TABLE map_points (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    owner_id INTEGER,
                    name TEXT NOT NULL,
                    latitude REAL,
                    longitude REAL,
                    note TEXT NOT NULL DEFAULT '',
                    privacy TEXT NOT NULL DEFAULT 'private'
                        CHECK (privacy IN ('private', 'friends', 'public')),
                    points_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    cover_url TEXT
                )
                """
            )
            conn.execute(
                "INSERT INTO map_points (id, owner_id, name, privacy, cover_url) "
                "VALUES (41, 1, '舊足跡', 'friends', '/c.png')"
            )
            conn.commit()
            main.upgrade_map_points_table(conn)
            main.upgrade_map_points_table(conn)  # Safe to run on every start.
            row = conn.execute("SELECT * FROM map_points").fetchone()
            self.assertEqual(
                (row["id"], row["name"], row["privacy"], row["cover_url"]),
                (41, "舊足跡", "friends", "/c.png"),
            )
            conn.execute("UPDATE map_points SET privacy = 'followers'")
            next_id = conn.execute(
                "INSERT INTO map_points (name) VALUES ('新')"
            ).lastrowid
            self.assertEqual(next_id, 42)
            conn.close()


if __name__ == "__main__":
    unittest.main()
