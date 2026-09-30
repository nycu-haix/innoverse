# Voice Artifact

> 把一段話，立即變成更容易理解、展示與保存的內容。

Voice Artifact 是一套以語音為主要輸入方式的即時溝通輔助工具。

使用者只需要按下錄音、說出想表達的內容，再按一次按鈕，系統就會自動完成：

**語音辨識 → 資訊整理 → 視覺化／文件化**

並產生一張簡潔的 16:9 簡報，或一份可以繼續編輯的 Markdown 文件。

它不是聊天機器人，也不是傳統簡報編輯器。沒有對話紀錄、沒有訊息泡泡、沒有 prompt 輸入框。

我們希望把 AI 藏在介面背後，讓使用者專注在最自然的溝通方式：

**直接說話。**

---

## ✨ 使用方式

整個介面只有一個工作區與底部浮動工具列：

```text
                 Artifact Workspace


   [ 簡報 | 文件 ]  ( ● 錄音 )  [ 接續 ]  [ 模型 ]  [ 列印 ]
```

1. 選擇 **簡報** 或 **文件**。
2. 按下錄音（第一次會詢問麥克風權限），自然地說話。
3. 再按一次錄音，音檔上傳並開始處理，畫面顯示 `上傳中…` → `語音辨識中…` → `整理內容中…`。
4. 產生完成後，新的內容取代工作區。失敗時原本的內容會保留。

錄音中可以按旁邊的 ✕ 取消：錄音直接丟棄，不會送出任何網路請求。錄音時間上限預設 60 分鐘，到達時自動停止並送出。

### 簡報模式

將口語內容轉換成一張可以立即理解的 16:9 視覺化頁面。

例如藥師說：

> 這顆抗生素一天三次、飯後吃，一次一顆，總共吃五天。即使症狀改善也不要自己停藥。

系統可能整理成：

```text
🌅 早餐後　💊 1 顆

🌞 午餐後　💊 1 顆

🌙 晚餐後　💊 1 顆

📅 共 5 天

🚫 不要自己停藥
```

實際畫面會再用受限的 Tailwind CSS 排版。設計原則：

- 少文字、大字
- 強烈的資訊階層
- Emoji / icon 輔助
- 一眼可以理解，幾公尺外也看得清楚
- 不加入原本沒有的資訊

適合醫療衛教、用藥說明、櫃台與服務場所、課堂解釋、工作交接、公共服務、現場指示。

### 文件模式

將語音整理成比較完整、可以繼續修改的文件，例如會議紀錄、訪談紀錄、工作筆記、交接文件、指示與 SOP、筆錄草稿、摘要。

文件以 Markdown 作為 canonical format，前端用 Milkdown（WYSIWYG）顯示在 A4 頁面上，所以 AI 產生之後仍然可以直接手動修改，修改會自動儲存。

會議內容只有在確實有人講出決議或待辦時，才會出現「決議」「待辦事項」。訪談與筆錄類內容會區分「某人表示」與已確認的事實，不會把指控或推測寫成事實。

### 🔁 接續（Continue）

開啟 **接續** 後，下一段錄音不會重新開始，而是修改畫面上現有的內容。

例如文件目前寫著：

```text
## 明日工作

- 完成首頁
- 部署測試環境
```

接著說：

> 再補一項，下午三點跟設計師開會。

系統會修改現有文件，而不是重新生成一份完全不同的內容；沒有被提到的部分保持原樣。

接續模式不只依賴 AI 的對話歷史。每次修改都會把**目前實際的 artifact**（資料庫裡最新存的版本）明確送給模型，因為使用者可能在上一輪生成後手動改過文件。

幾個細節：

- 簡報與文件各自有獨立的內容與 Codex thread。接續修改的是**按下錄音當下所在模式**的內容，不會拿另一個模式的內容來改。
- 關閉接續時，每次都開新的 Codex thread，不帶入舊內容；舊內容會一直顯示到新內容成功產生為止。
- 每份內容都有 revision。送出錄音前會先存好尚未儲存的手動修改；如果生成期間內容在別處被改過，舊的生成結果不會覆蓋新的修改。

### 列印

按列印按鈕，或直接用 Ctrl+P / Cmd+P，只會印出 artifact，不會印出工具列、狀態或背景。

- 簡報：印在直式 A4 上，投影片旋轉 90° 並保持原本的版面，一定剛好一頁。
- 文件：A4、合理邊界，跨頁由瀏覽器處理。

---

# 架構

```text
┌─────────────────────────────┐
│           Browser           │
│  MediaRecorder / Milkdown   │
└──────────────┬──────────────┘
               │ audio + metadata (multipart)
               ▼
┌─────────────────────────────┐
│       Fastify Backend       │
│  validation / workspace     │
│  SQLite / Codex bridge      │
└──────────────┬──────────────┘
               │ audio
               ▼
┌─────────────────────────────┐
│      Local ASR Service      │
│  ffmpeg → 16 kHz mono PCM   │
│  FSMN VAD                   │
│  Fun-ASR-Nano-2512 (GPU)    │
│  hotwords / OpenCC s2tw     │
└──────────────┬──────────────┘
               │ transcript
               ▼
┌─────────────────────────────┐
│      Codex app-server       │
│  transcript → artifact      │
│  structured output          │
└──────────────┬──────────────┘
               │ Zod validation → sanitizer → revision check → SQLite
        ┌──────┴──────┐
        ▼             ▼
  Presentation      Document
  restricted HTML   Markdown
```

核心原則：

**語音辨識自己跑，內容生成交給 AI。**

原始錄音不會傳送到雲端 AI 服務。

進度回報很單純：`POST /api/generate` 是一個長時間的請求。先做便宜的檢查（登入狀態、ASR 是否就緒、模型與思考強度、revision、音檔格式），失敗就直接回帶 HTTP 狀態碼的 JSON 錯誤。通過後回應改成 NDJSON 串流，依序送出 `transcribing`、`generating` 階段，最後是完整結果或錯誤事件。未完成的投影片 HTML 永遠不會送到瀏覽器。

---

# 🎙️ 語音辨識

## 為什麼不是直接用 Whisper？

Whisper 與 faster-whisper 都是非常成熟的通用 ASR 方案，也會保留作為 benchmark 與 fallback 的候選。

但這個專案的使用場景很明確：

> **以中文，尤其是台灣華語為主。**

而且每個錯字的代價不一樣。`一天三次` 被辨識成 `一天四次`，和少掉一個語助詞，風險完全不同。同樣的問題也出現在藥名、人名、地名、地址、日期、數量、單位與專有名詞。

因此 ASR 的選擇不只看一般的 Character Error Rate，而是特別重視中文、領域用語與 hotword adaptation。

## Fun-ASR-Nano-2512

預設模型：

```text
FunAudioLLM/Fun-ASR-Nano-2512
```

約 800M 參數的端到端 ASR 模型，支援中文、英文、日文。中文部分以大量真實語音資料訓練，並涵蓋多種中文方言與地域口音。

對本專案來說，比模型大小更重要的是：

- **中文優先**：主要 workload 本來就是中文，所以優先測試針對中文有大量資料與優化的 ASR，而不是以多語言泛化為首要目標的模型。
- **Hotwords**：推理時可以提供場域詞彙，讓專有名詞不必純靠猜測（見下方）。這對實際產品的影響，很可能大於 benchmark 上零點幾個百分點的 CER 差異。
- **常駐 GPU**：部署環境有足夠 VRAM（H200，約 35 GB 可用），沒必要為了縮小模型而犧牲辨識能力。模型在服務啟動時載入 GPU 並做一次 warmup，之後持續常駐，每次錄音都不會重新載入。

實測（H200，本專案的 ASR 服務，webm/opus 音檔）：9.5 秒的台灣華語約 1 秒辨識完成，模型約佔 2.7 GB VRAM。

服務以 FunASR 1.4 內建的 `FunASRNano` 載入，搭配 FSMN VAD 切段。同時進行的推理數量由 `ASR_MAX_CONCURRENCY`（預設 2）限制，另有有限長度的等待佇列；超出時回 503，不會讓大量請求同時壓在 GPU 上。

## Hotwords

Fun-ASR 的推理流程可以帶入 hotwords。醫療場所可以提供：

```text
克拉黴素
阿莫西林
Acetaminophen
Metformin
新竹馬偕紀念醫院
心臟內科
```

公司內部則可以提供產品名稱、客戶名稱、團隊名稱、技術名詞與專案代號。

詞彙可以在兩個層級設定，程式裡不 hardcode 任何領域用語：

- **全組織**：環境變數 `HOTWORDS="克拉黴素,阿莫西林,Acetaminophen"`，或 `HOTWORDS_FILE=/path/terms.txt`（一行一個，`#` 開頭為註解）。
- **每個工作區**：介面右下「模型與設定」→「辨識詞彙」，一行一個。

Server 會合併、去重後以 JSON 陣列送給 ASR 服務；ASR 服務會移除分隔符號與括號、限制數量，再傳入 Fun-ASR-Nano 的 `generate(hotwords=[...])`。

## 但我們不假設它一定最適合台灣華語

Fun-ASR 對許多中國地域口音與方言有特別支援，但這不能證明它在**台灣華語**上一定優於 Whisper。因此模型選擇刻意透過 provider abstraction 隔離：

```ts
interface AsrProvider {
	transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
```

- Node 端只依賴 `AsrProvider`（`apps/server/src/asr/asr-client.ts`）與 HTTP 介面 `POST /v1/transcribe`。
- ASR 服務內的模型實作 `AsrBackend`（`services/asr/app/providers/base.py`），在 `providers/__init__.py` 註冊，由 `ASR_PROVIDER` / `ASR_MODEL` / `ASR_MODEL_HUB`（`hf` 或 `ms`）選擇。
- 要比較 SenseVoice、Paraformer 或 Whisper large-v3-turbo，只要新增一個 backend，其餘程式不用改。

未來用相同的測試資料比較時，要看的指標是：

```text
Character Error Rate
Number Error Rate            數字、數量、劑量、日期、時間
Named Entity Error Rate      人名、地名、機構、地址
Domain Term Error Rate       有／無 hotwords
End-to-end Latency           ASR 服務會記錄 rtf、推理與處理時間
```

並建立真實的台灣場景測試集：台灣華語、中英夾雜、台語混用、長者說話、快速口語、遠場錄音、環境噪音，以及人名、地址、數字、日期、醫療用語。

最終的 production model 應該由真實 workload 的測試結果決定，而不是只看單一公開 benchmark。

## 🇹🇼 繁體中文

部分中文 ASR 模型會輸出簡體字形，所以 ASR 完成後會經過 OpenCC 做保守的簡轉繁。

預設設定是 `ASR_OPENCC_CONFIG=s2tw`：只處理字形，採用台灣標準字形，**不做**用語替換。

| 設定           | `饭后吃` | `里面` | `为什么` | `软件和鼠标` |
| -------------- | -------- | ------ | -------- | ------------ |
| `s2t`          | 飯後喫   | 裏面   | 爲什麼   | 軟件和鼠標   |
| `s2tw`（預設） | 飯後吃   | 裡面   | 為什麼   | 軟件和鼠標   |
| `s2twp`        | 飯後吃   | 裡面   | 為什麼   | 軟體和滑鼠   |

純 `s2t` 會產生在台灣看起來像錯字的字形（喫、裏、着、爲）；`s2twp` 則會把「中國用語 → 台灣用語」也一起換掉。

我們刻意不在 ASR 階段做用語在地化，因為 ASR 的工作是忠實記錄使用者說了什麼。人名、藥名、公司名稱、地址與專有名詞，不應該因為「在地化」被自行改寫。比較自然的台灣文字風格，留到後面的 artifact 生成階段處理。

`ASR_LANGUAGE` 可設 `zh`、`en`、`ja` 或 `auto`；中英夾雜很多時可以試 `auto`。

---

# 🧠 Artifact 生成

語音辨識完成後，文字交給 Codex 生成 artifact。

Backend 維持一個長時間存在的：

```bash
codex app-server --listen stdio://
```

而不是每個請求都重新啟動 Codex CLI（也不用 `codex exec`）。Server 與 Codex 之間透過 JSON-RPC over stdio 溝通（`apps/server/src/codex/app-server-client.ts`）：請求 ID 對應、通知分派、行程崩潰時拒絕所有等待中的請求，並以有上限的指數退避重新啟動。

這讓 server 可以維持 model catalog、conversation threads 與接續狀態，並避免每次請求都付出 process 初始化的延遲。

Codex thread 一律使用 `sandbox: read-only`、`approvalPolicy: never`、關閉網路，工作目錄是一個空資料夾。Codex 若要求任何執行權限都會被拒絕，也沒有任何通用的 JSON-RPC 轉發介面。

輸出使用 `turn/start` 的 `outputSchema` structured output，回來後再用 Zod 驗證一次。Prompt 放在 `apps/server/src/ai/prompts/`（`global`、`presentation`、`document`、`continuation`），逐字稿與目前內容分別包在 `<transcript>` 與 `<current_artifact>` 裡，視為不可信的來源資料，不能覆蓋系統規則與輸出格式。

## 模型選擇

模型選單不是 hardcode。Backend 透過 `model/list` 取得 Codex 的模型清單（短暫快取、隱藏 `hidden` 的模型）再傳給前端，所以 UI 依照每個模型實際支援的能力提供「模型」與「思考強度」。

產品的主要目標是即時性，所以：

> 預設模型用 `isDefault`；思考強度在支援時預設 `none`，否則用最便宜的選項。

使用者仍然可以切換到較高的思考強度。Server 會依照即時的模型清單再次驗證選擇。

## 模型可以回報疑慮

如果語音中有影響意思的不確定之處（例如「原始語音中的藥名可能辨識不清。」），模型會附上簡短的中文提醒，顯示在工具列上方，不會印出來，也不會包含模型的推理過程。

---

# 🎨 簡報渲染

AI 不會產生任意 React component，也不會執行 JavaScript。簡報模式只接受：

```text
restricted HTML + restricted Tailwind classes
```

例如：

```html
<div class="w-full h-full flex flex-col justify-center gap-12 p-16">
	<div class="text-6xl font-bold text-ctp-blue">🌅 早餐後　💊 1 顆</div>
	<div class="text-6xl font-bold text-ctp-blue">🌞 午餐後　💊 1 顆</div>
	<div class="text-6xl font-bold text-ctp-blue">🌙 晚餐後　💊 1 顆</div>
	<div class="text-5xl font-semibold text-ctp-red">🚫 不要自己停藥</div>
</div>
```

允許的 tag 與 Tailwind class 有固定的 allowlist，全部集中在 `packages/shared/src/slide-policy.ts`（約 130 個 class，可以直接審閱）。Server sanitizer、瀏覽器端 DOMPurify、prompt 與 Tailwind build 都用同一份清單；build 完會檢查每個允許的 class 都有被編進 production CSS。

不允許：

```text
<script>  <style>  iframe  SVG  圖片  連結  表單
event handlers  style 屬性
arbitrary Tailwind values（text-[73px]、bg-[#abcdef]）
positioning（absolute、fixed）、variants（hover:、md:）
generated JavaScript
```

AI 的輸出會經過：

```text
Structured Output
      ↓
Zod validation
      ↓
Server-side sanitizer（parse5 重建 DOM、只留 class、逐一比對 allowlist）
      ↓
Client-side DOMPurify（同樣嚴格的設定）
      ↓
Rendering
```

模型只能在我們提供的 design vocabulary 裡排版，拿不到完整的瀏覽器執行能力。

## 📐 Slide Auto Fit

每張簡報都有固定的 logical canvas：`1600 × 900`（16:9）。瀏覽器分兩層縮放：

```text
Content（內容縮放，僅在必要時）
   ↓
1600 × 900 Canvas
   ↓
Viewport Scale（ResizeObserver，等比例）
   ↓
Browser Window
```

Canvas 永遠維持 16:9、置中，並預留工具列的空間。

如果 AI 只產生很少的資訊，前端會量測內容範圍，適度放大（最多 1.4 倍）並重新置中；內容超出時則縮小到放得下。因此 `💊 每次 1 顆` 不會以很小的字孤零零出現在巨大畫布中央。內容縮放只在 HTML 改變時量一次，不會跟視窗縮放互相觸發。

---

# 📝 文件編輯

文件模式以 Markdown 作為 canonical representation，前端用 Milkdown 提供 WYSIWYG 編輯（標題、段落、項目符號與編號清單、表格、粗體斜體、引用）。

```text
語音生成 → AI 整理 → 手動修改 → 再次錄音 → AI 依照修改後的版本繼續編輯
```

手動修改會立即反映在畫面，並以 debounce 自動儲存；儲存使用 optimistic concurrency（revision 必須相符才寫入）。生成期間文件暫時唯讀。

這也是接續模式每次都重新附上 current artifact 的原因：AI 的對話歷史不應該被當成文件資料庫。

**畫面上現在真正存在的內容，才是 source of truth。**

---

# 🛡️ 事實忠實度

這套工具可能用在對資訊正確性要求很高的場景。Prompt 最核心的規則是：

> 可以重新組織資訊，但不能重新發明資訊。

模型不得自行新增或修改：數字、時間、日期、藥物劑量、人名、地址、單位、引述內容、決議、結論與待辦事項。

```text
原始：一天三次
```

不能因為排版或推理變成 `一天兩次`。

如果來源本身不確定：

```text
好像是禮拜三
```

也不應被整理成 `確定於星期三`。不確定性本身也是資訊的一部分。

---

# 🔒 隱私與資料流

資料流需要清楚區分兩件事。

**語音辨識**在我們自己的 ASR server 上執行：

```text
Raw audio → Self-hosted GPU → Transcript
```

原始錄音預設不保存：只存在請求期間的私有暫存目錄，處理完一定刪除（包含失敗時）。

**AI 生成**：

```text
Transcript（接續時加上目前內容）→ Codex / OpenAI → Artifact
```

也就是：**原始音訊留在自己的 ASR 基礎設施，但辨識後的文字會傳給 AI 服務生成內容。** 介面的設定面板也有這段說明：「語音辨識在本機伺服器執行。辨識後的文字會傳送至設定的 AI 服務產生內容。」在醫療、政府或其他敏感場景部署時，這個資料邊界必須納入資料治理考量。

其他資料：

- SQLite 保存 workspace、artifact（內容、revision、Codex thread id、提醒）、辨識詞彙，以及生成的 metadata（ID、耗時、狀態）。逐字稿只有在 `PERSIST_TRANSCRIPTS=true` 時才保存。
- Codex 的登入憑證只存在 `CODEX_HOME`（`codex-data` volume），不會進 SQLite，也不會送到瀏覽器；瀏覽器只知道是否已登入和帳號 email。
- Codex 會在 `CODEX_HOME` 保存 thread 歷史，這是重啟後還能 `thread/resume` 的原因。請把 `codex-data` volume 視為敏感資料。
- Production log 只記錄 generation ID、各階段耗時、狀態與錯誤類別，不記錄錄音、逐字稿、生成內容或 token。
- Workspace 只是瀏覽器 localStorage 裡的隨機 UUID，**不是身分驗證**。處理敏感資料時，請在前面加上自己的存取控制（VPN、SSO proxy 或 reverse proxy 的 basic auth）。

---

# 🎨 Design System

UI 只使用 **Catppuccin Latte**，整體刻意保持極簡：沒有 sidebar、dashboard、聊天泡泡、漸層、大量設定面板或導覽教學。

Artifact 永遠是畫面上最重要的元素，工具列只是操作 artifact 的方式；錄音是最主要的按鈕。所有圖示按鈕都有 aria-label、可以用鍵盤操作，並遵守 `prefers-reduced-motion`。桌面優先，平板可用，手機會等比例縮小 artifact、工具列變精簡。

---

# 🧱 Monorepo

使用 pnpm workspace：

```text
.
├── apps/
│   ├── web/                 React / Vite / Tailwind v4 / Milkdown
│   └── server/              Fastify / SQLite / Codex bridge
├── packages/
│   └── shared/              Zod schemas、共用型別、slide allowlist
├── services/
│   └── asr/                 FastAPI / FunASR / Fun-ASR-Nano-2512
├── .github/workflows/ci.yml
├── Dockerfile               app image
├── docker-compose.yml       app + asr
├── docker-compose.dev.yml   開發用：把 asr 開在 127.0.0.1:8000
├── pnpm-workspace.yaml
└── package.json
```

共用的 TypeScript 設定是根目錄的 `tsconfig.base.json`，ESLint 是根目錄的 `eslint.config.js`，所以沒有另外的 `packages/config`。

## Shared Types

前後端共用 `packages/shared` 的 Zod schemas，例如：

```ts
export const PresentationOutputSchema = z
	.object({
		html: z.string().min(1),
		warnings: z.array(z.string())
	})
	.strict();

export type PresentationOutput = z.infer<typeof PresentationOutputSchema>;
```

我們盡量避免「前端的 interface ≠ 後端的 interface」這種長期容易 schema drift 的情況。Zod 同時負責 runtime validation 與 TypeScript type inference；API 回應、artifact、模型清單、錯誤碼與生成事件都定義在這裡。

---

# Technology Stack

| 層級           | 技術                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| Web            | React 19、TypeScript、Vite、Tailwind CSS v4、Milkdown、DOMPurify、Zod、Lucide    |
| Backend        | Node.js、TypeScript、Fastify 5、SQLite（better-sqlite3）、Zod、Codex app-server  |
| ASR            | Python 3.12、FastAPI、FunASR、Fun-ASR-Nano-2512、PyTorch（CUDA）、OpenCC、ffmpeg |
| Infrastructure | Docker、Docker Compose、NVIDIA Container Toolkit、Dokploy                        |

---

# 開發

需求：

- Node.js ≥ 22.12（CI 與 Docker 用 Node 24）、pnpm 12（`corepack enable pnpm` 或 `npm i -g pnpm@12`）
- 本機開發需要 Codex CLI（`npm i -g @openai/codex`）；app image 已內建
- Docker 與 Compose v2
- ASR：NVIDIA GPU、較新的 NVIDIA driver、[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- 只有在 Docker 外執行 ASR 服務或它的測試時才需要 Python 3.12

```bash
pnpm install

# Terminal 1：在 GPU 主機上啟動 ASR，並開在 127.0.0.1:8000（第一次會下載模型）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build asr

# Terminal 2：Vite（http://localhost:5173）+ Fastify（:3000，Vite 會代理 /api）
ASR_URL=http://127.0.0.1:8000 pnpm dev
```

沒有 GPU 也可以開發 UI：app 會正常啟動並顯示 Codex 登入，`/api/health` 會回報 ASR 無法使用。

直接在主機上跑 ASR 服務（Linux + CUDA，或用 `ASR_DEVICE=cpu` 慢速推理）：

```bash
cd services/asr
python3.12 -m venv .venv && . .venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cu128 torch==2.11.0 torchaudio==2.11.0
pip install -e ".[gpu,dev]"
uvicorn app.main:app_factory --factory --port 8000
```

整個 stack 用 Docker 跑：

```bash
cp .env.example .env
docker compose up --build        # http://localhost:8080
```

開發時的設定都來自環境變數（見 `apps/server/src/config.ts`）；本機預設資料在 `apps/server/data/app.db`，沒設定 `CODEX_HOME` 時使用你平常的 `~/.codex`。

---

# 品質檢查

根目錄提供一致的指令：

| 指令                | 作用                                                          |
| ------------------- | ------------------------------------------------------------- |
| `pnpm format`       | 用 repo 既有的 Prettier 設定（`.prettierrc`）格式化           |
| `pnpm format:check` | 只檢查格式，不修改                                            |
| `pnpm lint`         | TypeScript / React 的 ESLint（只管正確性，格式交給 Prettier） |
| `pnpm lint:fix`     | 自動修正可修的 lint 問題                                      |
| `pnpm typecheck`    | 全 workspace 的 strict TypeScript 檢查                        |
| `pnpm test`         | 各 package 的 Vitest（`pnpm test:unit` 相同）                 |
| `pnpm build`        | 建置 web（含 slide class 檢查）與 server                      |
| `pnpm check`        | 依序執行 format:check → lint → typecheck → test → build       |

Python（ASR 服務）使用 Ruff，另外執行：

```bash
cd services/asr
pip install -e ".[dev]"      # 不需要 torch / funasr，推理會被 mock
ruff check . && ruff format --check .
pytest
```

`.githooks/pre-commit` 會在 commit 時用 Prettier 格式化已 staged 的檔案（`pnpm install` 時會自動設定 `core.hooksPath`）。

## 測試策略

一般 CI 不需要 NVIDIA GPU，ASR 模型推理在 GitHub Actions 裡會被 mock。CI 專注在可重現的應用行為：

- Zod schemas 與 API 驗證
- 生成 HTML 的 sanitation（允許與禁止的 tag、屬性移除）、Tailwind allowlist、arbitrary value 拒絕
- 模型與思考強度驗證
- revision 衝突，以及舊的生成結果不能覆蓋新的手動修改
- 接續語意：關閉時開新 thread；開啟時 resume，並帶入手動修改後的內容
- Codex JSON-RPC 的請求對應、崩潰時拒絕等待中的請求、重啟退避
- 前端錄音狀態：開始、停止、取消（零網路請求）、自動停止
- ASR 工具程式：OpenCC 轉換、hotwords 正規化、音檔處理、暫存檔清理、並行上限、設定解析

實際的 GPU 推理在部署機器上另外驗證。

## CI

`.github/workflows/ci.yml` 在 `push` 與 `pull_request` 執行，使用最小權限，並會取消過時的執行：

- **node**：`pnpm install --frozen-lockfile`、format check、lint、typecheck、tests、production build
- **python**：Ruff lint 與 format check、不裝 GPU 套件的模組 import 檢查、pytest（含 ffmpeg）
- **docker**：`docker compose config`、ASR Dockerfile 的 `docker build --check`、完整 build app image 並做 smoke test（health、SPA、SIGTERM 正常結束）

好幾 GB 的 CUDA ASR image 只做 Dockerfile 檢查，不會每個 PR 都 build 或下載模型。CI 只做驗證，不做部署。

---

# Docker

Production 由兩個 service 組成：

- **`app`**：Fastify、建置好的 React、SQLite、Codex CLI（app-server）。只有它對外；預設 host port 綁在 `127.0.0.1:8080`（`APP_BIND`、`APP_PORT`），container 內部聽 3000。Volumes：`app-data`（`/data/app`，SQLite）、`codex-data`（`/data/codex`）。
- **`asr`**：FastAPI、FunASR、Fun-ASR-Nano-2512、CUDA 版 PyTorch、OpenCC、ffmpeg。透過 `deploy.resources.reservations.devices` 使用 NVIDIA GPU（可用 `NVIDIA_VISIBLE_DEVICES` 指定），只在 Docker 內部網路。Volume：`asr-model-cache`（`/models`）。

兩個 service 都有 health check（ASR 的 start period 很長，因為第一次要下載模型），也都會處理 SIGTERM 正常關閉。

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f asr         # 第一次啟動會把模型下載到 asr-model-cache
open http://localhost:8080
```

GPU 主機需要：NVIDIA driver、NVIDIA Container Toolkit 與 Docker。先確認這行能印出 GPU：

```bash
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi
```

如果出現 `could not select device driver "" with capabilities: [[gpu]]`，代表還沒裝 Toolkit：

```bash
sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
```

（安裝方式見上方 NVIDIA Container Toolkit 連結。）

## Dokploy

這個 stack 有 **兩個 service**（`app` + `asr`），必須用 **Compose** 部署。Dokploy 的 **Application** 搭配 build type **Dockerfile** 只會 build 根目錄的 `Dockerfile`，也就是只有 `app`：沒有 ASR，每次錄音都會出現「語音辨識服務目前無法使用。」（`/api/health` 顯示 `asr.reachable: false`）。

1. **Create Service → Compose**（Docker Compose），指向這個 repo，compose path 填 `./docker-compose.yml`。如果之前用根目錄 `Dockerfile` 建過 Application，把它刪掉，或至少移除它的網域。
2. 確認主機的 GPU 測試（上面那行 `nvidia-smi`）能通過。
3. 在 **Environment** 設定環境變數，參考 `.env.example`；放在 Traefik 後面時保持 `TRUST_PROXY=true`。
4. **Domains**：網域綁到 service `app`、**port `3000`**（container 內部的 port，不是 8080），開 HTTPS。瀏覽器只允許在 HTTPS 上使用麥克風。網域流量由 Traefik 走 Docker 網路，所以不會和 Dokploy 面板自己佔用的 host port 3000 衝突。
5. Deploy。Named volumes（`app-data`、`codex-data`、`asr-model-cache`）在重新部署之間會保留；不要改名或刪除，否則會失去 SQLite 資料、Codex 登入與模型快取。
6. 打開網域，完成一次 Codex 登入。

---

# Codex 登入

第一次使用（device code 流程）：

1. 打開網頁。如果 `account/read` 沒有帳號，會顯示「登入 ChatGPT」。
2. 按「使用 ChatGPT 帳號登入」，server 會呼叫 `account/login/start`（`{ "type": "chatgptDeviceCode" }`）。
3. 頁面顯示「開啟驗證頁面」按鈕與一次性代碼（可複製）。
4. 開啟驗證頁面、登入 ChatGPT，**在 OpenAI 的頁面**輸入代碼，不是貼回這個網頁。
5. Server 收到 `account/login/completed` 後，頁面會自動進入工作區。「取消」會呼叫 `account/login/cancel`。

登出在「模型與設定」面板裡（呼叫 `account/logout`）。

---

# 環境變數

複製 `.env.example`（或在 Dokploy 的 Environment 設定），主要的值：

```env
NODE_ENV=production
PORT=3000
APP_BIND=127.0.0.1
APP_PORT=8080
LOG_LEVEL=info

DATABASE_PATH=/data/app/app.db
PERSIST_TRANSCRIPTS=false

CODEX_HOME=/data/codex
CODEX_TURN_TIMEOUT_MS=180000

ASR_URL=http://asr:8000
ASR_PROVIDER=funasr
ASR_MODEL=FunAudioLLM/Fun-ASR-Nano-2512
ASR_MODEL_HUB=hf
ASR_LANGUAGE=zh
ASR_DEVICE=cuda
ASR_MAX_CONCURRENCY=2
ASR_OPENCC_CONFIG=s2tw

HOTWORDS=

MAX_AUDIO_MINUTES=60
MAX_AUDIO_BYTES=262144000

NVIDIA_VISIBLE_DEVICES=all
TRUST_PROXY=true
```

不需要任何 secret；也不要把憑證 commit 進 repo。

---

# 疑難排解

| 狀況 | 檢查 |
| --- | --- |
| GPU 沒被偵測到 | `docker compose exec asr python -c "import torch; print(torch.cuda.is_available())"`；安裝 NVIDIA Container Toolkit、重啟 Docker、檢查 `NVIDIA_VISIBLE_DEVICES`。 |
| ASR 模型載入失敗 | `docker compose logs asr`，`/health` 會顯示 `status: error`；檢查 `asr-model-cache` 的磁碟空間與連到 Hugging Face 的網路（或改 `ASR_MODEL_HUB=ms`，被限流時設 `HF_TOKEN`）。 |
| 「語音辨識服務目前無法使用。」 | `ASR_URL` 錯誤、模型還在載入，或（Dokploy）用了 Application 而不是 Compose。看 `/api/health` 的 `asr`。 |
| 「AI 服務需要重新登入。」 | 完成 device login；確認 `codex-data` 掛在 `CODEX_HOME` 且 uid 1000（`node`）可寫入。 |
| Device login 失敗 | Server 需要能對外連到 `auth.openai.com`；重試；你的 ChatGPT workspace 必須允許 device code 登入。 |
| 模型清單是空的 | `/api/models` 需要已登入；看 `app` 的 log 有沒有 `model/list` 錯誤，或更新 Codex CLI（`CODEX_VERSION`）。 |
| 麥克風權限 | 必須是 HTTPS（或 `localhost`）；檢查瀏覽器的網站權限。Safari 錄的是 `audio/mp4`，有支援。 |
| 「不支援這種錄音格式。」 | ASR image 已內建 ffmpeg；在主機上直接跑時要安裝 ffmpeg 並放在 `PATH`（或設 `FFMPEG_BIN`）。 |
| SQLite 權限 | `DATABASE_PATH` 所在目錄必須讓 app 使用者（uid 1000）可寫入；用 bind mount 時 `chown 1000:1000`。 |
| Dokploy volume 問題 | 使用 compose 檔裡的 named volumes；bind mount 要注意擁有者（app uid 1000、asr uid 10001）。 |
| `app` 起不來：`port is already allocated` | 不要把 host port 設成 3000（Dokploy 面板在用）；預設是 `127.0.0.1:8080`。 |
| 網域回 502 | Dokploy 的網域 port 要填 `3000`，改完後 Redeploy 讓 Traefik label 更新。 |
| 「內容已在其他地方更新，請再試一次。」 | 同一個工作區在別的分頁被修改過，頁面已重新載入最新版本，再錄一次即可。 |

---

# 設計原則

做架構決策時，依序優先考慮：

1. **正確性**：改變別人說話的意思，比產生不夠漂亮的 artifact 更糟。
2. **延遲**：說話應該比手動做一份文件或投影片明顯更快。
3. **簡單**：使用者不需要懂 AI prompting。
4. **可編輯**：AI 的輸出是起點，不是不可修改的答案。
5. **盡可能在本地處理**：尤其是原始語音。
6. **可衡量的模型決策**：ASR 模型最終應該依據我們真實的台灣 workload 來選，而不是靠知名度。

---

# 現況

目前的設計是：

```text
Voice
  ↓
Local Fun-ASR（H200）
  ↓
Traditional Chinese transcript
  ↓
Codex
  ↓
Presentation / Document
```

長期目標很簡單：

> 縮短 **「我想表達什麼」** 與 **「對方能理解什麼」** 之間的距離。

## License

[WTFPL](LICENSE).
