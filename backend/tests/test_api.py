from __future__ import annotations

import base64
import hashlib
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


def new_user(email: str) -> TestClient:
    client = TestClient(main.app)
    assert register(client, email).status_code == 201
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

        self.assertEqual(titles, {"public"})


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
        return re.search(r"verify_email=([\w-]+)", body).group(1)


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


class WebAssetTests(ApiTestCase):
    def test_page_and_assets_are_served_with_security_headers(self) -> None:
        client = TestClient(main.app)
        page = client.get("/")
        self.assertIn("script-src 'self'", page.headers["content-security-policy"])
        self.assertEqual(page.headers["referrer-policy"], "no-referrer")
        references = re.findall(r'(?:src|href)="((?:css|js|vendor)/[^"]+)"', page.text)
        self.assertGreater(len(references), 10)
        for reference in references:
            self.assertEqual(client.get(f"/{reference}").status_code, 200, reference)
        self.assertNotIn("cdn.tailwindcss.com", page.text)
        self.assertNotIn("unpkg.com", page.text)


if __name__ == "__main__":
    unittest.main()
