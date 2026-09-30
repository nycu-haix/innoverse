"""ASR backend boundary. The HTTP layer depends only on this protocol."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class TranscribeOptions:
    hotwords: list[str] = field(default_factory=list)
    #: Model-specific language name (e.g. "中文"), or None for automatic detection.
    language: str | None = None
    itn: bool = True


@dataclass(frozen=True)
class RawTranscription:
    """Model output before Traditional Chinese normalization."""

    text: str
    language: str | None = None


class AsrBackend(Protocol):
    """A loaded, GPU-resident speech recognition model.

    Implementations must be loaded exactly once (`load`) and must not reload the model
    per request. `transcribe` is synchronous and is called from a worker thread under
    the service's concurrency limit.
    """

    name: str
    model_id: str
    device: str

    def load(self) -> None: ...

    def warmup(self) -> None: ...

    def transcribe(self, wav_path: Path, options: TranscribeOptions) -> RawTranscription: ...
