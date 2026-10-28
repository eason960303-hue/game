from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class EntryCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    mood: str = Field(default="happy")
    location: Optional[str] = None
    privacy: str = Field(default="private")
    tags: Optional[str] = None


class EntryOut(BaseModel):
    id: int
    title: str
    content: str
    mood: str
    location: Optional[str] = None
    privacy: str
    tags: Optional[str] = None
    created_at: str


class LocationLogCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    note: Optional[str] = None


class LocationLogOut(BaseModel):
    id: int
    name: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    note: Optional[str] = None
    created_at: str


class SettingUpdate(BaseModel):
    key: str
    value: str


class SettingsOut(BaseModel):
    key: str
    value: str
