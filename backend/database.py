from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "life_app.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                mood TEXT,
                location TEXT,
                privacy TEXT DEFAULT 'private',
                tags TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS location_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )

        settings = conn.execute("SELECT key FROM settings WHERE key = 'theme'").fetchone()
        if settings is None:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('theme', 'dark')"
            )

        if conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0] == 0:
            conn.execute(
                """
                INSERT INTO entries (title, content, mood, location, privacy, tags, created_at)
                VALUES
                    ('天文照片', '今晚的天空很安靜，城市燈光與月亮形成一種很溫柔的對照。', 'calm', '高雄港邊', 'private', '星空,散步', '2026-10-28 21:00:00'),
                    ('朵久沒有出去玩了', '這幾天看著時間飛逝，終於抽出空檔和朋友去走一段街道。', 'happy', '台中市區', 'shared', '朋友,放鬆', '2026-10-27 18:30:00')
                """
            )

        if conn.execute("SELECT COUNT(*) FROM location_logs").fetchone()[0] == 0:
            conn.execute(
                """
                INSERT INTO location_logs (name, latitude, longitude, note, created_at)
                VALUES
                    ('河岸散步', 22.6273, 120.3014, '天色很舒服，晚上很安靜。', '2026-10-28 20:52:00'),
                    ('海邊夜跑', 22.6200, 120.2870, '風大但很放鬆。', '2026-10-27 19:10:00')
                """
            )

        conn.commit()
