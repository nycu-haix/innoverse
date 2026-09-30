import asyncio
from pathlib import Path

import pytest

from app.audio import (
    AudioError,
    normalize_audio,
    normalize_content_type,
    temporary_workdir,
    validate_content_type,
    wav_duration_ms,
)
from tests.conftest import requires_ffmpeg, write_wav


@pytest.mark.parametrize("value", ["audio/webm;codecs=opus", "audio/ogg", "audio/mp4", "audio/wav", "AUDIO/WEBM"])
def test_accepts_browser_audio_types(value: str) -> None:
    assert validate_content_type(value) == normalize_content_type(value)


@pytest.mark.parametrize("value", [None, "", "text/html", "image/png", "application/json"])
def test_rejects_non_audio_types(value: str | None) -> None:
    with pytest.raises(AudioError) as info:
        validate_content_type(value)
    assert info.value.code == "unsupported_audio"


def test_temporary_workdir_is_removed_on_success_and_error() -> None:
    async def scenario() -> tuple[Path, Path]:
        async with temporary_workdir() as ok_dir:
            (ok_dir / "audio").write_bytes(b"x")
        failed_dir: Path | None = None
        with pytest.raises(RuntimeError):
            async with temporary_workdir() as failing:
                failed_dir = failing
                (failing / "audio").write_bytes(b"x")
                raise RuntimeError("boom")
        assert failed_dir is not None
        return ok_dir, failed_dir

    ok_dir, failed_dir = asyncio.run(scenario())
    assert not ok_dir.exists()
    assert not failed_dir.exists()


@requires_ffmpeg
def test_normalizes_to_16k_mono(tmp_path: Path) -> None:
    source = write_wav(tmp_path / "in.wav", seconds=0.5)
    target = tmp_path / "out.wav"
    duration = asyncio.run(normalize_audio(source, target))
    assert 480 <= duration <= 520
    import wave

    with wave.open(str(target), "rb") as handle:
        assert handle.getframerate() == 16_000
        assert handle.getnchannels() == 1
    assert wav_duration_ms(target) == duration


@requires_ffmpeg
def test_rejects_undecodable_audio(tmp_path: Path) -> None:
    source = tmp_path / "garbage.webm"
    source.write_bytes(b"this is not audio at all")
    with pytest.raises(AudioError) as info:
        asyncio.run(normalize_audio(source, tmp_path / "out.wav"))
    assert info.value.code == "invalid_audio"


@requires_ffmpeg
def test_rejects_audio_over_the_maximum_duration(tmp_path: Path) -> None:
    source = write_wav(tmp_path / "long.wav", seconds=3)
    # Decoding is capped at max + 1s, so longer input never reaches the model in full.
    duration = asyncio.run(normalize_audio(source, tmp_path / "out.wav", max_duration_ms=1_000))
    assert duration <= 2_000


def test_missing_ffmpeg_is_reported(tmp_path: Path) -> None:
    source = write_wav(tmp_path / "in.wav")
    with pytest.raises(AudioError) as info:
        asyncio.run(normalize_audio(source, tmp_path / "out.wav", ffmpeg_bin="definitely-not-ffmpeg"))
    assert info.value.code == "ffmpeg_missing"
