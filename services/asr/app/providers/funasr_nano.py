"""FunAudioLLM Fun-ASR-Nano-2512 via FunASR's AutoModel (production default)."""

from __future__ import annotations

import logging
import struct
import tempfile
import wave
from pathlib import Path
from typing import Any

from .base import RawTranscription, TranscribeOptions

logger = logging.getLogger("asr.funasr")


class FunAsrNanoBackend:
    """Fun-ASR-Nano with FSMN VAD segmentation and prompt-based hotwords.

    FunASR >= 1.4 registers the `FunASRNano` model class natively, so the model is
    loaded straight from the hub id without remote code. Hotwords and the target
    language are passed to `generate()`, which renders them into the model prompt.
    """

    name = "funasr"

    def __init__(self, model_id: str, device: str, hub: str, vad_model: str | None, vad_max_segment_ms: int) -> None:
        self.model_id = model_id
        self.device = device
        self._hub = hub
        self._vad_model = vad_model
        self._vad_max_segment_ms = vad_max_segment_ms
        self._model: Any = None

    def load(self) -> None:
        if self._model is not None:
            return
        from funasr import AutoModel  # heavy import: only in the GPU runtime

        kwargs: dict[str, Any] = {
            "model": self.model_id,
            "hub": self._hub,
            "device": self.device,
            "disable_update": True,
        }
        if self._vad_model:
            kwargs["vad_model"] = self._vad_model
            kwargs["vad_kwargs"] = {"max_single_segment_time": self._vad_max_segment_ms}
        logger.info("loading model", extra={"model": self.model_id, "device": self.device, "hub": self._hub})
        self._model = AutoModel(**kwargs)

    def warmup(self) -> None:
        """Run one tiny inference so CUDA kernels are initialized before readiness."""
        with tempfile.TemporaryDirectory(prefix="asr-warmup-") as directory:
            path = Path(directory) / "silence.wav"
            with wave.open(str(path), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(16_000)
                handle.writeframes(struct.pack("<h", 0) * 8_000)
            try:
                self.transcribe(path, TranscribeOptions())
            except Exception:  # warmup on pure silence may legitimately yield nothing
                logger.debug("warmup inference raised", exc_info=True)

    def transcribe(self, wav_path: Path, options: TranscribeOptions) -> RawTranscription:
        if self._model is None:
            raise RuntimeError("model not loaded")
        kwargs: dict[str, Any] = {"input": [str(wav_path)], "cache": {}, "batch_size": 1, "itn": options.itn}
        if options.hotwords:
            kwargs["hotwords"] = options.hotwords
        if options.language:
            kwargs["language"] = options.language
        results = self._model.generate(**kwargs)
        texts = [str(item.get("text", "")) for item in results or [] if isinstance(item, dict)]
        return RawTranscription(text="".join(texts).strip(), language=options.language)
