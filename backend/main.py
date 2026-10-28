from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as URLRequest
from urllib.request import urlopen

import jwt
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

if __package__:
    from .database import get_connection, init_db
    from .models import (
        EntryCreate,
        EntryOut,
        LocationLogCreate,
        LocationLogOut,
        SettingUpdate,
        SettingsOut,
    )
else:
    from database import get_connection, init_db
    from models import (
        EntryCreate,
        EntryOut,
        LocationLogCreate,
        LocationLogOut,
        SettingUpdate,
        SettingsOut,
    )

app = FastAPI(title="Life Logger API", version="1.0.0")
STATIC_DIR = Path(__file__).resolve().parent / "static"
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5500,http://localhost:5500,"
        "http://127.0.0.1:8000,http://localhost:8000",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

SESSION_COOKIE = "life_logger_session"
OAUTH_STATE_COOKIE = "life_logger_oauth_state"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
OAUTH_STATE_TTL_SECONDS = 60 * 10
PASSWORD_ITERATIONS = 310_000


class AccountCredentials(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=256)


class AccountRegistration(AccountCredentials):
    display_name: str = Field(..., min_length=1, max_length=80)


class MapPointCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    note: str = Field(default="", max_length=1000)
    privacy: Literal["private", "friends", "public"] = "private"


class MapPointPrivacyUpdate(BaseModel):
    privacy: Literal["private", "friends", "public"]


class TripCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    is_public: bool = False
    point_ids: list[int] = Field(default_factory=list, max_length=100)


def init_feature_tables() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE,
                password_hash TEXT,
                display_name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS oauth_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
                subject TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(provider, subject)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS oauth_states (
                state_hash TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                nonce TEXT NOT NULL,
                code_verifier TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS map_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                privacy TEXT NOT NULL DEFAULT 'private'
                    CHECK (privacy IN ('private', 'friends', 'public')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                is_public INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trip_map_points (
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                map_point_id INTEGER NOT NULL REFERENCES map_points(id) ON DELETE CASCADE,
                position INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (trip_id, map_point_id)
            )
            """
        )
        conn.commit()


@app.on_event("startup")
def startup_event() -> None:
    init_db()
    init_feature_tables()


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
        raise HTTPException(status_code=422, detail="請輸入有效的電子郵件地址")
    return normalized


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(derived).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    try:
        algorithm, iterations, encoded_salt, encoded_hash = stored_hash.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(encoded_salt.encode("ascii"))
        expected = base64.urlsafe_b64decode(encoded_hash.encode("ascii"))
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(iterations)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def public_user(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
    }


def issue_session(response: Response, user_id: int) -> None:
    session_token = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + SESSION_TTL_SECONDS
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (hashlib.sha256(session_token.encode()).hexdigest(), user_id, expires_at),
        )
        conn.commit()
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=PUBLIC_BASE_URL.startswith("https://"),
        samesite="lax",
        path="/",
    )


def get_current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="請先登入")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = int(time.time())
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT users.id, users.email, users.display_name
            FROM auth_sessions
            JOIN users ON users.id = auth_sessions.user_id
            WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?
            """,
            (token_hash, now),
        ).fetchone()
        conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (now,))
        conn.commit()
    if row is None:
        raise HTTPException(status_code=401, detail="登入已失效，請重新登入")
    return public_user(row)


def oauth_provider_configured(provider: str) -> bool:
    if provider == "google":
        return bool(
            os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET")
        )
    return bool(
        os.getenv("APPLE_CLIENT_ID")
        and os.getenv("APPLE_TEAM_ID")
        and os.getenv("APPLE_KEY_ID")
        and os.getenv("APPLE_PRIVATE_KEY")
    )


def oauth_redirect_uri(provider: str) -> str:
    env_name = f"{provider.upper()}_REDIRECT_URI"
    return os.getenv(env_name, f"{PUBLIC_BASE_URL}/api/auth/{provider}/callback")


def apple_client_secret() -> str:
    if not oauth_provider_configured("apple"):
        raise HTTPException(status_code=503, detail="Apple 登入尚未完成伺服器設定")
    private_key = os.environ["APPLE_PRIVATE_KEY"].replace("\\n", "\n")
    now = int(time.time())
    return jwt.encode(
        {
            "iss": os.environ["APPLE_TEAM_ID"],
            "iat": now,
            "exp": now + 60 * 60,
            "aud": "https://appleid.apple.com",
            "sub": os.environ["APPLE_CLIENT_ID"],
        },
        private_key,
        algorithm="ES256",
        headers={"kid": os.environ["APPLE_KEY_ID"]},
    )


def exchange_oauth_code(
    provider: str, code: str, code_verifier: str
) -> dict[str, Any]:
    client_id = os.environ[f"{provider.upper()}_CLIENT_ID"]
    token_url = (
        "https://oauth2.googleapis.com/token"
        if provider == "google"
        else "https://appleid.apple.com/auth/token"
    )
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": oauth_redirect_uri(provider),
        "client_id": client_id,
    }
    if provider == "google":
        payload["client_secret"] = os.environ["GOOGLE_CLIENT_SECRET"]
        payload["code_verifier"] = code_verifier
    else:
        payload["client_secret"] = apple_client_secret()
    request = URLRequest(
        token_url,
        data=urlencode(payload).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=15) as result:
            data = json.loads(result.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=502, detail=f"{provider.title()} 登入服務暫時無法使用"
        ) from error
    if not isinstance(data, dict) or not data.get("id_token"):
        raise HTTPException(status_code=502, detail="登入服務未回傳有效的身分憑證")
    return data


def verify_provider_id_token(
    provider: str, id_token: str, expected_nonce: str
) -> dict[str, Any]:
    client_id = os.environ[f"{provider.upper()}_CLIENT_ID"]
    jwks_url = (
        "https://www.googleapis.com/oauth2/v3/certs"
        if provider == "google"
        else "https://appleid.apple.com/auth/keys"
    )
    issuers = (
        ["https://accounts.google.com", "accounts.google.com"]
        if provider == "google"
        else ["https://appleid.apple.com"]
    )
    try:
        signing_key = jwt.PyJWKClient(jwks_url).get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=issuers,
            leeway=60,
        )
    except jwt.PyJWTError as error:
        raise HTTPException(status_code=401, detail="無法驗證第三方登入憑證") from error
    if not hmac.compare_digest(str(claims.get("nonce", "")), expected_nonce):
        raise HTTPException(status_code=401, detail="登入驗證狀態不符，請重試")
    verified = claims.get("email_verified")
    if verified not in (True, "true", "1"):
        raise HTTPException(status_code=403, detail="第三方帳號尚未驗證電子郵件")
    if not claims.get("sub") or not claims.get("email"):
        raise HTTPException(status_code=401, detail="第三方帳號未提供必要的身分資料")
    return claims


def login_with_provider(provider: str, claims: dict[str, Any]) -> dict[str, Any]:
    email = normalize_email(claims["email"])
    display_name = str(claims.get("name") or email.split("@", 1)[0])[:80]
    with get_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        linked = conn.execute(
            """
            SELECT users.id, users.email, users.display_name
            FROM oauth_accounts
            JOIN users ON users.id = oauth_accounts.user_id
            WHERE oauth_accounts.provider = ? AND oauth_accounts.subject = ?
            """,
            (provider, claims["sub"]),
        ).fetchone()
        if linked is not None:
            return public_user(linked)

        user = conn.execute(
            "SELECT id, email, display_name FROM users WHERE lower(email) = ?",
            (email,),
        ).fetchone()
        if user is None:
            existing = conn.execute("SELECT id FROM users LIMIT 1").fetchone()
            if existing is not None:
                raise HTTPException(
                    status_code=409,
                    detail="此為單一使用者資料庫，請使用已註冊的帳號登入",
                )
            cursor = conn.execute(
                "INSERT INTO users (email, password_hash, display_name) VALUES (?, NULL, ?)",
                (email, display_name),
            )
            user_id = cursor.lastrowid
            user = conn.execute(
                "SELECT id, email, display_name FROM users WHERE id = ?", (user_id,)
            ).fetchone()

        conn.execute(
            "INSERT INTO oauth_accounts (user_id, provider, subject) VALUES (?, ?, ?)",
            (user["id"], provider, claims["sub"]),
        )
        conn.commit()
        return public_user(user)


@app.get("/api/auth/providers")
def auth_providers() -> dict[str, bool]:
    return {
        "email": True,
        "google": oauth_provider_configured("google"),
        "apple": oauth_provider_configured("apple"),
    }


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
def register_account(
    credentials: AccountRegistration, response: Response
) -> dict[str, Any]:
    email = normalize_email(credentials.email)
    if len(credentials.password) < 6:
        raise HTTPException(
            status_code=422, detail="密碼至少需要 6 個字元"
        )
    display_name = credentials.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=422, detail="請輸入顯示名稱")
    with get_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing_email = conn.execute(
            "SELECT id, password_hash FROM users WHERE lower(email) = ?",
            (email,),
        ).fetchone()
        if existing_email is not None:
            if existing_email["password_hash"]:
                raise HTTPException(status_code=409, detail="此電子郵件已註冊，請直接登入")
            user_id = existing_email["id"]
            conn.execute(
                "UPDATE users SET password_hash = ?, display_name = ? WHERE id = ?",
                (hash_password(credentials.password), display_name, user_id),
            )
        elif conn.execute("SELECT id FROM users LIMIT 1").fetchone() is not None:
            raise HTTPException(
                status_code=409,
                detail="此為單一使用者資料庫，帳號已建立；請直接登入或連結社群帳號",
            )
        else:
            cursor = conn.execute(
                """
                INSERT INTO users (email, password_hash, display_name)
                VALUES (?, ?, ?)
                """,
                (email, hash_password(credentials.password), display_name),
            )
            user_id = cursor.lastrowid
        conn.commit()
    issue_session(response, user_id)
    return {"authenticated": True, "user": {"id": user_id, "email": email, "display_name": display_name}}


@app.post("/api/auth/login")
def login_account(credentials: AccountCredentials, response: Response) -> dict[str, Any]:
    email = normalize_email(credentials.email)
    with get_connection() as conn:
        user = conn.execute(
            "SELECT id, email, display_name, password_hash FROM users WHERE lower(email) = ?",
            (email,),
        ).fetchone()
    if user is None or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="電子郵件或密碼不正確")
    issue_session(response, user["id"])
    return {"authenticated": True, "user": public_user(user)}


@app.get("/api/auth/me")
def auth_me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return {"authenticated": True, "user": user}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM auth_sessions WHERE token_hash = ?",
                (hashlib.sha256(token.encode()).hexdigest(),),
            )
            conn.commit()
    response.delete_cookie(SESSION_COOKIE, path="/", samesite="lax")
    return {"authenticated": False}


def begin_oauth(provider: str) -> RedirectResponse:
    if not oauth_provider_configured(provider):
        raise HTTPException(
            status_code=503,
            detail=f"{provider.title()} OAuth 尚未設定，請檢查伺服器環境變數",
        )
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).decode("ascii").rstrip("=")
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM oauth_states WHERE expires_at <= ?", (int(time.time()),)
        )
        conn.execute(
            """
            INSERT INTO oauth_states (state_hash, provider, nonce, code_verifier, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                hashlib.sha256(state.encode()).hexdigest(),
                provider,
                nonce,
                verifier,
                int(time.time()) + OAUTH_STATE_TTL_SECONDS,
            ),
        )
        conn.commit()

    client_id = os.environ[f"{provider.upper()}_CLIENT_ID"]
    authorization_url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        if provider == "google"
        else "https://appleid.apple.com/auth/authorize"
    )
    scopes = "openid email profile" if provider == "google" else "openid email"
    parameters = {
        "client_id": client_id,
        "redirect_uri": oauth_redirect_uri(provider),
        "response_type": "code",
        "scope": scopes,
        "state": state,
        "nonce": nonce,
    }
    if provider == "google":
        parameters.update(
            {
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
    else:
        parameters["response_mode"] = "query"
    query = urlencode(parameters)
    redirect = RedirectResponse(f"{authorization_url}?{query}", status_code=302)
    redirect.set_cookie(
        OAUTH_STATE_COOKIE,
        state,
        max_age=OAUTH_STATE_TTL_SECONDS,
        httponly=True,
        secure=oauth_redirect_uri(provider).startswith("https://"),
        samesite="lax",
        path="/api/auth",
    )
    return redirect


def complete_oauth(
    provider: str, request: Request, code: str, state: str
) -> RedirectResponse:
    cookie_state = request.cookies.get(OAUTH_STATE_COOKIE, "")
    if not cookie_state or not hmac.compare_digest(cookie_state, state):
        raise HTTPException(status_code=400, detail="登入驗證已失效，請重新開始")
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    with get_connection() as conn:
        oauth_state = conn.execute(
            """
            SELECT nonce, code_verifier FROM oauth_states
            WHERE state_hash = ? AND provider = ? AND expires_at > ?
            """,
            (state_hash, provider, int(time.time())),
        ).fetchone()
        conn.execute("DELETE FROM oauth_states WHERE state_hash = ?", (state_hash,))
        conn.commit()
    if oauth_state is None:
        raise HTTPException(status_code=400, detail="登入驗證已逾期，請重新開始")

    token_data = exchange_oauth_code(provider, code, oauth_state["code_verifier"])
    claims = verify_provider_id_token(
        provider, token_data["id_token"], oauth_state["nonce"]
    )
    user = login_with_provider(provider, claims)
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(OAUTH_STATE_COOKIE, path="/api/auth", samesite="lax")
    issue_session(response, user["id"])
    return response


@app.get("/api/auth/google")
def google_login() -> RedirectResponse:
    return begin_oauth("google")


@app.get("/api/auth/google/callback")
def google_callback(
    request: Request, code: str = "", state: str = "", error: str = ""
) -> RedirectResponse:
    if error or not code or not state:
        raise HTTPException(status_code=400, detail="Google 登入已取消或未完成")
    return complete_oauth("google", request, code, state)


@app.get("/api/auth/apple")
def apple_login() -> RedirectResponse:
    return begin_oauth("apple")


@app.get("/api/auth/apple/callback")
def apple_callback(
    request: Request, code: str = "", state: str = "", error: str = ""
) -> RedirectResponse:
    if error or not code or not state:
        raise HTTPException(status_code=400, detail="Apple 登入已取消或未完成")
    return complete_oauth("apple", request, code, state)


@app.get("/api/entries", response_model=list[EntryOut])
def list_entries(_: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM entries ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/entries", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(
    entry: EntryCreate, _: dict[str, Any] = Depends(get_current_user)
) -> dict[str, Any]:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO entries (title, content, mood, location, privacy, tags)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                entry.title,
                entry.content,
                entry.mood,
                entry.location,
                entry.privacy,
                entry.tags,
            ),
        )
        conn.commit()
        new_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM entries WHERE id = ?", (new_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create entry")
    return dict(row)


def get_map_point(conn: sqlite3.Connection, point_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM map_points WHERE id = ?", (point_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="找不到這個足跡")
    return dict(row)


def get_trip_with_points(conn: sqlite3.Connection, trip_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM trips WHERE id = ?", (trip_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="找不到這個行程包")
    trip = dict(row)
    trip["is_public"] = bool(trip["is_public"])
    trip["points"] = [
        dict(point)
        for point in conn.execute(
            """
            SELECT map_points.*
            FROM map_points
            JOIN trip_map_points ON trip_map_points.map_point_id = map_points.id
            WHERE trip_map_points.trip_id = ?
            ORDER BY trip_map_points.position, map_points.id
            """,
            (trip_id,),
        ).fetchall()
    ]
    return trip


@app.get("/api/map-points")
def list_map_points(
    _: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM map_points ORDER BY created_at DESC, id DESC"
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/map-points", status_code=status.HTTP_201_CREATED)
def create_map_point(
    point: MapPointCreate, _: dict[str, Any] = Depends(get_current_user)
) -> dict[str, Any]:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO map_points (name, latitude, longitude, note, privacy)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                point.name.strip(),
                point.latitude,
                point.longitude,
                point.note.strip(),
                point.privacy,
            ),
        )
        created = get_map_point(conn, cursor.lastrowid)
        conn.commit()
    return created


@app.patch("/api/map-points/{point_id}/privacy")
def update_map_point_privacy(
    point_id: int,
    update: MapPointPrivacyUpdate,
    _: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE map_points SET privacy = ? WHERE id = ?",
            (update.privacy, point_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="找不到這個足跡")
        point = get_map_point(conn, point_id)
        conn.commit()
    return point


@app.get("/api/trips")
def list_trips(
    _: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    with get_connection() as conn:
        trip_ids = [
            row["id"]
            for row in conn.execute(
                "SELECT id FROM trips ORDER BY created_at DESC, id DESC"
            ).fetchall()
        ]
        return [get_trip_with_points(conn, trip_id) for trip_id in trip_ids]


@app.post("/api/trips", status_code=status.HTTP_201_CREATED)
def create_trip(
    trip: TripCreate, _: dict[str, Any] = Depends(get_current_user)
) -> dict[str, Any]:
    point_ids = list(dict.fromkeys(trip.point_ids))
    with get_connection() as conn:
        if point_ids:
            placeholders = ",".join("?" for _ in point_ids)
            found = conn.execute(
                f"SELECT id FROM map_points WHERE id IN ({placeholders})",
                point_ids,
            ).fetchall()
            if len(found) != len(point_ids):
                raise HTTPException(
                    status_code=404, detail="部分選取的足跡不存在"
                )
        cursor = conn.execute(
            "INSERT INTO trips (title, description, is_public) VALUES (?, ?, ?)",
            (trip.title.strip(), trip.description.strip(), int(trip.is_public)),
        )
        trip_id = cursor.lastrowid
        conn.executemany(
            """
            INSERT INTO trip_map_points (trip_id, map_point_id, position)
            VALUES (?, ?, ?)
            """,
            [
                (trip_id, point_id, position)
                for position, point_id in enumerate(point_ids)
            ],
        )
        created = get_trip_with_points(conn, trip_id)
        conn.commit()
    return created


@app.get("/api/trips/{trip_id}")
def get_trip(
    trip_id: int, _: dict[str, Any] = Depends(get_current_user)
) -> dict[str, Any]:
    with get_connection() as conn:
        return get_trip_with_points(conn, trip_id)


@app.get("/api/trips/{trip_id}/share")
def get_shared_trip(trip_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        trip = get_trip_with_points(conn, trip_id)
    if not trip["is_public"]:
        raise HTTPException(status_code=404, detail="此行程包未公開")
    trip["points"] = [
        point for point in trip["points"] if point["privacy"] == "public"
    ]
    return {"share_url": f"/api/trips/{trip_id}/share", "trip": trip}


@app.get("/api/entries/{entry_id}", response_model=EntryOut)
def get_entry(
    entry_id: int, _: dict[str, Any] = Depends(get_current_user)
) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return dict(row)


@app.get("/api/location-points", response_model=list[LocationLogOut])
def list_location_points(
    _: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM location_logs ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/location-points", response_model=LocationLogOut, status_code=status.HTTP_201_CREATED)
def create_location_point(
    location: LocationLogCreate,
    _: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO location_logs (name, latitude, longitude, note)
            VALUES (?, ?, ?, ?)
            """,
            (
                location.name,
                location.latitude,
                location.longitude,
                location.note,
            ),
        )
        conn.commit()
        new_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM location_logs WHERE id = ?", (new_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create location point")
    return dict(row)


@app.get("/api/settings", response_model=list[SettingsOut])
def get_settings(
    user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, str]]:
    with get_connection() as conn:
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(settings)")
        }
        if "owner_id" in columns:
            rows = conn.execute(
                "SELECT key, value FROM settings WHERE owner_id = ? ORDER BY key",
                (user["id"],),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT key, value FROM settings ORDER BY key"
            ).fetchall()
    return [dict(row) for row in rows]


@app.put("/api/settings", response_model=SettingsOut)
def update_setting(
    setting: SettingUpdate,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, str]:
    with get_connection() as conn:
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(settings)")
        }
        if "owner_id" in columns:
            conn.execute(
                """
                INSERT INTO settings (owner_id, key, value) VALUES (?, ?, ?)
                ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value
                """,
                (user["id"], setting.key, setting.value),
            )
        else:
            conn.execute(
                """
                INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (setting.key, setting.value),
            )
        conn.commit()
        if "owner_id" in columns:
            row = conn.execute(
                "SELECT key, value FROM settings WHERE owner_id = ? AND key = ?",
                (user["id"], setting.key),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT key, value FROM settings WHERE key = ?", (setting.key,)
            ).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to update setting")
    return dict(row)


@app.get("/api/dashboard")
def dashboard(_: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with get_connection() as conn:
        entry_count = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        latest_entry = conn.execute(
            "SELECT * FROM entries ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        recent_locations = conn.execute(
            "SELECT * FROM location_logs ORDER BY created_at DESC LIMIT 3"
        ).fetchall()

    return {
        "entry_count": entry_count,
        "latest_entry": dict(latest_entry) if latest_entry else None,
        "recent_locations": [dict(row) for row in recent_locations],
    }


if __name__ == "__main__":
    import uvicorn

    app_module = f"{__package__}.main:app" if __package__ else "main:app"
    uvicorn.run(app_module, host="0.0.0.0", port=8000, reload=True)
