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
        for privacy in ("private", "friends", "public"):
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

    def test_private_entries_stay_hidden_from_followers(self) -> None:
        author = new_user("author@example.com")
        follower = new_user("follower@example.com")
        for privacy in ("private", "friends", "public"):
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

        self.assertIn("public", titles)
        self.assertFalse(titles & {"private", "friends"})

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
            {"zzlife-friend", "zzlife-private"},
        )
        self.assertTrue(results[0]["username"].startswith("zzlife"))
        self.assertTrue(any(person["is_private"] for person in results))
        self.assertTrue(all("email" not in person for person in results))
        self.assertNotIn(
            viewer.get("/api/auth/me").json()["user"]["id"],
            {person["id"] for person in results},
        )

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
        self.assertEqual(author_followers.json()[0]["username"], "relation-follower")
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
        self.assertEqual([post["title"] for post in profile.json()["posts"]], ["public"])

        author.patch(
            f"/api/friends/{follower.get('/api/auth/me').json()['user']['id']}",
            json={"is_close_friend": True},
        )
        close_profile = follower.get(
            f"/api/users/{author.get('/api/auth/me').json()['user']['id']}/profile"
        )
        self.assertEqual(
            {post["title"] for post in close_profile.json()["posts"]},
            {"public", "friends"},
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

        self.assertEqual(
            {post["title"] for post in posts}, {"entry-public", "point-public"}
        )
        entry_titles = {item["title"] for item in stranger.get("/api/entries").json()}
        point_names = {item["name"] for item in stranger.get("/api/map-points").json()}
        self.assertIn("entry-public", entry_titles)
        self.assertFalse(entry_titles & {"entry-friends", "entry-private"})
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

        self.assertEqual(sees(follower), (True, True, 2, 200))
        self.assertEqual(sees(stranger), (False, False, 0, 404))
        self.assertEqual(sees(author), (True, True, 2, 200))

        author.patch("/api/user/profile", json={"is_private": False})
        self.assertEqual(
            stranger.get(f"/api/entries/{entry['id']}").status_code, 200
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
        self.assertEqual(visible(follower), (both, both))
        self.assertEqual(visible(other), ({"public"}, {"public"}))

        author.patch(f"/api/friends/{follower_id}", json={"is_close_friend": False})
        self.assertEqual(visible(follower), ({"public"}, {"public"}))

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
            "/api/entries",
            json={"title": "author-friends", "content": "內容", "privacy": "friends"},
        )
        follower.post(
            "/api/entries",
            json={"title": "follower-friends", "content": "內容", "privacy": "friends"},
        )

        self.assertEqual(follower.delete(f"/api/friends/{author_id}").status_code, 204)
        follower.post("/api/friends", json={"email": "revoke-author@example.com"})

        self.assertNotIn(
            "author-friends",
            {entry["title"] for entry in follower.get("/api/entries").json()},
        )
        self.assertIn(
            "follower-friends",
            {entry["title"] for entry in author.get("/api/entries").json()},
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


class MapPointTests(ApiTestCase):
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

        main.allow_map_points_without_coordinates(conn)
        main.allow_map_points_without_coordinates(conn)

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
        for privacy in ("private", "friends", "public"):
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
            self.assertEqual(client.get(path).status_code, 401, path)


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
                                "content": "下班後沿河散步，看見晚霞。",
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
            {"message": "若帳號存在且郵件服務已設定，重設連結會寄到該信箱。"},
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


if __name__ == "__main__":
    unittest.main()
