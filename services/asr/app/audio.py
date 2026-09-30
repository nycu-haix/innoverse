"""Browser audio → 16 kHz mono PCM WAV via ffmpeg, using private temporary files."""

from __future__ import annotations

import asyncio
import contextlib
import os
import shutil
import tempfile
import wave
from collections.abc import AsyncIterator
from pathlib import Path

ALLOWED_CONTENT_TYPES = frozenset(
    {
        "audio/webm",
        "video/webm",
        "audio/ogg",
        "audio/mp4",
        "audio/x-m4a",
        "audio/aac",
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "application/octet-stream",
    }
)

TARGET_SAMPLE_RATE = 16_000


class AudioError(Exception):
    """Invalid or unusable audio. `code` is part of the HTTP error contract."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def normalize_content_type(value: str | None) -> str:
    return (value or "").split(";", 1)[0].strip().lower()


def validate_content_type(value: str | None) -> str:
    content_type = normalize_content_type(value)
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise AudioError("unsupported_audio", f"unsupported content type {content_type or 'missing'}")
    return content_type


@contextlib.asynccontextmanager
async def temporary_workdir(prefix: str = "asr-") -> AsyncIterator[Path]:
    """Private temp directory that is always removed, even on errors or cancellation."""
    # mkdtemp creates the directory with mode 0o700 (owner-only).
    path = Path(tempfile.mkdtemp(prefix=prefix))
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def wav_duration_ms(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
    return frames / rate * 1000 if rate else 0.0


async def normalize_audio(
    source: Path, target: Path, ffmpeg_bin: str = "ffmpeg", max_duration_ms: int | None = None
) -> float:
    """Decode any supported container to 16 kHz mono s16 WAV. Returns the duration in ms.

    Arguments are passed as a list (no shell). Only file paths we created are used.
    """
    if shutil.which(ffmpeg_bin) is None:
        raise AudioError("ffmpeg_missing", "ffmpeg is not installed")
    args = [ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vn", "-ac", "1"]
    args += ["-ar", str(TARGET_SAMPLE_RATE), "-c:a", "pcm_s16le", "-f", "wav"]
    if max_duration_ms is not None:
        # Hard cap: never decode more than the configured maximum (+1s tolerance).
        args += ["-t", f"{max_duration_ms / 1000 + 1:.3f}"]
    args.append(str(target))
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await process.communicate()
    if process.returncode != 0 or not os.path.exists(target):  # noqa: ASYNC240 - single stat after ffmpeg exits
        # stderr may describe the container but never contains audio; keep it short.
        detail = stderr.decode("utf-8", "replace").strip().splitlines()[-1:] if stderr else []
        raise AudioError("invalid_audio", f"ffmpeg could not decode audio: {' '.join(detail)[:200]}")
    try:
        duration = wav_duration_ms(target)
    except (wave.Error, EOFError) as error:
        raise AudioError("invalid_audio", "decoded audio is not valid WAV") from error
    if duration <= 0:
        raise AudioError("empty_audio", "audio contains no samples")
    if max_duration_ms is not None and duration > max_duration_ms + 1_000:
        raise AudioError("too_long", "audio exceeds the maximum duration")
    return duration
