"""ASR backend registry. Select with ASR_PROVIDER / ASR_MODEL.

To benchmark or switch models (SenseVoice, Paraformer, faster-whisper / Whisper
large-v3-turbo), add a class implementing `AsrBackend` and register it here; the HTTP
API, the Node server and the application layer stay unchanged.
"""

from __future__ import annotations

from collections.abc import Callable

from ..config import Settings
from .base import AsrBackend, RawTranscription, TranscribeOptions
from .funasr_nano import FunAsrNanoBackend

BackendFactory = Callable[[Settings], AsrBackend]

BACKENDS: dict[str, BackendFactory] = {
    "funasr": lambda settings: FunAsrNanoBackend(
        model_id=settings.model,
        device=settings.device,
        hub=settings.model_hub,
        vad_model=settings.vad_model or None,
        vad_max_segment_ms=settings.vad_max_segment_ms,
    ),
}


def create_backend(settings: Settings) -> AsrBackend:
    try:
        factory = BACKENDS[settings.provider]
    except KeyError as error:
        raise ValueError(f"unknown ASR_PROVIDER {settings.provider!r}; available: {sorted(BACKENDS)}") from error
    return factory(settings)


__all__ = ["BACKENDS", "AsrBackend", "RawTranscription", "TranscribeOptions", "create_backend"]
