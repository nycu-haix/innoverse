"""Transcription pipeline: validate → ffmpeg normalize → GPU inference → OpenCC s2t."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

from .audio import AudioError, normalize_audio
from .config import LANGUAGE_NAMES, Settings
from .hotwords import normalize_hotwords
from .providers import AsrBackend, TranscribeOptions
from .schemas import TranscriptionResponse
from .text import Converter, normalize_transcript

logger = logging.getLogger("asr.service")


class NotReadyError(Exception):
    pass


class BusyError(Exception):
    pass


class TranscriptionService:
    """Owns the single loaded model and bounds concurrent GPU inference.

    The model is loaded once in `startup()`; requests never reload it. At most
    `ASR_MAX_CONCURRENCY` inferences run at a time and at most `ASR_MAX_QUEUE`
    requests may wait; further requests are rejected with 503 instead of piling up.
    """

    def __init__(self, settings: Settings, backend: AsrBackend, converter: Converter) -> None:
        self.settings = settings
        self.backend = backend
        self.converter = converter
        self.ready = False
        self.load_error: str | None = None
        self._semaphore = asyncio.Semaphore(settings.max_concurrency)
        self._waiting = 0

    def startup(self) -> None:
        """Blocking model load + optional warmup. Readiness is set only on success."""
        started = time.perf_counter()
        try:
            self.backend.load()
            if self.settings.warmup:
                self.backend.warmup()
        except Exception as error:
            self.load_error = f"{type(error).__name__}"
            logger.exception("model failed to load")
            raise
        self.ready = True
        logger.info(
            "model ready", extra={"model": self.backend.model_id, "load_s": round(time.perf_counter() - started, 1)}
        )

    def resolve_language(self, requested: str | None) -> str | None:
        key = (requested or self.settings.language).strip().lower()
        if key not in LANGUAGE_NAMES:
            raise AudioError("invalid_language", f"unsupported language {key!r}")
        return LANGUAGE_NAMES[key]

    async def transcribe(
        self, source: Path, workdir: Path, hotwords: list[str], language: str | None
    ) -> TranscriptionResponse:
        if not self.ready:
            raise NotReadyError()
        started = time.perf_counter()
        model_language = self.resolve_language(language)
        terms = normalize_hotwords(hotwords, self.settings.max_hotwords)

        wav_path = workdir / "normalized.wav"
        duration_ms = await normalize_audio(source, wav_path, self.settings.ffmpeg_bin, self.settings.max_audio_ms)

        if self._waiting >= self.settings.max_queue + self.settings.max_concurrency:
            raise BusyError()
        self._waiting += 1
        try:
            # The semaphore is held until the worker thread finishes, so GPU work can
            # never exceed the configured concurrency, even if the client disconnects.
            async with self._semaphore:
                inference_started = time.perf_counter()
                raw = await asyncio.to_thread(
                    self.backend.transcribe,
                    wav_path,
                    TranscribeOptions(hotwords=terms, language=model_language, itn=self.settings.itn),
                )
                inference_ms = (time.perf_counter() - inference_started) * 1000
        finally:
            self._waiting -= 1

        text = normalize_transcript(raw.text, self.converter)
        processing_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "transcribed",
            extra={
                "audio_ms": round(duration_ms),
                "inference_ms": round(inference_ms),
                "processing_ms": round(processing_ms),
                "rtf": round(inference_ms / duration_ms, 3) if duration_ms else None,
                "hotwords": len(terms),
                "chars": len(text),
            },
        )
        return TranscriptionResponse(
            text=text,
            language=language or self.settings.language,
            model=self.backend.model_id,
            provider=self.backend.name,
            audioDurationMs=duration_ms,
            processingMs=processing_ms,
        )
