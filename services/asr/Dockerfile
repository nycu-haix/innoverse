# syntax=docker/dockerfile:1.7
# GPU ASR image: Python + CUDA-enabled PyTorch + FunASR (Fun-ASR-Nano-2512) + ffmpeg + OpenCC.
# CUDA runtime libraries ship inside the PyTorch cu128 wheels; the host needs only the
# NVIDIA driver and the NVIDIA Container Toolkit.
ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim-bookworm AS build
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /srv
RUN pip install --index-url ${TORCH_INDEX_URL} torch==2.11.0 torchaudio==2.11.0
COPY pyproject.toml ./
COPY app ./app
RUN pip install ".[gpu]"

FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH \
	PYTHONUNBUFFERED=1 \
	PYTHONDONTWRITEBYTECODE=1 \
	HF_HOME=/models/huggingface \
	MODELSCOPE_CACHE=/models/modelscope \
	TORCH_HOME=/models/torch
WORKDIR /srv
COPY app ./app
RUN useradd --create-home --uid 10001 asr && mkdir -p /models && chown -R asr:asr /models
USER asr
EXPOSE 8000
# The first start downloads the model into the cache volume; allow a long start period.
HEALTHCHECK --interval=30s --timeout=5s --start-period=1200s --retries=3 \
	CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]
# Exactly one worker: the model is loaded once per process and must stay resident.
CMD ["uvicorn", "app.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-graceful-shutdown", "30"]
