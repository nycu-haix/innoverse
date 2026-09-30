from __future__ import annotations

import shutil
import struct
import wave
from pathlib import Path

import pytest

from app.config import Settings, load_settings
from app.providers import RawTranscription, TranscribeOptions

requires_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


class FakeBackend:
    """Stands in for Fun-ASR-Nano; never touches a GPU."""

    name = "fake"
    device = "cpu"

    def __init__(self, text: str = "这颗抗生素一天三次，饭后吃。", fail: bool = False) -> None:
        self.model_id = "fake/model"
        self.text = text
        self.fail = fail
        self.loads = 0
        self.calls: list[TranscribeOptions] = []

    def load(self) -> None:
        self.loads += 1

    def warmup(self) -> None:
        pass

    def transcribe(self, wav_path: Path, options: TranscribeOptions) -> RawTranscription:
        assert wav_path.exists()
        self.calls.append(options)
        if self.fail:
            raise RuntimeError("CUDA out of memory")
        return RawTranscription(text=self.text, language=options.language)


@pytest.fixture
def settings() -> Settings:
    return load_settings(
        {"ASR_DEVICE": "cpu", "ASR_WARMUP": "false", "MAX_AUDIO_BYTES": "2000000", "MAX_AUDIO_MINUTES": "1"}
    )


def write_wav(path: Path, seconds: float = 0.5, rate: int = 44_100) -> Path:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(struct.pack("<hh", 1000, -1000) * int(rate * seconds))
    return path
