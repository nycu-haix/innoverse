"""FastAPI entrypoint. Internal service: never expose it publicly."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .audio import AudioError, temporary_workdir, validate_content_type
from .config import Settings, load_settings
from .hotwords import HotwordError, parse_hotwords_field
from .providers import AsrBackend, create_backend
from .schemas import HealthResponse, TranscriptionResponse
from .service import BusyError, NotReadyError, TranscriptionService
from .text import Converter, create_converter

logger = logging.getLogger("asr")

COPY_CHUNK = 1024 * 1024

AUDIO_ERROR_STATUS = {
    "unsupported_audio": 415,
    "invalid_audio": 422,
    "empty_audio": 400,
    "too_long": 413,
    "invalid_language": 400,
    "ffmpeg_missing": 500,
}


def error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def create_app(
    settings: Settings | None = None,
    backend_factory: Callable[[Settings], AsrBackend] = create_backend,
    converter_factory: Callable[[str], Converter] = create_converter,
) -> FastAPI:
    settings = settings or load_settings(os.environ)
    logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s %(message)s")

    # OpenCC first: a broken converter should fail before spending minutes loading the model.
    service = TranscriptionService(settings, backend_factory(settings), converter_factory(settings.opencc_config))

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(service.startup)
        yield
        # The model is released with the process; nothing is persisted.

    app = FastAPI(
        title="Innoverse ASR", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None
    )
    app.state.service = service

    @app.get("/health/live")
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health", response_model=HealthResponse)
    async def health() -> JSONResponse:
        body = HealthResponse(
            status="ok" if service.ready else "loading" if service.load_error is None else "error",
            modelLoaded=service.ready,
            model=settings.model,
            provider=settings.provider,
            device=settings.device,
            maxConcurrency=settings.max_concurrency,
            error=service.load_error,
        )
        return JSONResponse(body.model_dump(), status_code=200 if service.ready else 503)

    @app.post("/v1/transcribe", response_model=TranscriptionResponse)
    async def transcribe(
        audio: Annotated[UploadFile, File()],
        hotwords: Annotated[str | None, Form()] = None,
        language: Annotated[str | None, Form()] = None,
    ) -> TranscriptionResponse:
        if not service.ready:
            raise error(503, "not_ready", "model is not loaded yet")
        try:
            validate_content_type(audio.content_type)
            terms = parse_hotwords_field(hotwords)
        except AudioError as exc:
            raise error(AUDIO_ERROR_STATUS.get(exc.code, 400), exc.code, exc.message) from exc
        except HotwordError as exc:
            raise error(400, "invalid_hotwords", str(exc)) from exc

        # Raw audio only lives in this private temp dir and is always removed.
        async with temporary_workdir() as workdir:
            source = workdir / "upload"
            size = 0
            with source.open("wb") as handle:
                while chunk := await audio.read(COPY_CHUNK):
                    size += len(chunk)
                    if size > settings.max_audio_bytes:
                        raise error(413, "too_large", "audio upload is too large")
                    handle.write(chunk)
            await audio.close()
            if size == 0:
                raise error(400, "empty_audio", "audio upload is empty")
            try:
                return await service.transcribe(source, workdir, terms, language)
            except AudioError as exc:
                raise error(AUDIO_ERROR_STATUS.get(exc.code, 400), exc.code, exc.message) from exc
            except NotReadyError as exc:
                raise error(503, "not_ready", "model is not loaded yet") from exc
            except BusyError as exc:
                raise error(503, "busy", "too many concurrent transcriptions") from exc
            except Exception as exc:
                # Never include audio or transcript content in logs.
                logger.exception("inference failed")
                raise error(500, "inference_failed", "transcription failed") from exc

    return app


def app_factory() -> FastAPI:
    """uvicorn entrypoint: `uvicorn app.main:app_factory --factory`."""
    return create_app()
