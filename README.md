# Innoverse

Voice-to-artifact communication tool. Press **Record**, speak naturally (Taiwan Mandarin, mixed with English terms, numbers, names, medicine names…), press **Record** again, and the workspace becomes either:

- **Presentation** — exactly one 16:9 slide designed to be understood at a glance, or
- **Document** — one editable Markdown document on an A4 page.

With **Continue** on, the next recording edits the current artifact instead of starting over. There is no chat, no transcript view, no prompt box: the artifact is the product.

Factual fidelity is the first priority. The prompts forbid inventing or silently changing numbers, doses, dates, times, names, addresses, quotations, decisions or action items. Uncertainty is kept, and ambiguity that changes the meaning shows up as short warnings.

## Architecture

```
Browser (React, MediaRecorder)
   │  multipart: metadata + audio          ← NDJSON stream: stage events, final artifact
   ▼
Fastify (apps/server) ──► ASR service (services/asr, FastAPI, GPU)
   │                         ffmpeg → 16 kHz mono PCM → FSMN VAD → Fun-ASR-Nano-2512 (+hotwords) → OpenCC
   │  transcript
   ▼
Codex app-server (one persistent `codex app-server --listen stdio://` child, JSON-RPC)
   │  structured output (outputSchema)
   ▼
Zod validation → slide HTML sanitizer → optimistic revision check → SQLite → browser renderer
```

- **Progress** uses one long `POST /api/generate` request. Pre-checks fail fast as JSON errors with a real HTTP status (auth, ASR readiness, model/effort, stale revision, bad audio). After that the response is already `200` and streams NDJSON events, so errors that happen mid-generation arrive as an `error` event: `stage: transcribing`, `stage: generating`, then `result` or `error`. The browser shows 上傳中… / 語音辨識中… / 整理內容中…. Only a complete, validated artifact is ever sent.
- **Codex** runs as one resident app-server process, never `codex exec` per request. The client in `apps/server/src/codex/app-server-client.ts` correlates request ids, dispatches notifications, declines approval requests, rejects pending calls when the process crashes, and restarts it with bounded exponential backoff. Threads use `sandbox: read-only`, `approvalPolicy: never`, network off, and an empty working directory.
- **Continue OFF** starts a fresh Codex thread with no previous artifact. The old artifact stays on screen until the new one is saved.
- **Continue ON** resumes the artifact's thread (`thread/resume`, falling back to a new thread if that fails). It **always** sends the latest saved artifact, which may include manual edits, inside `<current_artifact>`.
- **Revisions**: every artifact has a revision. Writes happen only when the stored revision still equals the client's base revision. Pending manual edits are flushed before a recording is submitted. A generation that finishes after a newer edit is rejected (`內容已在其他地方更新，請再試一次。`).

## Repository structure

| Path | Purpose |
| --- | --- |
| `apps/web` | React 19 + Vite + Tailwind v4 frontend: workspace, floating toolbar, slide renderer, Milkdown editor, auth screen |
| `apps/server` | Fastify 5 backend: API, Codex app-server client, prompts, slide sanitizer, SQLite, ASR client |
| `packages/shared` | Zod schemas and inferred types shared by web and server: API payloads, artifacts, AI output, models, errors, and the slide tag/class allowlist |
| `services/asr` | Python FastAPI GPU ASR service (FunASR / Fun-ASR-Nano-2512, ffmpeg, OpenCC) |
| `.github/workflows/ci.yml` | CI validation |
| `Dockerfile`, `services/asr/Dockerfile`, `docker-compose.yml` | Production images and stack |

Key files:

- `packages/shared/src/slide-policy.ts` is the single, auditable allowlist of generated-slide tags and Tailwind classes. The server sanitizer, the browser DOMPurify policy, the prompt and the Tailwind build all use it.
- `apps/server/src/ai/prompts/` holds the `global`, `presentation`, `document` and `continuation` prompts, plus `compose.ts`, which assembles them with explicit `<transcript>` / `<current_artifact>` boundaries.
- `apps/server/src/generation/generation-service.ts` runs the pipeline and logs its timings.

## Requirements

- Node.js ≥ 22.12 (CI and Docker use Node 24) and pnpm 12 (`corepack enable pnpm` or `npm i -g pnpm@12`)
- Codex CLI (`npm i -g @openai/codex`) for local development; the app image bundles it
- Docker with Compose v2
- For ASR: an NVIDIA GPU (tuned for an H200 with ~35 GB usable VRAM), a recent NVIDIA driver, and the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- Python 3.12 only if you run the ASR service or its tests outside Docker

## Development

```sh
pnpm install

# Terminal 1 — ASR on the GPU host, published on 127.0.0.1:8000 by the dev override
# (the first start downloads the model into the cache volume)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build asr

# Terminal 2 — Vite (http://localhost:5173) + Fastify (http://localhost:3000, /api proxied by Vite)
ASR_URL=http://127.0.0.1:8000 pnpm dev
```

Without a GPU you can still develop the UI: the app starts, shows the Codex login, and reports ASR as unavailable in `/api/health`.

Running the ASR service natively (Linux + CUDA, or `ASR_DEVICE=cpu` for slow CPU inference):

```sh
cd services/asr
python3.12 -m venv .venv && . .venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cu128 torch==2.11.0 torchaudio==2.11.0
pip install -e ".[gpu,dev]"
uvicorn app.main:app_factory --factory --port 8000
```

Full stack:

```sh
cp .env.example .env
docker compose up --build        # http://localhost:8080
```

Dev server settings come from environment variables (see `apps/server/src/config.ts`). Local defaults keep data in `apps/server/data/app.db` and use your normal `~/.codex` unless `CODEX_HOME` is set.

## Formatting

Formatting uses the repository's existing Prettier configuration (`.prettierrc`: tabs, 200 columns, organize-imports and packagejson plugins) and `.editorconfig`. No other JS/TS formatter is used.

```sh
pnpm format          # prettier --write .
pnpm format:check    # prettier --check .
```

Python uses Ruff (`ruff format`, `ruff check`), configured in `services/asr/pyproject.toml`.

## Linting, type checking and tests

```sh
pnpm lint            # ESLint flat config (typescript-eslint, react-hooks) — correctness only, formatting left to Prettier
pnpm lint:fix
pnpm typecheck       # tsc --noEmit for shared, server, web (strict)
pnpm test            # Vitest in every package (alias: pnpm test:unit)
pnpm build           # vite build + slide-class safelist check, server bundle (tsup)
pnpm check           # format:check → lint → typecheck → test → build

cd services/asr
pip install -e ".[dev]"   # no torch/funasr needed; inference is mocked
ruff check . && ruff format --check .
pytest
```

What is covered: output schemas; server and browser slide sanitation (allowed and forbidden tags, attribute stripping, class allowlist, arbitrary Tailwind rejection); model and reasoning-effort validation; optimistic revision conflicts; Continue off (fresh thread) versus Continue on (resume, plus the manually edited artifact in the prompt); JSON-RPC correlation; crash handling and restart backoff; the generation pipeline via Fastify `inject`; MediaRecorder start, stop, cancel and auto-stop; cancel making zero network requests; ASR config, OpenCC, hotwords, audio helpers, temp-file cleanup and bounded concurrency.

## CI

`.github/workflows/ci.yml` runs on every push and pull request with least-privilege permissions and cancels superseded runs:

- **node** — `pnpm install --frozen-lockfile`, format check, lint, typecheck, tests, production build (including the slide safelist verification)
- **python** — Ruff lint and format check, an import check of the API and provider modules without GPU packages, and pytest with ffmpeg (inference mocked)
- **docker** — `docker compose config`, `docker build --check` for the ASR Dockerfile, a full app image build, and a container smoke test (health, SPA, clean SIGTERM exit)

CI never needs a GPU. The multi-GB CUDA ASR image is linted, not built. CI never deploys.

## ASR

- **Default model**: [`FunAudioLLM/Fun-ASR-Nano-2512`](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512), loaded through FunASR 1.4's native `FunASRNano` model class with FSMN VAD segmentation. It is loaded once at startup (plus a warmup inference) and stays resident on the GPU. `/health` reports ready only after a successful load.
- **Pipeline**: private temp dir → ffmpeg to 16 kHz mono PCM WAV (capped at `MAX_AUDIO_MINUTES`) → VAD → Fun-ASR-Nano with hotwords and language → OpenCC → response. Temp files are removed in `finally` blocks, raw audio is never stored, and transcripts are never logged.
- **Concurrency**: one process, one model, `ASR_MAX_CONCURRENCY` (default 2) concurrent inferences through an asyncio semaphore, plus a bounded wait queue (`ASR_MAX_QUEUE`). Excess requests get HTTP 503 instead of piling onto the GPU.
- **Traditional Chinese**: the default is `ASR_OPENCC_CONFIG=s2tw`. It converts script only, using Taiwan-standard glyphs (吃, 裡, 著, 為), and does **not** substitute vocabulary (軟件 stays 軟件, 鼠標 stays 鼠標). Plain `s2t` gives variants that look wrong in Taiwan (喫, 裏, 着, 爲). `s2twp` rewrites vocabulary and can alter technical or medical terms, names and addresses. Taiwan-style wording is left to artifact generation.
- **Language**: `ASR_LANGUAGE=zh|en|ja|auto`. `zh` tells the model to transcribe to Chinese. `auto` lets it decide, which can help with heavily mixed-language speech.
- **Switching model or provider**: the Node app only depends on the `AsrProvider` interface (`apps/server/src/asr/asr-client.ts`) and the HTTP contract `POST /v1/transcribe`. In the service, backends implement `AsrBackend` (`services/asr/app/providers/base.py`) and are registered in `providers/__init__.py`, selected by `ASR_PROVIDER` and `ASR_MODEL` (`ASR_MODEL_HUB=hf|ms`). SenseVoice or Paraformer can be added as a small FunASR `AutoModel` backend; faster-whisper / Whisper large-v3-turbo as a backend with its own dependency. Nothing else changes.

### Hotwords

Domain terms (medicine names, doctors, departments, hospitals, addresses, company vocabulary) improve recognition. They are configurable, never hardcoded:

- organization-wide: `HOTWORDS="克拉黴素,阿莫西林,Acetaminophen"` or `HOTWORDS_FILE=/path/terms.txt` (one per line, `#` for comments)
- per workspace: 模型與設定 → 辨識詞彙 (one per line), stored with the workspace

The server merges and deduplicates both lists and sends them as `hotwords` (a JSON array). The service strips separators and brackets, caps the list, and passes it to Fun-ASR-Nano's `generate(hotwords=[...])`, which renders the terms into the model's context prompt.

### Evaluating ASR later

Plain CER is not enough for this product. A future benchmark (same HTTP contract, swap `ASR_PROVIDER` / `ASR_MODEL`) should measure:

- Character Error Rate (CER)
- Number Error Rate: digits, quantities, doses, dates, times
- Named Entity Error Rate: people, places, organizations, addresses
- Medical / domain term error rate, with and without hotwords
- Realtime factor and end-to-end latency (the service logs `rtf`, inference and processing time)

## Codex authentication

Codex credentials live only in `CODEX_HOME` (`/data/codex`, the `codex-data` volume). They are never stored in SQLite and never sent to the browser. The browser only sees authenticated yes/no plus the account email and plan.

First-time login (device code):

1. Open the app. If `account/read` reports no account, it shows **登入 ChatGPT**.
2. Click **使用 ChatGPT 帳號登入**. The server calls `account/login/start` with `{ "type": "chatgptDeviceCode" }`.
3. The page shows a **開啟驗證頁面** button (`verificationUrl`) and the one-time **code** with a copy button.
4. Open the verification page, sign in to ChatGPT, and enter the code **there**. It is not pasted back into this app.
5. The server receives `account/login/completed`. The page polls status and enters the workspace automatically. **取消** calls `account/login/cancel`.

Log out from the subtle settings popover (滑桿 icon → 登出), which calls `account/logout`.

## Models

The model list is never hardcoded. The server calls `model/list`, caches it briefly, hides `hidden` models, and exposes id, displayName, supported reasoning efforts, default effort and `isDefault`. The default model is the one marked `isDefault`. The default reasoning effort is `none` when supported, otherwise the cheapest available (latency first). The server re-validates every model and effort against the live catalog.

## Docker Compose

```sh
cp .env.example .env               # adjust if needed; no secrets required
docker compose up --build -d
docker compose logs -f asr         # first start downloads Fun-ASR-Nano into asr-model-cache
open http://localhost:8080
```

- `app`: compiled React app, Fastify, and Codex CLI. It is the only service with a host port: `127.0.0.1:8080` by default (`APP_BIND`, `APP_PORT`). The container itself still listens on 3000. Volumes: `app-data` (`/data/app`, SQLite) and `codex-data` (`/data/codex`).
- `asr`: Python, CUDA PyTorch, FunASR, ffmpeg and OpenCC on the NVIDIA GPU (`deploy.resources.reservations.devices`, `NVIDIA_VISIBLE_DEVICES`). Volume: `asr-model-cache` (`/models`). It is internal only.
- Both services define health checks. The ASR check allows a long start period for the first model download. Services handle SIGTERM for graceful shutdown.

## Dokploy

The stack is **two services** (`app` + `asr`), so deploy it as a Compose service. A Dokploy **Application** with build type **Dockerfile** only builds the root `Dockerfile`, which is the `app` service alone: there is no ASR, and every recording fails with `語音辨識服務目前無法使用。` (`/api/health` shows `asr.reachable: false`).

1. In the project, choose **Create Service → Compose** (type **Docker Compose**), point it at this repository, and set the compose path to `./docker-compose.yml`. If you already created an Application from the root `Dockerfile`, delete it, or at least remove its domain, so two app containers don't compete for the same domain.
2. Make sure the server has the NVIDIA driver and the NVIDIA Container Toolkit (`nvidia-ctk runtime configure --runtime=docker && systemctl restart docker`), and that `docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi` works.
3. Set environment variables in **Environment**, using `.env.example` as reference. Keep `TRUST_PROXY=true` behind Traefik.
4. Under **Domains**, attach your domain to service `app`, port `3000`. Use HTTPS: browsers only allow microphone access on secure origins. Domain traffic goes through Traefik on the Docker network, so the loopback `ports:` mapping is only for local access and never conflicts with the Dokploy panel on `:3000`.
5. Deploy. Named volumes (`app-data`, `codex-data`, `asr-model-cache`) persist across redeploys. Don't rename them or remove them between deployments, or you'll lose the SQLite data, the Codex login and the model cache.
6. Open the domain and complete the device login once.

## Data flow and privacy

- Audio transcription runs on **our own ASR server**. Recordings never go to a cloud ASR service.
- The **transcribed text** (and, for Continue, the current artifact) is then sent through **Codex / OpenAI** to generate the artifact. The UI says so in the settings popover: 「語音辨識在本機伺服器執行。辨識後的文字會傳送至設定的 AI 服務產生內容。」
- **Raw recordings are not persisted.** They exist only in private temp directories during a request and are always deleted.
- SQLite stores workspaces, artifacts (content, revision, Codex thread id, warnings), hotwords and generation metadata (ids, timings, status). Transcripts are stored only if you set `PERSIST_TRANSCRIPTS=true`.
- Codex keeps its own thread history under `CODEX_HOME`; that is what makes `thread/resume` work across restarts. Treat the `codex-data` volume as sensitive.
- Production logs contain ids, stages, timings and error codes, never audio, transcripts, artifact content or tokens. `LOG_TEXT_PREVIEWS=true` adds short previews in development only.
- Workspace identity is a random UUID in `localStorage`. It is not authentication, so anyone who can reach the app can use it. Put it behind your own access control (VPN, SSO proxy or basic auth at the reverse proxy) when handling sensitive data.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| GPU not detected | `docker compose exec asr python -c "import torch; print(torch.cuda.is_available())"`. Install the NVIDIA Container Toolkit, restart Docker, check `NVIDIA_VISIBLE_DEVICES`. |
| ASR model failed to load | `docker compose logs asr`. `/health` shows `status: error`. Check disk space in `asr-model-cache` and network access to Hugging Face (or set `ASR_MODEL_HUB=ms`; set `HF_TOKEN` if rate-limited). |
| `語音辨識服務目前無法使用。` | `ASR_URL` is wrong, or the model is still loading. `/api/health` → `asr.modelLoaded`. |
| Codex not logged in / `AI 服務需要重新登入。` | Complete the device login. Make sure `codex-data` is mounted at `CODEX_HOME` and writable by uid 1000 (`node`). |
| Device login fails | The server needs outbound HTTPS to `auth.openai.com`. Retry. Device-code login must be allowed for your ChatGPT workspace. |
| Model list empty | `/api/models` needs an authenticated account. Check `docker compose logs app` for `model/list` errors, and that the Codex CLI version supports `model/list` (bump `CODEX_VERSION`). |
| Microphone permission issues | The page must be served over HTTPS (or `localhost`). Check browser site permissions. Safari records `audio/mp4`, which is supported. |
| ffmpeg issues (`不支援這種錄音格式。`) | The ASR image installs ffmpeg. Natively, install ffmpeg and make sure it is on `PATH` (or set `FFMPEG_BIN`). |
| SQLite permissions | `DATABASE_PATH`'s directory must be writable by the app user (uid 1000). With bind mounts, `chown 1000:1000` the host directory. |
| Dokploy volume issues | Use the named volumes from the compose file. Bind mounts need correct ownership (app uid 1000, asr uid 10001). |
| `內容已在其他地方更新，請再試一次。` | The same workspace was edited in another tab. The page reloaded the latest version; record again. |

## License

[WTFPL](LICENSE).
