from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

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


@app.on_event("startup")
def startup_event() -> None:
    init_db()


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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
