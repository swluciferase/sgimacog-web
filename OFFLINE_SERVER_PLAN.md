# SigmaCog 離線 EEG 分析伺服器系統 — 實作計畫書

## 目錄

1. [專案概覽](#1-專案概覽)
2. [系統架構](#2-系統架構)
3. [專案目錄結構](#3-專案目錄結構)
4. [Phase 分階段開發計畫](#4-phase-分階段開發計畫)
5. [Crate 重構策略（雙目標：WASM + Native）](#5-crate-重構策略雙目標wasm--native)
6. [REST API 規格](#6-rest-api-規格)
7. [前端 Lite 版策略](#7-前端-lite-版策略)
8. [SQLite Schema 設計](#8-sqlite-schema-設計)
9. [硬體綁定授權系統](#9-硬體綁定授權系統)
10. [HTTPS / Secure Context 解決方案](#10-https--secure-context-解決方案)
11. [報告產生（伺服器端）](#11-報告產生伺服器端)
12. [建置與部署指南](#12-建置與部署指南)
13. [WiFi 熱點設定指南](#13-wifi-熱點設定指南)
14. [測試策略](#14-測試策略)
15. [各階段工時估算](#15-各階段工時估算)
16. [長時間錄製：Streaming Chunk 架構](#16-長時間錄製streaming-chunk-架構)
17. [Packet Loss 偵測與補償機制](#17-packet-loss-偵測與補償機制)
18. [雲端版改進：OPFS 分段寫入 + Gap 插值](#18-雲端版改進opfs-分段寫入--gap-插值)

---

## 1. 專案概覽

**產品名稱：** SigmaCog EEG Offline Server
**基於版本：** sgimacog-web v0.6.0（雲端版）
**目標：** 在無網路環境下，以單台筆電/迷你PC作為 WiFi 熱點 + EEG 分析伺服器，讓多台客戶端瀏覽器透過 BLE 採集腦波後上傳分析。

**核心特性：**
- 零網路依賴（完全離線運作）
- 單一 Rust 二進位檔（含靜態前端、API、分析引擎、SQLite）
- 客戶端為純瀏覽器（BLE + UI），無需安裝任何軟體
- 硬體綁定授權（防止未授權複製部署）

---

## 2. 系統架構

```
伺服器（筆電/迷你PC，WiFi 熱點 192.168.x.1）
├── 單一 Rust 二進位檔（sgimacog-server）
│   ├── Axum HTTP 伺服器（port 443 HTTPS / 80 HTTP）
│   ├── rust-embed 嵌入靜態前端（sgimacog-web-lite）
│   ├── REST API
│   │   ├── POST /api/analyze      — 接收原始 EEG 上傳、執行分析
│   │   ├── GET  /api/report/:id   — 取得分析報告
│   │   ├── GET  /api/sessions     — 列出歷史 session
│   │   └── GET  /api/health       — 伺服器健康檢查
│   ├── Native Rust EEG 分析引擎（steeg8ch crate，原生編譯）
│   ├── SQLite 持久化儲存（sessions、reports）
│   └── 授權驗證模組（硬體指紋 + HMAC 授權碼）
└── OS 層 WiFi 熱點

客戶端（任何具 BLE 的裝置 + 瀏覽器）
├── 從伺服器載入 sgimacog-web-lite
├── BLE 連接 EEG 裝置（Web Bluetooth / Web Serial）
├── 瀏覽器記憶體中累積原始 EEG 樣本
├── 錄製完成後 POST 原始數據至 /api/analyze
└── 接收並顯示分析報告（HTML / PDF）
```

---

## 3. 專案目錄結構

以下為需要新建的檔案與目錄（在 `sgimacog-web/` 下）：

```
sgimacog-web/
├── crate/                          # 現有 — 需重構
│   ├── Cargo.toml                  # 修改：新增 feature flags
│   ├── src/
│   │   ├── lib.rs                  # 修改：條件編譯
│   │   ├── wasm_api.rs             # 現有：僅 wasm target
│   │   ├── native_api.rs           # 新增：原生 API 入口
│   │   ├── eeg_analysis.rs         # 現有：不改（核心演算法）
│   │   ├── capability.rs           # 現有：不改
│   │   └── ...                     # 其餘模組不改
│   └── Cargo.lock
│
├── server/                         # 新增 — 離線伺服器
│   ├── Cargo.toml                  # 依賴：axum, rust-embed, rusqlite, etc.
│   ├── src/
│   │   ├── main.rs                 # 程式入口、授權檢查、啟動伺服器
│   │   ├── api/
│   │   │   ├── mod.rs              # API router
│   │   │   ├── analyze.rs          # POST /api/analyze 處理
│   │   │   ├── report.rs           # GET /api/report/:id
│   │   │   ├── sessions.rs         # GET /api/sessions
│   │   │   └── health.rs          # GET /api/health
│   │   ├── analysis/
│   │   │   └── mod.rs              # 呼叫 steeg crate 原生分析
│   │   ├── db/
│   │   │   ├── mod.rs              # SQLite 連線池 + migration
│   │   │   └── schema.sql          # DDL
│   │   ├── license/
│   │   │   ├── mod.rs              # 授權驗證邏輯
│   │   │   └── fingerprint.rs      # 硬體指紋生成
│   │   ├── report/
│   │   │   ├── mod.rs              # 報告產生（HTML + PDF）
│   │   │   └── templates/          # HTML 報告模板
│   │   ├── tls/
│   │   │   └── mod.rs              # 自簽憑證產生（rcgen）
│   │   └── embedded.rs             # rust-embed 靜態檔案
│   ├── build.rs                    # 建置腳本（前端先 build 再 embed）
│   └── migrations/
│       └── 001_init.sql
│
├── web/                            # 現有前端
│   ├── src/
│   │   ├── services/
│   │   │   ├── wasm.ts             # 現有：雲端版用
│   │   │   ├── serverAnalysis.ts   # 新增：離線版 — 呼叫 /api/analyze
│   │   │   └── eegReport.ts        # 修改：依模式切換 WASM / server
│   │   └── ...
│   ├── vite.config.ts              # 修改：新增 OFFLINE_MODE 環境變數
│   └── package.json
│
├── scripts/                        # 新增 — 部署輔助腳本
│   ├── build-server.sh             # 跨平台建置腳本
│   ├── setup-hotspot-macos.sh      # macOS WiFi 熱點設定
│   ├── setup-hotspot-windows.ps1   # Windows WiFi 熱點設定
│   ├── setup-hotspot-linux.sh      # Linux WiFi 熱點設定
│   └── generate-license.py         # 授權碼產生工具（僅限內部使用）
│
├── Cargo.toml                      # 新增：workspace root
└── OFFLINE_SERVER_PLAN.md          # 本文件
```

---

## 4. Phase 分階段開發計畫

### Phase 1：Crate 重構（雙目標支援）
**里程碑：** `steeg-wasm` crate 同時支援 `wasm32-unknown-unknown` 和原生 target 編譯。

**具體任務：**
1. 將 `crate/Cargo.toml` 改為 workspace member
2. 新增 `feature = ["wasm"]`，預設不開啟
3. 將 `wasm_api.rs` 中所有 `#[wasm_bindgen]` 標記加上 `#[cfg(feature = "wasm")]`
4. 新增 `native_api.rs`，提供 `pub fn analyze_eeg_native(samples: &[f32], age: u32) -> AnalysisResult`
5. `eeg_analysis.rs`、`capability.rs` 等核心模組保持不變（已是純 Rust，無 JS 依賴）
6. 確保 `cargo build --target wasm32-unknown-unknown --features wasm` 和 `cargo build` 皆通過
7. 在 `lib.rs` 中條件匯出：

```rust
// lib.rs 修改後
pub mod types;
pub mod protocol;
pub mod cobs_frame;
pub mod commands;
pub mod impedance;
pub mod impedance_monitor;
pub mod eeg_analysis;
pub mod capability;

#[cfg(feature = "wasm")]
pub mod wasm_api;

#[cfg(not(target_arch = "wasm32"))]
pub mod native_api;
```

**驗收標準：**
- `wasm-pack build crate --target web --features wasm` 成功，現有 sgimacog-web 雲端版不受影響
- `cargo test -p steeg-wasm` 原生 target 通過
- `analyze_eeg_internal()` 在原生 target 回傳正確結果

---

### Phase 2：離線伺服器骨架
**里程碑：** Axum 伺服器可啟動、提供 health check、embed 靜態檔案。

**具體任務：**
1. 建立 `server/` crate，`Cargo.toml` 依賴：
   - `axum` = "0.7"
   - `tokio` = { version = "1", features = ["full"] }
   - `rust-embed` = "8"
   - `rusqlite` = { version = "0.31", features = ["bundled"] }
   - `serde` / `serde_json`
   - `rcgen` = "0.13"（自簽憑證）
   - `axum-server` = { version = "0.6", features = ["tls-rustls"] }
   - `sha2` / `hmac`（授權）
   - `steeg-wasm` = { path = "../crate" }（原生分析）
2. 實作 `main.rs`：啟動 HTTPS 伺服器、載入或產生自簽憑證
3. 實作 `embedded.rs`：`#[derive(RustEmbed)] #[folder = "../web/dist"]`
4. 實作 `GET /api/health` 回應 `{ "status": "ok", "version": "..." }`
5. 實作 fallback handler：所有非 `/api/*` 路徑回傳嵌入的前端靜態檔

**驗收標準：**
- `cargo run -p sgimacog-server` 啟動後，瀏覽器可載入前端頁面
- `/api/health` 回傳 200

---

### Phase 3：EEG 分析 API
**里程碑：** 完整的 EEG 上傳→分析→回傳報告 API。

**具體任務：**
1. 實作 `POST /api/analyze`（詳見 [API 規格](#6-rest-api-規格)）
2. 在 `server/src/analysis/mod.rs` 中呼叫 `steeg_wasm::eeg_analysis::analyze_eeg_internal()`
3. 實作 `server/src/report/mod.rs`：將 `AnalysisResult` 轉為 HTML 報告
   - 將 `eegReportHtml.tsx` 的模板邏輯移植為 Rust 字串模板（或嵌入 minijinja）
4. 實作 SQLite 儲存：session 建立、分析結果寫入
5. 實作 `GET /api/report/:id`（回傳 HTML 或 JSON）
6. 實作 `GET /api/sessions`（列出歷史 session）

**驗收標準：**
- 使用 `curl` 以 flat binary 上傳測試數據，伺服器回傳正確的分析 JSON
- 分析結果與雲端版 WASM 分析結果一致
- 報告可在瀏覽器中正確顯示

---

### Phase 4：前端 Lite 版
**里程碑：** 前端條件編譯，離線版不載入 WASM 分析引擎，改用 server API。

**具體任務：**
1. `vite.config.ts` 新增 `define: { __OFFLINE_MODE__: ... }`
2. 新增 `web/src/services/serverAnalysis.ts`
3. 修改 `eegReport.ts` 中 `analyzeEeg()`：`__OFFLINE_MODE__` 分支
4. 修改 `wasm.ts`：離線模式下分析相關 `init()` 為 no-op（BLE parser 仍需 WASM）
5. 移除離線版不需要的功能（sessionApi 雲端上傳、QR code 線上分享等）
6. 新增 `npm run build:offline` 腳本

**驗收標準：**
- `VITE_OFFLINE=true npm run build` 產出的 dist 中分析 WASM 不被載入
- 離線前端可正確透過 API 完成分析流程

---

### Phase 5：硬體授權系統
**里程碑：** 二進位檔啟動前驗證硬體指紋 + 授權碼。

**具體任務：**
1. 實作 `server/src/license/fingerprint.rs`：跨平台硬體指紋收集
2. 實作 `server/src/license/mod.rs`：HMAC 驗證
3. 實作 `main.rs` 中的啟動授權流程
4. 建立 `scripts/generate-license.py`：內部授權碼產生工具

**驗收標準：**
- 無授權碼時，伺服器啟動後顯示 machine ID 並拒絕服務
- 正確授權碼輸入後，伺服器正常運作
- 將二進位檔複製到另一台機器，授權碼失效

---

### Phase 6：部署打包 + 熱點設定
**里程碑：** 三平台可用的部署包 + 文件。

**具體任務：**
1. 建置腳本（cross-compile：macOS aarch64, Windows x86_64, Linux x86_64）
2. WiFi 熱點設定腳本（詳見 [WiFi 熱點](#13-wifi-熱點設定指南)）
3. 安裝說明文件（setup guide）
4. 客戶端 HTTPS 信任安裝指南

---

## 5. Crate 重構策略（雙目標：WASM + Native）

### 現況分析

`steeg-wasm` crate（`/Users/swryociao/sgimacog-web/crate/`）目前結構：

| 模組 | WASM 依賴 | 可直接原生使用 |
|------|----------|--------------|
| `eeg_analysis.rs` | 無 | 是 — 純 Rust 演算法 |
| `capability.rs` | 無 | 是 — 純 Rust |
| `protocol.rs` | 無 | 是 |
| `types.rs` | 無 | 是 |
| `commands.rs` | 無 | 是 |
| `cobs_frame.rs` | 無 | 是 |
| `impedance.rs` | 無 | 是 |
| `impedance_monitor.rs` | 無 | 是 |
| `wasm_api.rs` | `wasm_bindgen`, `js_sys` | 否 — 需 feature gate |

### 重構方案

**策略：Feature flag 隔離 WASM 層，核心演算法保持不變。**

修改 `crate/Cargo.toml`：

```toml
[package]
name = "steeg-wasm"
version = "0.2.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[features]
default = []
wasm = ["wasm-bindgen", "js-sys"]

[dependencies]
cobs = { version = "0.5", default-features = false, features = ["alloc"] }
wasm-bindgen = { version = "0.2", optional = true }
js-sys = { version = "0.3", optional = true }

[dev-dependencies]
wasm-bindgen-test = "0.3"

[profile.release]
opt-level = "s"
```

修改 `crate/src/lib.rs`：

```rust
pub mod types;
pub mod protocol;
pub mod cobs_frame;
pub mod commands;
pub mod impedance;
pub mod impedance_monitor;
pub mod eeg_analysis;
pub mod capability;

#[cfg(feature = "wasm")]
pub mod wasm_api;
```

前端建置指令更新（`web/package.json` 的 `build:wasm`）：

```bash
cd ../crate && wasm-pack build --target web --release --out-dir ../web/src/pkg -- --features wasm
```

伺服器直接依賴 crate，不需 feature：

```toml
# server/Cargo.toml
[dependencies]
steeg-wasm = { path = "../crate" }
```

**這是侵入最小的方案。** `eeg_analysis.rs` 和 `capability.rs` 完全不需修改，因為它們已經是純 Rust，不依賴任何 WASM 特有的 crate。唯一的改動在 `wasm_api.rs`（加 feature gate）和 `Cargo.toml`（dependencies 改 optional）。

---

## 6. REST API 規格

### 6.1 POST /api/analyze

**用途：** 接收原始 EEG 數據，執行分析，回傳報告。

**Request：**

```
POST /api/analyze
Content-Type: application/json
```

```json
{
  "samples_flat": [0.123, -0.456, ...],
  "sample_rate": 1001,
  "channels": 8,
  "age": 25,
  "subject_info": {
    "name": "受試者姓名",
    "dob": "1998-05-20",
    "gender": "M",
    "device_id": "STEEG_DG819452",
    "record_datetime": "2026-04-12T14:30:00+08:00",
    "notes": "選填備註"
  }
}
```

**欄位說明：**

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `samples_flat` | `f32[]` | 是 | Row-major interleaved：`[s0_ch0, s0_ch1, ..., s0_ch7, s1_ch0, ...]` |
| `sample_rate` | `u32` | 否 | 預設 1001 Hz |
| `channels` | `u8` | 否 | 預設 8 |
| `age` | `u32` | 是 | 受試者年齡 |
| `subject_info` | `object` | 否 | 受試者資訊（用於報告） |

**注意：** `samples_flat` 為 JSON 數字陣列，大小約為 `樣本數 x 8 x ~6 bytes`。3 分鐘錄製 (180s x 1001 = 180,180 samples) 約 180,180 x 8 x 6 = 8.6 MB JSON。若效能不足，Phase 3+ 可改用 binary body：

```
POST /api/analyze-binary
Content-Type: application/octet-stream
X-Sample-Rate: 1001
X-Channels: 8
X-Age: 25
X-Subject-Info: <base64-encoded JSON>

[body: raw Float32 little-endian bytes]
```

**Response (200 OK)：**

```json
{
  "session_id": "uuid-v4",
  "indices": {
    "TBR": 2.3456,
    "APR": 1.2345,
    "FAA": 0.0567,
    "PAF": 10.23,
    "RSA": 0.8901,
    "COH": 0.7654,
    "EnTP": 0.5432
  },
  "tscores": {
    "TBR": 45,
    "APR": 55,
    "FAA": 50,
    "PAF": 60,
    "RSA": 40,
    "COH": 52,
    "EnTP": 48
  },
  "capability": {
    "專注力": 72.5,
    "情緒調節": 65.3,
    "認知靈活": 58.1,
    "壓力耐受": 44.2,
    "腦波協調": 80.6
  },
  "age": 25,
  "clean_epochs": 85,
  "total_epochs": 90,
  "duration_sec": 180.18,
  "report_url": "/api/report/uuid-v4"
}
```

**Response (400 Bad Request)：**

```json
{
  "error": "too_short:45.2",
  "message": "錄製時間不足（最少 90 秒）"
}
```

### 6.2 GET /api/report/:id

**用途：** 取得分析報告。

**Query 參數：**

| 參數 | 說明 |
|------|------|
| `format=html` | 回傳完整 HTML 報告（預設） |
| `format=json` | 回傳 JSON 數據 |
| `format=pdf` | 回傳 PDF 二進位（Phase 3+） |

**Response (200)：** 依 format 參數回傳對應內容。

### 6.3 GET /api/sessions

**用途：** 列出歷史分析 session。

**Response：**

```json
{
  "sessions": [
    {
      "id": "uuid-v4",
      "subject_name": "受試者",
      "device_id": "STEEG_DG819452",
      "record_datetime": "2026-04-12T14:30:00+08:00",
      "duration_sec": 180.18,
      "created_at": "2026-04-12T14:35:00+08:00"
    }
  ]
}
```

### 6.4 GET /api/health

**Response：**

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime_sec": 3600
}
```

---

## 7. 前端 Lite 版策略

### 策略：條件編譯（非 fork）

使用 Vite 的 `define` + dead code elimination，同一份原始碼產生兩個版本：

**修改 `web/vite.config.ts`：**

```typescript
define: {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __OFFLINE_MODE__: JSON.stringify(process.env.VITE_OFFLINE === 'true'),
},
```

**修改 `web/package.json`：**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:offline": "VITE_OFFLINE=true vite build",
    "build:wasm": "cd ../crate && wasm-pack build --target web --release --out-dir ../web/src/pkg -- --features wasm"
  }
}
```

### 需要條件化的模組

| 模組 | 雲端版行為 | 離線版行為 |
|------|-----------|-----------|
| `services/wasm.ts` | 載入完整 WASM | 僅載入 parser WASM（無分析引擎） |
| `services/eegReport.ts` | 呼叫 WASM `analyze_eeg()` | 呼叫 `POST /api/analyze` |
| `services/reportPdf.ts` | 客戶端 jsPDF 產生 | 顯示伺服器產生的報告 |
| `services/eegReportHtml.tsx` | 客戶端 React SSR | 從 `/api/report/:id` 取得 HTML |
| `services/sessionApi.ts` | 呼叫 artisebio.com API | 呼叫本地 `/api/sessions` |
| `App.tsx` 的 SteegParser | WASM SteegParser | 同樣 — BLE 解析仍需 WASM |

**重要：BLE 資料解析（`SteegParser`）也依賴 WASM。** 離線版採用選項 A：

**選項 A（推薦）：保留 WASM 用於 BLE 解析，僅替換分析引擎**
- 客戶端仍載入精簡版 WASM（僅 SteegParser + commands，不含 eeg_analysis）
- 分析由伺服器執行
- 優點：最小改動、BLE 解析效能維持
- 缺點：仍需 WASM，但檔案極小（SteegParser 約 50KB）

可將 crate 拆成兩個 feature：
- `feature = "parser"`（預設）— SteegParser + commands
- `feature = "analysis"` — eeg_analysis + capability（僅伺服器用）

離線版 WASM 僅啟用 `parser` feature，分析由伺服器執行。

### 前端修改清單

1. **`services/serverAnalysis.ts`**（新增）— fetch `/api/analyze`
2. **`services/eegReport.ts`**（修改）— `__OFFLINE_MODE__` 分支
3. **`services/wasm.ts`**（無需改）— 離線版仍需 WASM（SteegParser）
4. **`components/views/RecordView.tsx`**（修改）— 分析完成後導向 `/api/report/:id`
5. **`services/sessionApi.ts`**（修改）— 離線版指向本地 API
6. **`services/reportPdf.ts`**（修改）— 離線版隱藏 PDF 下載或改為 server-side PDF
7. **`vite.config.ts`**（修改）— 新增 `__OFFLINE_MODE__` define

---

## 8. SQLite Schema 設計

```sql
-- migrations/001_init.sql

-- 分析 Session
CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,           -- UUID v4
    subject_name    TEXT,
    subject_dob     TEXT,                       -- ISO date
    subject_gender  TEXT,                       -- M/F/O
    device_id       TEXT,
    record_datetime TEXT NOT NULL,              -- ISO 8601
    duration_sec    REAL NOT NULL,
    sample_rate     INTEGER NOT NULL DEFAULT 1001,
    channels        INTEGER NOT NULL DEFAULT 8,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 分析結果
CREATE TABLE analysis_results (
    id              TEXT PRIMARY KEY,           -- UUID v4
    session_id      TEXT NOT NULL REFERENCES sessions(id),
    -- Brain Indices (原始值)
    idx_tbr         REAL,
    idx_apr         REAL,
    idx_faa         REAL,
    idx_paf         REAL,
    idx_rsa         REAL,
    idx_coh         REAL,
    idx_entp        REAL,
    -- T-Scores
    ts_tbr          INTEGER,
    ts_apr          INTEGER,
    ts_faa          INTEGER,
    ts_paf          INTEGER,
    ts_rsa          INTEGER,
    ts_coh          INTEGER,
    ts_entp         INTEGER,
    -- Capability (JSON)
    capability_json TEXT,                       -- JSON object
    -- Metadata
    age             INTEGER NOT NULL,
    clean_epochs    INTEGER,
    total_epochs    INTEGER,
    error           TEXT,                       -- NULL if success
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 原始數據（選配：可關閉以節省空間）
CREATE TABLE raw_samples (
    session_id      TEXT NOT NULL REFERENCES sessions(id),
    sample_blob     BLOB NOT NULL,             -- Float32 little-endian binary
    PRIMARY KEY (session_id)
);

-- 報告 HTML 快取
CREATE TABLE report_cache (
    session_id      TEXT PRIMARY KEY REFERENCES sessions(id),
    html            TEXT NOT NULL,
    pdf_blob        BLOB,                      -- 選配
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 授權資訊
CREATE TABLE license (
    id              INTEGER PRIMARY KEY CHECK (id = 1),  -- 單筆
    machine_id      TEXT NOT NULL,
    license_key     TEXT,
    activated_at    TEXT,
    last_verified   TEXT
);

CREATE INDEX idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX idx_results_session ON analysis_results(session_id);
```

---

## 9. 硬體綁定授權系統

### 9.1 硬體指紋生成

```
machine_id = SHA256( MAC_address || disk_serial || hostname )
```

**跨平台實作：**

| 平台 | MAC 地址取得 | 磁碟序號取得 | 主機名取得 |
|------|------------|------------|----------|
| macOS | `ifconfig en0 \| grep ether` | `ioreg -rd1 -c AppleAHCIDiskDriver \| grep Serial` | `hostname` |
| Linux | `/sys/class/net/eth0/address` | `/sys/block/sda/device/serial` | `/etc/hostname` |
| Windows | `GetAdaptersAddresses()` | `GetVolumeInformation()` | `GetComputerName()` |

**Rust 實作建議 crate：**
- `mac_address` crate — 跨平台 MAC
- `sysinfo` crate — hostname
- `std::process::Command` — 磁碟序號（平台特定指令）

### 9.2 授權碼驗證

```rust
// license/mod.rs 概念
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const MASTER_SECRET: &[u8] = b"<compile-time-embedded-secret>";

pub fn verify_license(machine_id: &str, license_key: &str) -> bool {
    let mut mac = HmacSha256::new_from_slice(MASTER_SECRET).unwrap();
    mac.update(machine_id.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());
    expected == license_key
}
```

### 9.3 啟動流程

```
┌─── 程式啟動 ───┐
│                  │
▼                  │
取得硬體指紋 ──→ 讀取 SQLite license 表
                   │
              ┌────┴────┐
              │ 有授權碼？│
              └────┬────┘
           否      │      是
           ▼       │      ▼
    顯示 machine_id │  驗證 HMAC
    等待使用者輸入   │      │
    授權碼          │  ┌───┴───┐
           │       │  │ 驗證通過？│
           ▼       │  └───┬───┘
    驗證 → 存入 DB │   否  │  是
                   │   ▼   │  ▼
                   │  拒絕  │ 啟動伺服器
                   └───────┘
```

### 9.4 授權碼產生工具（內部）

`scripts/generate-license.py`：

```python
#!/usr/bin/env python3
import hmac, hashlib, sys

MASTER_SECRET = b"<same-secret-as-binary>"

def generate(machine_id: str) -> str:
    return hmac.new(MASTER_SECRET, machine_id.encode(), hashlib.sha256).hexdigest()

if __name__ == "__main__":
    mid = sys.argv[1]
    print(f"Machine ID: {mid}")
    print(f"License Key: {generate(mid)}")
```

### 9.5 Release Profile（IP 保護）

```toml
# server/Cargo.toml
[profile.release]
strip = true          # 移除符號表
lto = true            # Link-Time Optimization — 合併所有 crate
codegen-units = 1     # 最大優化
opt-level = 3         # 最高效能（分析引擎需要）
panic = "abort"       # 移除 unwind 資訊
```

---

## 10. HTTPS / Secure Context 解決方案

### 問題

Web Bluetooth API 要求 **Secure Context**（HTTPS 或 localhost）。離線環境無法使用公開 CA 簽發憑證。

### 方案比較

| 方案 | 複雜度 | 使用者操作 | 推薦程度 |
|------|--------|-----------|---------|
| A. Chrome flag 白名單 | 低 | 每台客戶端設一次 | ★★★★ 首選 |
| B. 自簽憑證 + 信任安裝 | 中 | 每台客戶端安裝一次 | ★★★ 備選 |
| C. mDNS + Let's Encrypt | 高 | 不適用（離線） | ✗ |

### 方案 A 詳細步驟（Chrome flag 白名單）

在每台客戶端的 Chrome 瀏覽器中：

1. 開啟 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. 在文字框中輸入：`http://192.168.4.1`（伺服器 IP）
3. 選擇 **Enabled**
4. 重啟 Chrome

此方案最簡單，但僅限 Chrome/Chromium。

### 方案 B 詳細步驟（自簽憑證）

伺服器啟動時自動產生自簽憑證（使用 `rcgen` crate）：

```rust
// tls/mod.rs 概念
use rcgen::{CertificateParams, DnType, SanType, KeyPair};
use std::net::IpAddr;

pub fn generate_self_signed(ip: IpAddr) -> (Vec<u8>, Vec<u8>) {
    let mut params = CertificateParams::default();
    params.distinguished_name.push(DnType::CommonName, "SigmaCog EEG Server");
    params.subject_alt_names = vec![
        SanType::IpAddress(ip),
        SanType::DnsName("sigmacog.local".to_string()),
    ];
    params.not_after = rcgen::date_time_ymd(2036, 1, 1);
    let key_pair = KeyPair::generate().unwrap();
    let cert = params.self_signed(&key_pair).unwrap();
    (cert.pem().into_bytes(), key_pair.serialize_pem().into_bytes())
}
```

**客戶端信任安裝（各平台）：**

| 平台 | 步驟 |
|------|------|
| Windows | 下載 cert.pem → 雙擊 → 安裝至「受信任的根憑證授權單位」 |
| macOS | 下載 cert.pem → 雙擊 → 加入 Keychain → 設為「永遠信任」 |
| iOS | Safari 開啟 `https://192.168.4.1/cert.pem` → 安裝描述檔 → 憑證信任設定 |
| Android | 下載 cert.pem → 設定 > 安全性 > 安裝憑證 |

**伺服器應額外提供 `GET /cert.pem` 端點**（透過 HTTP port 80），讓客戶端方便下載憑證。

---

## 11. 報告產生（伺服器端）

### 現況

目前報告產生在客戶端，分為：
- **HTML 報告**：`eegReportHtml.tsx`（React 組件，使用 ReactDOMServer SSR）
- **PDF 報告**：`reportPdf.ts`（使用 jsPDF）

### 離線版策略

| 選項 | 說明 | 工時 | 維護成本 |
|------|------|------|---------|
| A. Rust 模板引擎（minijinja） | 將 React 模板重寫為 Jinja2 模板 | 高（3-5天） | 低（Rust 原生） |
| B. 嵌入 V8/Deno 執行 React SSR | 伺服器端跑 JS 產生 HTML | 中（2-3天） | 高（依賴 JS runtime） |
| C. 保留客戶端產生 | 分析結果回傳後，客戶端用現有 React 產生 | 低（0天） | 低 |

**建議採用選項 C（Phase 3）+ 選項 A（Phase 4+）。**

Phase 3 先走選項 C：伺服器回傳 JSON 分析結果，客戶端仍用 `eegReportHtml.tsx` 產生 HTML 報告。後續若需伺服器端產生（批次報告或無頭列印），再實作選項 A。

---

## 12. 建置與部署指南

### 12.1 建置前提

- Rust toolchain（rustup，stable channel）
- Bun（前端建置）
- wasm-pack（建置離線版 WASM parser）

### 12.2 建置指令

```bash
# 1. 建置離線版前端
cd /Users/swryociao/sgimacog-web/web

# 1a. 建置 BLE parser WASM（不含分析引擎）
cd ../crate && wasm-pack build --target web --release \
  --out-dir ../web/src/pkg -- --features wasm
cd ../web

# 1b. 建置前端（離線模式）
VITE_OFFLINE=true bun run build

# 2. 建置伺服器（當前平台）
cd /Users/swryociao/sgimacog-web
cargo build -p sgimacog-server --release

# 輸出：target/release/sgimacog-server
```

### 12.3 Cross-compile（交叉編譯）

```bash
# macOS → Windows
rustup target add x86_64-pc-windows-gnu
cargo build -p sgimacog-server --release --target x86_64-pc-windows-gnu

# macOS → Linux
rustup target add x86_64-unknown-linux-musl
cargo build -p sgimacog-server --release --target x86_64-unknown-linux-musl

# 或使用 cross crate 簡化：
cargo install cross
cross build -p sgimacog-server --release --target x86_64-unknown-linux-musl
cross build -p sgimacog-server --release --target x86_64-pc-windows-gnu
```

### 12.4 部署包內容

```
sgimacog-server-v0.1.0-<platform>/
├── sgimacog-server(.exe)          # 伺服器二進位檔（含嵌入前端）
├── README.md                      # 快速啟動指南
├── setup-hotspot.sh/.ps1          # WiFi 熱點設定腳本
└── data/                          # 資料目錄（自動建立）
    ├── sigmacog.db                # SQLite（自動建立）
    ├── cert.pem                   # 自簽憑證（自動建立）
    └── key.pem                    # 私鑰（自動建立）
```

### 12.5 啟動指令

```bash
# 首次啟動
./sgimacog-server

# 伺服器輸出：
# ╔══════════════════════════════════════════╗
# ║   SigmaCog EEG Offline Server v0.1.0    ║
# ╠══════════════════════════════════════════╣
# ║ Machine ID: a3b4c5d6e7f8...             ║
# ║ 請輸入授權碼：_                           ║
# ╚══════════════════════════════════════════╝

# 輸入授權碼後：
# ✓ 授權驗證通過
# ✓ SQLite 資料庫就緒
# ✓ HTTPS 憑證就緒
# ✓ 伺服器啟動於 https://192.168.4.1:443
# ✓ HTTP redirect 啟動於 http://192.168.4.1:80
```

---

## 13. WiFi 熱點設定指南

### 各平台預設 IP 對照

| 平台 | 熱點預設 IP | 設定方式 |
|------|------------|---------|
| macOS | 192.168.2.1 | 系統設定 > 一般 > 共享 > 網際網路共享 |
| Windows | 192.168.137.1 | 設定 > 網路與網際網路 > 行動熱點 |
| Linux | 10.42.0.1 | `nmcli device wifi hotspot` |

伺服器監聽 `0.0.0.0`（所有介面），客戶端透過各平台的熱點 IP 連線。

### macOS

```bash
#!/bin/bash
echo "=== SigmaCog WiFi 熱點設定（macOS）==="
echo "1. 系統設定 > 一般 > 共享"
echo "2. 開啟「網際網路共享」"
echo "3. 共享來源：乙太網路（或其他有線網路）"
echo "4. 共享對象：Wi-Fi"
echo "5. Wi-Fi 選項："
echo "   - 網路名稱：SigmaCog-EEG"
echo "   - 安全性：WPA2/WPA3"
echo "   - 密碼：<設定密碼>"
echo ""
echo "注意：macOS 熱點預設 IP 為 192.168.2.1"
```

### Windows

```powershell
# setup-hotspot-windows.ps1
netsh wlan set hostednetwork mode=allow ssid=SigmaCog-EEG key=<password>
netsh wlan start hostednetwork
# 或使用 Windows 10/11 內建行動熱點：
# 設定 > 網路與網際網路 > 行動熱點
# 預設 IP：192.168.137.1
```

### Linux

```bash
#!/bin/bash
SSID="SigmaCog-EEG"
PASSWORD="<password>"
IFACE="wlan0"
nmcli device wifi hotspot ifname "$IFACE" ssid "$SSID" password "$PASSWORD"
IP=$(nmcli -g IP4.ADDRESS device show "$IFACE" | cut -d/ -f1)
echo "熱點已啟動 — IP：$IP  SSID：$SSID"
```

---

## 14. 測試策略

### 14.1 單元測試

| 層級 | 測試內容 | 工具 |
|------|---------|------|
| Crate 核心 | `analyze_eeg_internal()` 正確性 | `cargo test -p steeg-wasm` |
| Crate 核心 | capability 計算 | `cargo test -p steeg-wasm` |
| Server API | JSON 解析、路由 | `cargo test -p sgimacog-server` |
| Server DB | migration、CRUD | `cargo test`（in-memory SQLite） |
| License | 指紋產生、HMAC 驗證 | `cargo test` |

### 14.2 整合測試

| 測試案例 | 方法 |
|---------|------|
| 完整分析流程 | 上傳已知測試 CSV → 比對預期結果 |
| WASM vs Native 一致性 | 同一份數據分別跑 WASM 和 Native，結果必須 bit-exact |
| 大檔案上傳 | 30 分鐘錄製（約 50MB JSON） → 驗證記憶體/速度 |
| 並發請求 | 5 台客戶端同時上傳 → 伺服器不崩潰 |
| 授權失敗 | 將二進位複製到另一台 → 驗證拒絕啟動 |

### 14.3 效能基準

| 指標 | 目標值 |
|------|--------|
| 3 分鐘 EEG 分析時間（Native） | < 2 秒 |
| JSON 上傳 + 解析（8.6 MB） | < 3 秒 |
| Binary 上傳 + 解析（1.4 MB） | < 1 秒 |
| 伺服器記憶體佔用（閒置） | < 50 MB |
| 併發 5 分析請求 | 全部 < 10 秒完成 |

---

## 15. 各階段工時估算

| Phase | 名稱 | 預估工時 | 依賴 |
|-------|------|---------|------|
| Phase 1 | Crate 重構（雙目標） | 2–3 天 | 無 |
| Phase 2 | 伺服器骨架（Axum + embed + SQLite） | 3–4 天 | Phase 1 |
| Phase 3 | EEG 分析 API + 資料流 | 4–5 天 | Phase 2 |
| Phase 4 | 前端 Lite 版 | 3–4 天 | Phase 3 |
| Phase 5 | 硬體授權系統 | 2–3 天 | Phase 2（可並行 Phase 3/4） |
| Phase 6 | 部署打包 + 熱點設定 | 2–3 天 | Phase 4, 5 |
| — | 測試 + 修正 | 3–5 天 | 各 Phase |
| **合計** | | **19–27 天** | |

**關鍵路徑：** Phase 1 → 2 → 3 → 4 → 6
**可並行：** Phase 5 可與 Phase 3/4 同步進行

---

## 16. 長時間錄製：Streaming Chunk 架構

### 問題

現有架構將所有 `RecordedSample` 累積在瀏覽器 JS heap 中（`recordSamplesRef.current`）。
每筆約 112 bytes，1001 Hz × 8 channels：

| 錄製時長 | 樣本數 | 記憶體佔用 |
|---------|--------|-----------|
| 3 分鐘 | 180K | ~19 MB |
| 1 小時 | 3.6M | ~384 MB |
| 4 小時 | 14.4M | ~1.5 GB（瀏覽器可能崩潰） |

此外，每 2 秒的 `setRecordedSamples([...recordSamplesRef.current])` 會淺拷貝整個陣列，
超過百萬筆後 GC 壓力劇增。

### 解法：分段串流上傳

錄製過程中，客戶端每 N 秒將 buffer flush 至伺服器，只在記憶體中保留最近的顯示用窗口。

```
錄製中（每 10 秒）：
  Browser buffer（最近 30 秒，供即時波形顯示）
    ↓ flush 已確認的 chunk
  POST /api/stream-chunk → Server 追加寫入磁碟/SQLite

錄製結束：
  POST /api/finalize → Server 合併所有 chunk → 執行分析 → 回傳報告
```

**記憶體佔用恆為 ~30 秒 ≈ 3.2 MB，錄多久都不會爆。**

### API 規格

#### POST /api/stream-init

**用途：** 開始一個串流 session，回傳 session_id。

**Request：**

```json
{
  "sample_rate": 1001,
  "channels": 8,
  "subject_info": { "name": "...", "dob": "...", "gender": "M" },
  "device_id": "STEEG_DG819452",
  "start_time": "2026-04-12T14:30:00+08:00"
}
```

**Response (200)：**

```json
{
  "session_id": "uuid-v4",
  "chunk_interval_sec": 10
}
```

#### POST /api/stream-chunk

**用途：** 上傳一段 EEG chunk。

**Request：**

```json
{
  "session_id": "uuid-v4",
  "chunk_index": 0,
  "start_sample": 0,
  "samples_flat": [0.123, -0.456, ...],
  "serial_numbers": [1001, 1002, null, 1004, ...],
  "gap_indices": [2],
  "event_markers": [
    { "sample_offset": 150, "id": "evt1", "label": "Eyes Open" }
  ]
}
```

| 欄位 | 說明 |
|------|------|
| `chunk_index` | 遞增序號（伺服器用於排序 + 偵測遺漏 chunk） |
| `start_sample` | 本 chunk 第一筆的全域 sample index |
| `serial_numbers` | 每筆的 serial number（`null` = 補零的 gap） |
| `gap_indices` | 本 chunk 中 packet loss 補零的位置 index |
| `event_markers` | 本 chunk 中的事件標記 |

**Response (200)：**

```json
{
  "ack": true,
  "chunk_index": 0,
  "total_samples_received": 10010
}
```

**Binary 變體（效能優化）：**

```
POST /api/stream-chunk-binary
Content-Type: application/octet-stream
X-Session-Id: uuid-v4
X-Chunk-Index: 0
X-Start-Sample: 0
X-Gap-Indices: 2,57,203

[body: raw Float32 little-endian, 8 channels interleaved]
```

#### POST /api/finalize

**用途：** 結束串流，觸發分析。

**Request：**

```json
{
  "session_id": "uuid-v4",
  "total_chunks": 36,
  "total_samples": 360360
}
```

**Response (200)：** 同 `POST /api/analyze` 的回應格式。

### 前端修改要點

```typescript
// useDevice.ts — 錄製迴圈改為分段 flush
const CHUNK_INTERVAL_SEC = 10;
const DISPLAY_WINDOW_SEC = 30;
const chunkBuffer: RecordedSample[] = [];

// BLE callback 中：
chunkBuffer.push(sample);

// 每 10 秒（或 chunkBuffer.length >= sampleRate * CHUNK_INTERVAL_SEC）：
await fetch('/api/stream-chunk', { method: 'POST', body: ... });
chunkBuffer.length = 0;  // 清空已上傳的 buffer

// recordSamplesRef.current 只保留最近 DISPLAY_WINDOW_SEC 供波形顯示：
if (recordSamplesRef.current.length > sampleRate * DISPLAY_WINDOW_SEC) {
  recordSamplesRef.current = recordSamplesRef.current.slice(-sampleRate * DISPLAY_WINDOW_SEC);
}
```

### Server 端儲存

```
data/
└── streams/
    └── {session_id}/
        ├── meta.json           # session metadata
        ├── chunk_000.bin       # raw Float32 binary
        ├── chunk_001.bin
        ├── ...
        └── gaps.json           # 所有 gap 位置的全域 index
```

分析時循序讀取所有 chunk，合併為連續陣列，gap 位置已被補零（或後續選擇插值）。

---

## 17. Packet Loss 偵測與補償機制

### 現況問題

目前 `wasm_api.rs` 偵測 serial number gap 後僅累加 `packets_lost` 計數器，
**不做任何補償**。錄製端（`useDevice.ts:244`）以 `+= 1/sampleRate` 遞增 timestamp，
假設每個收到的 packet 是連續的 — packet loss 導致時間軸被壓縮。

### 影響

| 問題 | 影響 |
|------|------|
| 時間軸壓縮 | 丟 N 個 packet → 後續所有 timestamp 偏移 N/sampleRate 秒 |
| 頻率分析偏差 | FFT/PSD 假設均勻取樣，gap 造成頻譜洩漏、假峰 |
| CSV 匯出不對齊 | timestamp 與牆鐘時間不一致，多設備同步時有問題 |
| 長時間累積 | 4 小時丟 0.1%（~14K packets）→ 時間偏移約 14 秒 |

### 補償方案

#### 層級 1：Rust parser 端補零（最小改動，Phase 1 實作）

在 `wasm_api.rs` 的 serial gap 偵測後，插入零值 packet 維持時間軸連續：

```rust
// wasm_api.rs — Step 3 修改
if let Some(serial) = packet.serial_number {
    if let Some(last) = self.last_serial {
        let expected = last.wrapping_add(1);
        if serial > expected {
            let gap = (serial - expected) as usize;
            self.packets_lost += gap as u32;
            // 補零：插入 gap 個全零 packet，標記為 interpolated
            for i in 0..gap {
                let zero_pkt = Self::make_zero_packet(
                    expected + i as u32,
                    self.num_channels,
                    true,  // is_interpolated flag
                );
                result.push(&zero_pkt);
            }
        }
    }
    self.last_serial = Some(serial);
}
```

**效果：** 時間軸不壓縮，gap 位置填零。下游分析可根據 `is_interpolated` flag 標記這些 epoch 為 artifact。

#### 層級 2：前端標記 gap 位置（Phase 1/4 實作）

錄製端記錄每個 gap 的位置和長度：

```typescript
// useDevice.ts — 錄製迴圈
interface GapRecord {
  sampleIndex: number;  // gap 開始的全域 sample index
  length: number;       // 丟失的 packet 數量
}
const gapRecords: GapRecord[] = [];

// 當 parser 回傳帶有 is_interpolated 的 packet：
if (pkt.isInterpolated) {
  gapRecords.push({ sampleIndex: totalSamples, length: 1 });
}
```

CSV 匯出時標記：

```csv
Timestamp,Serial,CH1,...,CH8,Event,Gap
0.001,1001,12.3,...,5.6,,
0.002,null,0.0,...,0.0,,GAP
0.003,1003,11.8,...,6.1,,
```

#### 層級 3：Server 端分析時 gap 感知（Phase 3 實作）

伺服器收到含 `gap_indices` 的數據後：

```rust
// server/src/analysis/mod.rs
fn analyze_with_gaps(
    samples: &[f32],
    channels: usize,
    gap_indices: &[usize],
    sample_rate: f64,
) -> AnalysisResult {
    // 1. 將 gap 位置的 epoch 標記為 artifact（不參與分析）
    // 2. 如果連續 gap > 0.5 秒 → 分段分析（split into segments）
    // 3. 短 gap（< 50ms）→ 線性插值取代零值
    // 4. 長 gap（≥ 50ms）→ 標記整個 epoch 為 rejected
    
    let mut valid_epochs = Vec::new();
    for (epoch_idx, epoch) in all_epochs.iter().enumerate() {
        let epoch_start = epoch_idx * epoch_len;
        let epoch_end = epoch_start + epoch_len;
        let has_gap = gap_indices.iter().any(|&g| g >= epoch_start && g < epoch_end);
        if !has_gap {
            valid_epochs.push(epoch);
        }
    }
    // 只用 valid_epochs 計算指標
}
```

### 實作優先順序

| 層級 | Phase | 工時 | 效果 |
|------|-------|------|------|
| 層級 1：Parser 補零 | Phase 1 | 0.5 天 | 修正時間軸壓縮、CSV 正確 |
| 層級 2：前端 gap 標記 | Phase 1/4 | 0.5 天 | gap 可見、可追蹤 |
| 層級 3：分析 gap 感知 | Phase 3 | 1 天 | 分析品質不受 packet loss 影響 |

**雲端版也需要層級 1+2。** 這不是離線版特有的問題，建議在 Phase 1（crate 重構）時一併修復。

---

## 18. 雲端版改進：OPFS 分段寫入 + Gap 插值

本節為**線上（雲端）版**的錄製架構改進，與離線版獨立，但可共用 gap 偵測與插值邏輯。

### 架構

```
BLE packet → recordSamplesRef（記憶體，僅保留最近 30 秒供波形顯示）
                ↓ 每 10 秒 flush
          Gap 偵測 + 插值
                ↓
          OPFS 追加寫入（Origin Private File System，瀏覽器磁碟）
                ↓ 錄製結束
          從 OPFS 讀回 → WASM 分析 / CSV 匯出
```

### OPFS 簡介

Origin Private File System 是瀏覽器提供的**沙箱檔案系統**，不需使用者授權、不顯示在檔案總管中。
資料寫入磁碟（非記憶體），容量受磁碟空間限制而非 JS heap。

**瀏覽器支援：** Chrome 86+、Firefox 111+、Safari 15.2+（涵蓋所有現代瀏覽器）

### 插值策略（每次 flush 前執行）

每 10 秒 flush 時，掃描 buffer 中的 serial number gap：

| Gap 長度（samples） | 對應時間（@1001Hz） | 處理方式 |
|---------------------|-------------------|---------|
| 1–30 | < 30 ms | **線性插值**（兩端鄰居取平均，逐 channel 獨立） |
| 31–100 | 30–100 ms | **補零** + 標記 `gap_flag = true` |
| > 100 | > 100 ms | **補零** + 標記 `gap_flag = true` + 記錄為 `segment_break` |

**為什麼短 gap 用線性插值、不用三次樣條：**
- 1–30 samples 的跨度 < 30ms，EEG 低頻成分（delta/theta/alpha）在此尺度近乎線性
- 線性插值計算量為 O(gap × channels)，對 8 channels 可忽略
- 三次樣條需要更多鄰居點且增加複雜度，對 < 30ms gap 收益極小
- 高頻成分（beta/gamma）在任何插值下都會失真，但 < 30ms gap 影響的 epoch 佔比極小

### 實作細節

#### 18.1 OPFS 管理 service

```typescript
// web/src/services/opfsRecorder.ts

interface ChunkMeta {
  index: number;
  startSample: number;
  sampleCount: number;
  gapCount: number;
  segmentBreaks: number[];  // 全域 sample index of breaks > 100ms
}

class OpfsRecorder {
  private dir: FileSystemDirectoryHandle | null = null;
  private writer: FileSystemWritableFileStream | null = null;
  private chunkIndex = 0;
  private totalSamples = 0;
  private meta: ChunkMeta[] = [];
  private lastSerial: number | null = null;

  async init(sessionId: string) {
    const root = await navigator.storage.getDirectory();
    this.dir = await root.getDirectoryHandle(sessionId, { create: true });
  }

  /**
   * 接收一批 samples，偵測 gap 並插值/補零，
   * 然後以 Float32 binary 追加寫入 OPFS。
   */
  async flushChunk(samples: RecordedSample[]): Promise<ChunkMeta> {
    const filled = this.fillGaps(samples);
    const flat = this.flatten(filled);

    const file = await this.dir!.getFileHandle(
      `chunk_${String(this.chunkIndex).padStart(4, '0')}.bin`,
      { create: true }
    );
    const writer = await file.createWritable();
    await writer.write(flat.buffer);
    await writer.close();

    const meta: ChunkMeta = {
      index: this.chunkIndex,
      startSample: this.totalSamples,
      sampleCount: filled.length,
      gapCount: filled.filter(s => s._interpolated || s._zeroed).length,
      segmentBreaks: [],  // 填入 > 100 sample gap 的位置
    };
    this.meta.push(meta);
    this.totalSamples += filled.length;
    this.chunkIndex++;
    return meta;
  }

  /**
   * Gap 偵測 + 插值/補零
   */
  private fillGaps(samples: RecordedSample[]): RecordedSample[] {
    const result: RecordedSample[] = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.serialNumber != null && this.lastSerial != null) {
        const expected = (this.lastSerial + 1) & 0xFFFFFFFF;  // wrapping
        const gap = s.serialNumber - expected;
        if (gap > 0 && gap < 10000) {  // 合理範圍內的 gap
          if (gap <= 30) {
            // 線性插值：用前一筆和當前筆的 channel 值，逐 sample 線性內插
            const prev = result[result.length - 1];
            for (let g = 1; g <= gap; g++) {
              const t = g / (gap + 1);  // 0 < t < 1
              const interpCh = new Float32Array(s.channels.length);
              for (let ch = 0; ch < s.channels.length; ch++) {
                interpCh[ch] = prev.channels[ch] * (1 - t) + s.channels[ch] * t;
              }
              result.push({
                timestamp: 0,  // 後續重算
                serialNumber: expected + g - 1,
                channels: interpCh,
                _interpolated: true,
              });
            }
          } else {
            // 補零
            for (let g = 0; g < gap; g++) {
              result.push({
                timestamp: 0,
                serialNumber: null,
                channels: new Float32Array(s.channels.length),  // all zeros
                _zeroed: true,
              });
            }
          }
        }
      }
      if (s.serialNumber != null) this.lastSerial = s.serialNumber;
      result.push(s);
    }
    return result;
  }

  /**
   * 錄製結束：讀回所有 chunk 合併為連續 Float32Array
   */
  async readAll(): Promise<{ samples: Float32Array; meta: ChunkMeta[] }> {
    const chunks: ArrayBuffer[] = [];
    for (const m of this.meta) {
      const name = `chunk_${String(m.index).padStart(4, '0')}.bin`;
      const file = await this.dir!.getFileHandle(name);
      const f = await file.getFile();
      chunks.push(await f.arrayBuffer());
    }
    const totalBytes = chunks.reduce((s, c) => s + c.byteLength, 0);
    const merged = new Float32Array(totalBytes / 4);
    let offset = 0;
    for (const c of chunks) {
      merged.set(new Float32Array(c), offset);
      offset += c.byteLength / 4;
    }
    return { samples: merged, meta: this.meta };
  }

  /**
   * 清理 OPFS（錄製完成且分析結束後呼叫）
   */
  async cleanup() {
    if (!this.dir) return;
    const root = await navigator.storage.getDirectory();
    // removeEntry is recursive
    await root.removeEntry(this.dir.name, { recursive: true });
  }
}
```

#### 18.2 useDevice.ts 修改

```typescript
// 錄製迴圈改為分段 flush
const FLUSH_INTERVAL_SEC = 10;
const DISPLAY_WINDOW_SAMPLES = 30 * sampleRate;  // 30 秒

const opfsRef = useRef<OpfsRecorder | null>(null);
const flushBufferRef = useRef<RecordedSample[]>([]);

// 開始錄製時初始化 OPFS
const startRecording = async () => {
  const recorder = new OpfsRecorder();
  await recorder.init(`rec_${Date.now()}`);
  opfsRef.current = recorder;
  flushBufferRef.current = [];
  // ...existing start logic
};

// BLE callback 中（原 useEffect）：
flushBufferRef.current.push(sample);
// 只保留最近 DISPLAY_WINDOW 供波形顯示
recordSamplesRef.current.push(sample);
if (recordSamplesRef.current.length > DISPLAY_WINDOW_SAMPLES) {
  recordSamplesRef.current = recordSamplesRef.current.slice(-DISPLAY_WINDOW_SAMPLES);
}

// 每 10 秒 flush（新增 useEffect）：
useEffect(() => {
  if (!isRecording) return;
  const id = setInterval(async () => {
    if (flushBufferRef.current.length === 0) return;
    const chunk = flushBufferRef.current;
    flushBufferRef.current = [];
    await opfsRef.current?.flushChunk(chunk);
  }, FLUSH_INTERVAL_SEC * 1000);
  return () => clearInterval(id);
}, [isRecording]);

// 錄製結束：從 OPFS 讀回完整數據
const stopAndAnalyze = async () => {
  // flush 最後一段
  if (flushBufferRef.current.length > 0) {
    await opfsRef.current?.flushChunk(flushBufferRef.current);
    flushBufferRef.current = [];
  }
  const { samples, meta } = await opfsRef.current!.readAll();
  // 送入 WASM 分析（或離線版送 server）
  const result = await analyzeEeg(samples, ...);
  // 分析完成後清理 OPFS
  await opfsRef.current?.cleanup();
};
```

#### 18.3 同步顯示優化

將現有的全陣列拷貝：

```typescript
// 舊：每 2 秒淺拷貝整個陣列（百萬筆時 GC 爆炸）
setRecordedSamples([...recordSamplesRef.current]);
```

改為只同步 count + 保留環形 buffer：

```typescript
// 新：只更新計數，RecordView 從 ref 讀取（零拷貝）
const [sampleCount, setSampleCount] = useState(0);
useEffect(() => {
  if (!isRecording) return;
  const id = setInterval(() => setSampleCount(recordSamplesRef.current.length), 2000);
  return () => clearInterval(id);
}, [isRecording]);
```

波形顯示直接從 `recordSamplesRef.current` 讀取最後 N 秒，不觸發 React re-render 的全陣列拷貝。

### 容量與效能

| 項目 | 數值 |
|------|------|
| 記憶體佔用 | 恆定 ~3.2 MB（30 秒 display window） |
| OPFS 寫入速度 | ~8.6 MB/10s（JSON）或 ~1.4 MB/10s（binary） |
| 4 小時 OPFS 總大小 | ~2 GB（binary）或 ~12 GB（JSON） |
| OPFS 預設配額 | 磁碟剩餘空間的 ~60%（Chrome） |
| 分析時讀回速度 | ~500 MB/s（SSD，binary 格式） |

**建議使用 binary 格式（Float32 LE）寫入 OPFS**，JSON 格式在長時間錄製下會產生過大的檔案。

### 實作工時

| 項目 | 工時 |
|------|------|
| `OpfsRecorder` service | 1 天 |
| `useDevice.ts` flush 迴圈改寫 | 1 天 |
| Gap 偵測 + 線性插值 | 0.5 天 |
| 顯示同步優化（去掉全陣列拷貝） | 0.5 天 |
| 測試（gap 插值正確性、OPFS 讀寫、長時間穩定性） | 1 天 |
| **合計** | **4 天** |

---

## 附錄 A：Server Cargo.toml 完整依賴清單

```toml
[package]
name = "sgimacog-server"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "sgimacog-server"
path = "src/main.rs"

[dependencies]
axum = "0.7"
axum-server = { version = "0.6", features = ["tls-rustls"] }
tokio = { version = "1", features = ["full"] }
tower = "0.4"
tower-http = { version = "0.5", features = ["cors", "compression-gzip"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rust-embed = "8"
rusqlite = { version = "0.31", features = ["bundled"] }
rcgen = "0.13"
rustls = "0.22"
sha2 = "0.10"
hmac = "0.12"
hex = "0.4"
mac_address = "1"
sysinfo = "0.30"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
steeg-wasm = { path = "../crate" }

[profile.release]
strip = true
lto = true
codegen-units = 1
opt-level = 3
panic = "abort"
```

## 附錄 B：Workspace Cargo.toml

```toml
# sgimacog-web/Cargo.toml (workspace root)
[workspace]
members = ["crate", "server"]
resolver = "2"
```

---

## 關鍵實作檔案參照

| 檔案 | 重點 |
|------|------|
| `crate/src/wasm_api.rs` | 所有 `#[wasm_bindgen]` 匯出，需加 feature gate |
| `crate/src/eeg_analysis.rs` | `analyze_eeg_internal()`（核心分析）、`result_to_json()` — server 直接呼叫 |
| `web/src/services/eegReport.ts` | `analyzeEeg()` 為離線模式分支點 |
| `web/src/services/wasm.ts` | WASM 載入邏輯，離線版僅需 parser 部分 |

---

**文件版本：** v1.2
**建立日期：** 2026-04-12
**基於 sgimacog-web：** v0.6.0
