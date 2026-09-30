"""Environment configuration. Parsed once at startup; invalid values fail fast."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

LANGUAGE_NAMES: dict[str, str | None] = {
    # Fun-ASR-Nano expects the language name used in its prompt; None lets the model decide.
    "zh": "中文",
    "en": "英文",
    "ja": "日文",
    "auto": None,
}


class Settings(BaseModel):
    provider: str = Field(default="funasr", alias="ASR_PROVIDER")
    model: str = Field(default="FunAudioLLM/Fun-ASR-Nano-2512", alias="ASR_MODEL")
    model_hub: Literal["hf", "ms"] = Field(default="hf", alias="ASR_MODEL_HUB")
    vad_model: str = Field(default="fsmn-vad", alias="ASR_VAD_MODEL")
    vad_max_segment_ms: int = Field(default=30_000, ge=1_000, le=60_000, alias="ASR_VAD_MAX_SEGMENT_MS")
    language: str = Field(default="zh", alias="ASR_LANGUAGE")
    device: str = Field(default="cuda", alias="ASR_DEVICE")
    max_concurrency: int = Field(default=2, ge=1, le=16, alias="ASR_MAX_CONCURRENCY")
    max_queue: int = Field(default=16, ge=0, le=1_000, alias="ASR_MAX_QUEUE")
    itn: bool = Field(default=True, alias="ASR_ITN")
    warmup: bool = Field(default=True, alias="ASR_WARMUP")
    opencc_config: str = Field(default="s2tw", alias="ASR_OPENCC_CONFIG")
    max_audio_bytes: int = Field(default=262_144_000, gt=0, alias="MAX_AUDIO_BYTES")
    max_audio_minutes: float = Field(default=60, gt=0, le=240, alias="MAX_AUDIO_MINUTES")
    max_hotwords: int = Field(default=200, ge=0, le=1_000, alias="ASR_MAX_HOTWORDS")
    ffmpeg_bin: str = Field(default="ffmpeg", alias="FFMPEG_BIN")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    model_config = {"populate_by_name": True, "extra": "ignore"}

    @field_validator("language")
    @classmethod
    def _known_language(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in LANGUAGE_NAMES:
            raise ValueError(f"unsupported ASR_LANGUAGE {value!r}; expected one of {sorted(LANGUAGE_NAMES)}")
        return value

    @field_validator("provider")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("log_level")
    @classmethod
    def _log_level(cls, value: str) -> str:
        return value.strip().lower()

    @property
    def max_audio_ms(self) -> int:
        return int(self.max_audio_minutes * 60_000)


class ConfigError(ValueError):
    pass


def load_settings(env: Mapping[str, str]) -> Settings:
    """Build settings from an environment mapping (only known keys are read)."""
    known = {field.alias for field in Settings.model_fields.values() if field.alias}
    values = {key: value for key, value in env.items() if key in known and value != ""}
    try:
        return Settings.model_validate(values)
    except ValidationError as error:
        raise ConfigError(str(error)) from error
