import json
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.schemas import TranscriptionResponse
from tests.conftest import FakeBackend, requires_ffmpeg, write_wav


@pytest.fixture
def backend() -> FakeBackend:
    return FakeBackend()


@pytest.fixture
def client(settings: Settings, backend: FakeBackend, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    temp_root = tmp_path / "tmp"
    temp_root.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(temp_root))
    app = create_app(settings, backend_factory=lambda _: backend)
    with TestClient(app) as test_client:
        test_client.temp_root = temp_root  # type: ignore[attr-defined]
        yield test_client


def upload(client: TestClient, data: bytes, content_type: str = "audio/wav", **fields: str):
    return client.post("/v1/transcribe", files={"audio": ("recording", data, content_type)}, data=fields)


def test_health_reports_loaded_model(client: TestClient, backend: FakeBackend) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["modelLoaded"] is True
    assert body["model"] == "FunAudioLLM/Fun-ASR-Nano-2512"
    assert body["device"] == "cpu"
    assert backend.loads == 1


def test_health_is_not_ready_before_startup(settings: Settings) -> None:
    app = create_app(settings, backend_factory=lambda _: FakeBackend())
    response = TestClient(app).get("/health")  # no lifespan → model not loaded
    assert response.status_code == 503
    assert response.json()["modelLoaded"] is False


@requires_ffmpeg
def test_transcribes_and_converts_to_traditional(client: TestClient, backend: FakeBackend, tmp_path: Path) -> None:
    wav = write_wav(tmp_path / "speech.wav").read_bytes()
    response = upload(client, wav, hotwords=json.dumps(["克拉黴素", " 克拉黴素 ", "Metformin"]), language="zh")
    assert response.status_code == 200, response.text
    body = TranscriptionResponse.model_validate(response.json())
    assert body.text == "這顆抗生素一天三次，飯後吃。"
    assert body.provider == "fake"
    assert body.audioDurationMs is not None and 450 < body.audioDurationMs < 550
    assert backend.calls[0].hotwords == ["克拉黴素", "Metformin"]
    assert backend.calls[0].language == "中文"
    assert backend.loads == 1  # the model is never reloaded per request


@requires_ffmpeg
def test_temp_files_are_cleaned_after_success_and_failure(
    client: TestClient, backend: FakeBackend, tmp_path: Path
) -> None:
    wav = write_wav(tmp_path / "speech.wav").read_bytes()
    assert upload(client, wav).status_code == 200
    assert upload(client, b"garbage", "audio/webm").status_code == 422
    backend.fail = True
    assert upload(client, wav).status_code == 500
    leftovers = [path.name for path in client.temp_root.iterdir() if path.name.startswith("asr-")]  # type: ignore[attr-defined]
    assert leftovers == []


def test_rejects_unsupported_content_type(client: TestClient) -> None:
    response = upload(client, b"<html>", "text/html")
    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "unsupported_audio"


def test_rejects_empty_upload(client: TestClient) -> None:
    response = upload(client, b"")
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "empty_audio"


def test_rejects_oversized_upload(client: TestClient) -> None:
    response = upload(client, b"0" * 2_000_001)
    assert response.status_code == 413


def test_rejects_invalid_hotwords(client: TestClient) -> None:
    response = upload(client, b"RIFF", hotwords="{not json")
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_hotwords"


@requires_ffmpeg
def test_rejects_unknown_language(client: TestClient, tmp_path: Path) -> None:
    response = upload(client, write_wav(tmp_path / "s.wav").read_bytes(), language="xx")
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_language"


@requires_ffmpeg
def test_inference_errors_do_not_leak_details(client: TestClient, backend: FakeBackend, tmp_path: Path) -> None:
    backend.fail = True
    response = upload(client, write_wav(tmp_path / "s.wav").read_bytes())
    assert response.status_code == 500
    assert response.json()["detail"] == {"code": "inference_failed", "message": "transcription failed"}
