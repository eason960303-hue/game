from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class DemoLoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    password: str = Field(..., min_length=1, max_length=200)


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

        old_points = conn.execute(
            "SELECT COUNT(*) FROM map_points"
        ).fetchone()[0]
        if old_points == 0:
            conn.execute(
                """
                INSERT INTO map_points (name, latitude, longitude, note, privacy, created_at)
                SELECT name, latitude, longitude, COALESCE(note, ''), 'private', created_at
                FROM location_logs
                WHERE latitude IS NOT NULL AND longitude IS NOT NULL
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


@app.post("/api/auth/login")
def demo_login(request: DemoLoginRequest) -> dict[str, Any]:
    username = request.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username is required")
    return {
        "authenticated": True,
        "demo": True,
        "username": username,
        "display_name": username,
        "message": "Demo session only; credentials are not stored or verified.",
    }


@app.post("/api/auth/logout")
def demo_logout() -> dict[str, Any]:
    return {"authenticated": False, "demo": True}


@app.get("/api/entries", response_model=list[EntryOut])
def list_entries() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM entries ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/entries", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(entry: EntryCreate) -> dict[str, Any]:
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
    row = conn.execute(
        "SELECT * FROM map_points WHERE id = ?", (point_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Map point not found")
    return dict(row)


def get_trip_with_points(conn: sqlite3.Connection, trip_id: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM trips WHERE id = ?", (trip_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    trip = dict(row)
    trip["is_public"] = bool(trip["is_public"])
    trip["points"] = [
        dict(point)
        for point in conn.execute(
            """
            SELECT mp.*
            FROM map_points AS mp
            JOIN trip_map_points AS tmp ON tmp.map_point_id = mp.id
            WHERE tmp.trip_id = ?
            ORDER BY tmp.position, mp.id
            """,
            (trip_id,),
        ).fetchall()
    ]
    return trip


@app.get("/api/map-points")
def list_map_points() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM map_points ORDER BY created_at DESC, id DESC"
        ).fetchall()
    return [dict(row) for row in rows]


@app.post(
    "/api/map-points",
    status_code=status.HTTP_201_CREATED,
)
def create_map_point(point: MapPointCreate) -> dict[str, Any]:
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
    point_id: int, update: MapPointPrivacyUpdate
) -> dict[str, Any]:
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE map_points SET privacy = ? WHERE id = ?",
            (update.privacy, point_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Map point not found")
        point = get_map_point(conn, point_id)
        conn.commit()
    return point


@app.get("/api/trips")
def list_trips() -> list[dict[str, Any]]:
    with get_connection() as conn:
        trip_ids = [
            row["id"]
            for row in conn.execute(
                "SELECT id FROM trips ORDER BY created_at DESC, id DESC"
            ).fetchall()
        ]
        trips = [get_trip_with_points(conn, trip_id) for trip_id in trip_ids]
    return trips


@app.post("/api/trips", status_code=status.HTTP_201_CREATED)
def create_trip(trip: TripCreate) -> dict[str, Any]:
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
                    status_code=404,
                    detail="One or more selected map points do not exist",
                )

        cursor = conn.execute(
            """
            INSERT INTO trips (title, description, is_public)
            VALUES (?, ?, ?)
            """,
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
def get_trip(trip_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        return get_trip_with_points(conn, trip_id)


@app.get("/api/trips/{trip_id}/share")
def get_shared_trip(trip_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        trip = get_trip_with_points(conn, trip_id)
    if not trip["is_public"]:
        raise HTTPException(status_code=404, detail="This trip is not public")
    trip["points"] = [
        point for point in trip["points"] if point["privacy"] == "public"
    ]
    return {
        "share_url": f"/api/trips/{trip_id}/share",
        "trip": trip,
    }


@app.get("/api/entries/{entry_id}", response_model=EntryOut)
def get_entry(entry_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return dict(row)


@app.get("/api/location-points", response_model=list[LocationLogOut])
def list_location_points() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM location_logs ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/location-points", response_model=LocationLogOut, status_code=status.HTTP_201_CREATED)
def create_location_point(location: LocationLogCreate) -> dict[str, Any]:
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
def get_settings() -> list[dict[str, str]]:
    with get_connection() as conn:
        rows = conn.execute("SELECT key, value FROM settings ORDER BY key").fetchall()
    return [dict(row) for row in rows]


@app.put("/api/settings", response_model=SettingsOut)
def update_setting(setting: SettingUpdate) -> dict[str, str]:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (setting.key, setting.value),
        )
        conn.commit()
        row = conn.execute("SELECT key, value FROM settings WHERE key = ?", (setting.key,)).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to update setting")
    return dict(row)


@app.get("/api/dashboard")
def dashboard() -> dict[str, Any]:
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
