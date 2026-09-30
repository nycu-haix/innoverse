"""API contract. The Node server validates the same shape with Zod."""

from __future__ import annotations

from pydantic import BaseModel, Field


class TranscriptionResponse(BaseModel):
    """Field names are camelCase because they are the JSON contract."""

    text: str
    language: str | None
    model: str
    provider: str
    audioDurationMs: float | None = Field(ge=0)
    processingMs: float = Field(ge=0)


class HealthResponse(BaseModel):
    status: str
    modelLoaded: bool
    model: str
    provider: str
    device: str
    maxConcurrency: int
    error: str | None = None


class ErrorDetail(BaseModel):
    code: str
    message: str
