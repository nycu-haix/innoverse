import asyncio
import threading
import time
from pathlib import Path

import pytest

from app.config import Settings, load_settings
from app.providers import RawTranscription, TranscribeOptions
from app.service import NotReadyError, TranscriptionService
from tests.conftest import requires_ffmpeg, write_wav


class Identity:
    def convert(self, text: str) -> str:
        return text


class SlowBackend:
    name = "slow"
    model_id = "slow"
    device = "cpu"

    def __init__(self) -> None:
        self.active = 0
        self.peak = 0
        self.lock = threading.Lock()

    def load(self) -> None:
        pass

    def warmup(self) -> None:
        pass

    def transcribe(self, wav_path: Path, options: TranscribeOptions) -> RawTranscription:
        with self.lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
        time.sleep(0.05)
        with self.lock:
            self.active -= 1
        return RawTranscription(text="ok")


def test_refuses_requests_before_startup(settings: Settings, tmp_path: Path) -> None:
    service = TranscriptionService(settings, SlowBackend(), Identity())
    with pytest.raises(NotReadyError):
        asyncio.run(service.transcribe(tmp_path / "x", tmp_path, [], None))


@requires_ffmpeg
def test_concurrency_is_bounded(tmp_path: Path) -> None:
    settings = load_settings({"ASR_MAX_CONCURRENCY": "2", "ASR_WARMUP": "false", "ASR_DEVICE": "cpu"})
    backend = SlowBackend()
    service = TranscriptionService(settings, backend, Identity())
    service.startup()
    source = write_wav(tmp_path / "in.wav", seconds=0.2)

    async def run_many() -> None:
        async def one(index: int) -> None:
            workdir = tmp_path / f"w{index}"
            workdir.mkdir()
            await service.transcribe(source, workdir, [], None)

        await asyncio.gather(*(one(i) for i in range(6)))

    asyncio.run(run_many())
    assert backend.peak == 2
