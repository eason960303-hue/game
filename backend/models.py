from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class EntryCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=12000)
    mood: str = Field(default="happy", max_length=80)
    location: Optional[str] = Field(default=None, max_length=200)
    privacy: Literal["private", "friends", "public"] = "private"
    tags: Optional[str] = Field(default=None, max_length=1000)


class EntryOut(BaseModel):
    id: int
    title: str
    content: str
    mood: str
    location: Optional[str] = None
    privacy: str
    tags: Optional[str] = None
    created_at: str
    owner_name: Optional[str] = None
    is_owner: bool = False


class LocationLogCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    note: Optional[str] = Field(default=None, max_length=1000)


class LocationLogOut(BaseModel):
    id: int
    name: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    note: Optional[str] = None
    created_at: str


class SettingUpdate(BaseModel):
    key: str = Field(..., min_length=1, max_length=80)
    value: str = Field(..., max_length=2000)


class SettingsOut(BaseModel):
    key: str
    value: str
