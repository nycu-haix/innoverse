# 筆錄輔助

詐欺案件被害人調查筆錄的即時輔助系統。員警與被害人對話時，系統即時轉錄、整理案情、找出後續偵查需要但還沒問到的資訊，並附上追問理由；詢問結束後產生問答格式的筆錄草稿，直接在線上編輯。

核心概念是「從後續偵查需求反推筆錄階段應取得的資訊」：

```text
詐騙類型 × 交付方式 → 應取得資訊 → 建議追問 → 對應偵查行動
```

AI 只負責整理與提醒，筆錄內容與是否追問由員警決定。

> 原本的「Voice Artifact」（語音轉簡報／文件）保留在 `voice-to-artifact` branch。這個系統沿用它的技術棧：Fun-ASR 語音辨識、Codex app-server、Fastify、React、Milkdown。

---

## 畫面

### 詢問中

- **案情區塊**依案件內容動態產生：初次接觸、建立信任、詐騙話術、要求付款、每一筆交付（交付 #1、#2…，各自標明轉帳／面交／虛擬貨幣）、發現受騙、後續聯絡、二次詐騙，以及跨區塊的損害合計。沒提到的事件不會出現。
- 區塊狀態：**已取得**、**待確認**、**尚未提及**。左側案情流程顯示同樣的狀態與每個區塊還缺幾項。
- 每一句整理結果左側是**來源欄**：原話時間、說話者、引用句數，顏色越深代表越新。滑過預覽原話，點擊釘選並在右側逐字稿標示。
- 句子可以直接點擊修改。修改後標示「已修改」，滑過可看與 AI 原整理的差異，並可還原。修改會保留到之後每一次 AI 整理。
- 時間、金額、帳號／ID、地點以顏色標記。帳號、電話、ID、錢包地址、交易金額另外標示「核對：轉帳紀錄」等，提醒以被害人手機畫面或單據人工確認。
- **追問建議**緊接在所屬區塊下方。全案優先順序最高的三項展開顯示（建議追問、為什麼要問、偵查用途、判斷依據），其餘收合。員警可標為「已問」或「略過」；已問的項目在被害人回答後由下一輪整理轉為案情。
- **矛盾提示**（例如總損失與各筆加總不符）與**應優先調閱**（依時效排序，監視器等有保存期限的標為優先）列在彙整區。

### 筆錄

按「產生筆錄」依逐字稿與案情產生問答格式的調查筆錄草稿（詢問時間以民國紀年），在 A4 頁面上以 Milkdown 直接編輯，自動儲存。可重新產生（會先確認）、列印。頂列的數字是尚未取得的「必要」資訊數量。

### 逐字稿

- 單一麥克風持續收音，瀏覽器在停頓處切句，每句上傳後由 ASR 辨識。
- 說話者標籤點一下即可在員警／被害人之間切換；人工更正的標籤不會再被 AI 覆蓋。
- 每一句保留原始錄音，可以播放核對。

---

## 運作方式

```text
Browser
  getUserMedia → AudioWorklet → 能量式 VAD 切句 → 16 kHz WAV
        │ 每句一個請求（依序上傳）
        ▼
Fastify
  POST /api/cases/:id/utterances
        │
        ├─▶ ASR service（Fun-ASR-Nano-2512 + FSMN VAD + OpenCC s2tw）→ 一行逐字稿
        │     音檔存到 AUDIO_DIR，逐字稿與時間存 SQLite
        │
        └─▶ 停頓 1.5 秒後排入案情整理（每個案件同時只跑一輪）
              Codex app-server：知識庫 + 目前案情 + 完整逐字稿
              → structured output（只回傳有變動的區塊）
              → Zod 驗證 → 合併 → SQLite
Browser 每 1.2 秒查詢案件版本號，有變動才重新載入。
```

### 案情整理（`apps/server/src/ai/`）

- 每一輪都開新的 Codex thread，輸入完整逐字稿與目前案情（已套用員警的修改與已問／略過）。逐字稿與案情包在 `<transcript>`、`<current_state>` 裡，視為不可信的來源資料。
- 模型只回傳新增或有變動的區塊，未回傳的區塊保留，刪除必須明列在 `removedBlockIds`。區塊順序由伺服器依事件類型決定。這讓每一輪的輸出量與最新幾句的變動成正比。
- 說話者：上傳時先以問句規則猜測（標為暫定），整理時由模型依內容與問答節奏判斷；員警手動更正的永遠優先。
- 所有 id 與來源行號都會再檢查：引用不存在的行會被移除，重複的 id 會加上後綴。

### 知識庫（`packages/shared/src/knowledge.ts`）

依情境整理「應取得資訊｜等級｜建議問法｜偵查用途｜核對依據」：所有詐欺案件通用、通訊聯絡、銀行轉帳、面交現金、虛擬貨幣、遊戲點數／超商代碼、寄交提款卡，以及假投資、假冒公務機關、網路購物、假交友。模型提出的追問必須對應知識庫項目，追問 id 就是知識庫項目 id。

目前內容是開發用草稿，**須經合作刑警逐項檢視**後才能作為實務依據。

### 速度

整理在每次停頓後執行，模型速度直接影響即時性。用 17 句的模擬詢問實測（每 8 秒一句）：

| 模型（思考強度 low） | 每輪耗時  |
| -------------------- | --------- |
| gpt-6-luna           | 6–46 秒   |
| gpt-6.1-sol          | 28–134 秒 |

因此 `.env.example` 預設 `DEFAULT_MODEL=gpt-6-luna`。介面右上「設定」可以改模型與思考強度；整理在伺服器端執行，選擇也存在伺服器。

---

## 與研究規劃的差異

| 規劃 | 目前實作 |
| --- | --- |
| 地端大型語言模型，不傳送外部 AI 服務 | 使用 Codex（OpenAI）。**逐字稿會傳到雲端**；原型只能使用虛構案例。要改回地端模型，替換 `apps/server/src/ai/analysis.ts` 的 `TurnRunner` 即可，prompt 與 schema 不變。 |
| pyannote 說話者分離、事先錄員警聲紋 | 尚未實作。目前以內容判斷說話者，加上人工一鍵更正。 |
| FireRedASR2 | 沿用 Fun-ASR-Nano-2512（provider 介面不變，可新增 backend 比較）。 |
| OCR／視覺模型分析收據與截圖 | 尚未實作。 |
| DOCX 輸出、簽名前檢查 | 改為線上編輯的筆錄草稿（Milkdown），可列印；未取得的必要資訊數量顯示在「筆錄」分頁。 |

---

## 隱私與資料

- 原始錄音只送到自建的 ASR 服務；每一句的 WAV 保存在 `AUDIO_DIR`，供回放核對。
- 逐字稿與案情整理結果會送到 Codex。**不得輸入真實案件資料。**
- SQLite 保存案件、逐字稿、案情整理、員警的修改與追問狀態、筆錄草稿、模型設定與辨識詞彙。
- Codex 登入憑證只在 `CODEX_HOME`，不會進 SQLite 或瀏覽器。
- Log 只記錄案件 id、行號、耗時、數量與錯誤類別，不記錄逐字稿或案情內容。
- 系統沒有使用者帳號，**不是存取控制**。部署時請在前面加上 VPN、SSO proxy 或 basic auth。

---

## Monorepo

```text
apps/web/            React 19 / Vite / Milkdown / Lucide
apps/server/         Fastify 5 / SQLite / Codex app-server bridge
packages/shared/     Zod schemas、案情結構、知識庫
services/asr/        FastAPI / FunASR / Fun-ASR-Nano-2512
```

### API

| Method       | Path                                      | 說明                                                      |
| ------------ | ----------------------------------------- | --------------------------------------------------------- |
| `GET` `POST` | `/api/cases`                              | 案件列表／新增案件                                        |
| `GET`        | `/api/cases/:id`                          | 完整案件（逐字稿、案情、筆錄、處理狀態）                  |
| `GET`        | `/api/cases/:id/version`                  | 版本號，供輪詢                                            |
| `POST`       | `/api/cases/:id/utterances`               | 一句錄音（multipart：`startedAt`、`durationMs`、`audio`） |
| `GET`        | `/api/cases/:id/utterances/:line/audio`   | 該句原始錄音                                              |
| `PUT`        | `/api/cases/:id/utterances/:line/speaker` | 更正說話者                                                |
| `PUT`        | `/api/cases/:id/facts/:factId`            | 修改整理內容（`text: null` 還原）                         |
| `PUT`        | `/api/cases/:id/gaps/:gapId`              | 追問狀態：`open`／`asked`／`skipped`                      |
| `POST`       | `/api/cases/:id/analyze`                  | 立即重新整理                                              |
| `POST`       | `/api/cases/:id/record/generate`          | 產生筆錄草稿                                              |
| `PUT`        | `/api/cases/:id/record`                   | 儲存筆錄（revision 不符回 409）                           |
| `GET` `PUT`  | `/api/settings`                           | 模型、思考強度、辨識詞彙                                  |

---

## 開發

需求：Node.js ≥ 22.12、pnpm 12、Codex CLI（`npm i -g @openai/codex`）。ASR 需要 NVIDIA GPU 與 NVIDIA Container Toolkit。

```bash
pnpm install

# Terminal 1：在 GPU 主機上啟動 ASR，開在 127.0.0.1:8000（第一次會下載模型）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build asr

# Terminal 2：Vite（http://localhost:5173）+ Fastify（:3000）
ASR_URL=http://127.0.0.1:8000 DEFAULT_MODEL=gpt-6-luna pnpm dev
```

本機資料預設在 `apps/server/data/`（`interview.db`、`audio/`）；沒設定 `CODEX_HOME` 時使用 `~/.codex`。

| 指令                                | 作用                                                           |
| ----------------------------------- | -------------------------------------------------------------- |
| `pnpm format` / `pnpm format:check` | Prettier                                                       |
| `pnpm lint`                         | ESLint                                                         |
| `pnpm typecheck`                    | strict TypeScript                                              |
| `pnpm test`                         | Vitest（server 以假的 Codex app-server 與假 ASR 測試完整 API） |
| `pnpm build`                        | 建置 web 與 server                                             |
| `pnpm check`                        | 以上全部                                                       |

ASR 服務：`cd services/asr && pip install -e ".[dev]" && ruff check . && pytest`（推理會被 mock，不需要 GPU）。

---

## 部署

```bash
cp .env.example .env
docker compose up -d --build      # http://localhost:8080
```

- **`app`**：Fastify、建置好的前端、SQLite、Codex CLI。Volumes：`app-data`（`/data/app`：資料庫與錄音）、`codex-data`（`/data/codex`）。
- **`asr`**：Fun-ASR-Nano-2512（CUDA），只在 Docker 內部網路。Volume：`asr-model-cache`。

瀏覽器只允許在 HTTPS（或 `localhost`）使用麥克風。Dokploy 須用 **Compose** 部署，網域綁 `app` 的 port `3000`。第一次開啟時以 ChatGPT device code 登入 Codex。

### 主要環境變數

| 變數                    | 預設                     | 說明                                     |
| ----------------------- | ------------------------ | ---------------------------------------- |
| `DEFAULT_MODEL`         | Codex 預設               | 尚未在介面選擇時使用的模型               |
| `ANALYSIS_DEBOUNCE_MS`  | `1500`                   | 最後一句之後多久開始整理                 |
| `MAX_UTTERANCE_SECONDS` | `30`                     | 連續說話超過此長度就切句                 |
| `AUDIO_DIR`             | `/data/app/audio`        | 每句原始錄音                             |
| `DATABASE_PATH`         | `/data/app/interview.db` | SQLite                                   |
| `HOTWORDS`              |                          | 全組織辨識詞彙（逗號分隔），介面另可補充 |
| `ASR_URL`               | `http://asr:8000`        | ASR 服務                                 |
| `CODEX_HOME`            | `/data/codex`            | Codex 登入與設定                         |

完整清單見 `.env.example` 與 `apps/server/src/config.ts`。
