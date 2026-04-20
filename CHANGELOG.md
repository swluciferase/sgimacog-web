# sgimacog-web 開發記錄

## 版本總覽

| 版本 | Commit | 主要內容 |
|------|--------|---------|
| v1.2.0 | (pending) | CCA 偽影移除正式套用於所有報告生成流程（即時量測與離線 CSV）；移除未連線的 UI toggle |
| v1.1.2 | (pending) | EnTP 改用 Sample Entropy (m=2, r=0.2·SD, 降採樣 4× ≈250 Hz)，與常模一致 |
| v1.1.1 | 5c97b7b | Alpha 功率帶積分加入端點線性內插；移除 COH 二次 sqrt 與 EnTP 誤加 sqrt |
| v0.5.8 | d09be38 | 能力指標演算法升級至 v2 Utility Score 轉換 |
| v0.5.7 | 65de1d9 | EEG 分析管線與常模資料編譯入 WASM；PDF 報告新增五分層說明與能力條形圖 |
| v0.5.5 | 647b775 | 讀取 CSV 報告加入 DOB 欄位、修正 resize 後波形游標偏移 |
| v0.5.4 | 0793a3e | CCA whitening 矩陣 bug 修正、COH T 分數取整數 |
| v0.5.3 | 9f08c09 | 移除 FFT 面板重複的 BP/Notch 控制項 |
| v0.5.2 | 171f610 | Signal+FFT 合併版面、COH T 分數轉換公式修正、CCA 穩定性改善 |
| v0.5.1 | 51b7153 | 版號更新 |
| v0.5.0 | fed696a | 讀取 CSV 生成報告功能 |
| v0.4.x | 7fbbb53 | CCA 偽影移除選項、COH sqrt 轉換 |
| v0.3.3 | 0a61572 | 裝置序號修正、FFT 直方圖、標記自動清除、時間軸、幅度標記 |
| v0.3.2 | 74b0b60 | 10 項 bug 修正（阻抗、掃描游標、事件標記、品質切換、出生日期、版號） |
| v0.3.1 | e152ce7 | 統一連線對話框、跨分頁配對、COM port 釋放 |
| v0.3.0 | 672717b | FTDI 掃描、掃描式波形、品質指標、阻抗 N/A、頁籤互斥 |
| v0.2.0 | 6846196 | Header 顯示版本號 |
| v0.1.x | 初始版本 | 初始提交、GitHub Pages 部署 |

---

## v0.5.8 — 2026-04-06

### 能力指標演算法升級至 v2：Utility Score 轉換

**背景：** v0.5.7 的能力指標使用線性 `adj(t) = 100 - t` 反轉，忽略了各指標的「最佳區間」特性——例如 TBR 不是越低越好（過低代表過度緊繃），PAF 適中才理想，並非越高越好。

**核心改動（`capability.rs`、`reportPdf.ts`）：**

每個 T 分數先透過 `utility_score()` 函式轉換為品質分數（0–100），再做加權合成：

| 指標 | 模式 | 理想值 | 說明 |
|------|------|--------|------|
| TBR, RSA | `low_is_better` | ~30 | T<30 有輕微懲罰（過低亦非好），T>30 線性遞減 |
| FAA, APR | `high_is_better` | ~70 | 線性上升至 70，超過 70 有懲罰（過高表示過激) |
| PAF, COH, EnTP | `centered` | 50 | 高斯鐘形，σ=22，對稱衰減 |
| COH_inv | `centered(100−COH)` | — | 創意/應變維度專用：COH 越低越有利 |

**Utility score 公式：**
```
centered:       100 × exp(−(t−50)² / (2×22²))
high_is_better: t≤70 → 100×(t/70)；t>70 → 100−(t−70)×1.5
low_is_better:  t≥30 → 100×(1−(t−30)/70)；t<30 → 100−(30−t)×1.5
```

**capBar 修正：** 條形圖寬度除數從 99 改為 100（符合 utility score 0–100 範圍）。

**版本：** crate `0.1.0 → 0.2.0`，web `0.5.7 → 0.5.8`

---

## v0.5.7 — 2026-04-06

### EEG 分析管線與常模資料編譯入 WASM（IP 保護）

**動機：** 原本分析演算法與常模資料全在 TypeScript 明文，任何人開啟 DevTools 均可複製。改為 Rust 編譯進 WASM binary，JS 層只剩薄薄的包裝器。

**新增 Rust 模組：**

#### `crate/src/eeg_analysis.rs`（全新，~650 行）

完整 EEG 分析管線：

| 步驟 | 實作 |
|------|------|
| 資料驗證 | 至少需 8 通道 × 3 秒（3003 樣本） |
| Epoch 切割 | 2 秒非重疊窗（2002 樣本）× 8 通道 |
| 偽影移除 | IQR 法：超出 1.5×IQR 的 epoch 捨棄（最多保留 80%） |
| FFT | Cooley-Tukey 原地 FFT + Hann 窗 |
| Band power | δ 1–4 Hz、θ 4–8 Hz、α1 8–10 Hz、α2 10–13 Hz、β1 13–20 Hz、β2 20–30 Hz |
| IIR 濾波 | 2 階 Butterworth（50 Hz Notch 用 band-stop，帶通用串聯） |
| 7 項指標 | TBR、APR、FAA、PAF、RSA、COH（頻譜相干）、EnTP（排列熵） |
| T 分數 | 年齡分組常模，COH 特殊轉換 `√T × 10` |
| 序列化 | 手動 `format!()` JSON，不使用 serde（減小 binary） |

私有常模表（不對外公開）：
```rust
fn tbr_norm(age: u32) -> (f64, f64) { /* 依年齡分層 */ }
fn coh_norm(age: u32) -> (f64, f64) { /* ... */ }
// 全部 7 項指標各一組常模函式
```

#### `crate/src/capability.rs`（全新）

8 大能力指標加權公式，依年齡分三組（學生 7–24、職場 25–64、樂齡 65+），4–6 歲回傳 `None`。

**WASM API 新增（`wasm_api.rs`）：**
```rust
#[wasm_bindgen]
pub fn analyze_eeg(samples_flat: &[f32], age: u32) -> String
```
輸入：`Float32Array`（row-major，`[sample × 8 + ch]`，µV）
輸出 JSON：
```json
{
  "indices": {"TBR":…, "APR":…, "FAA":…, "PAF":…, "RSA":…, "COH":…, "EnTP":…},
  "tscores": {"TBR":…, …},
  "capability": {"專注持久力":…, …},
  "age":…, "cleanEpochs":…, "totalEpochs":…, "durationSec":…
}
```

**TypeScript 端改寫（`eegReport.ts`）：**

原本 500+ 行演算法全部移除，改為薄包裝器：
```ts
const jsonStr = wasmService.api.analyze_eeg(flat, age);
return JSON.parse(jsonStr) as ReportResult;
```
`ReportResult` 新增 `capability: Record<string, number>` 欄位。

**PDF 報告強化（`reportPdf.ts`）：**

- 每項指標新增五分層詳細解說（`tiers: Record<Tier, string>`）
- 8 大能力指標水平條形圖（綠/橘/紅依分數著色）
- 原始值改為小數點後 2 位
- 移除 T 分數五分層參照表
- 能力指標備援：若 WASM 未提供，TS 端以同公式計算

**架構異動（`lib.rs`）：**
```rust
pub mod eeg_analysis;
pub mod capability;
```

---

## v0.5.5 — 2026-03-31

### 1. 讀取 CSV 生成報告加入生日輸入 (RecordView.tsx)

**問題：** 「讀取 CSV 生成報告」卡片中呼叫 `analyzeEeg` 時傳入空字串 DOB，導致年齡預設為 25 歲，無法正確計算 T 分數。

**修正：**
- 新增 `fileDob` state（`useState('')`）
- 在 file report 卡片內加入 `<input type="date">` 欄位（標籤：出生年月日 / Date of Birth）
- `handleFileReport` 改為傳入 `fileDob` 給 `analyzeEeg(parsed.samples, fileDob, useArtifactRemoval)`

---

### 2. 修正調整視窗大小後波形游標偏移 (WaveformView.tsx)

**問題：** 調整視窗大小後，掃描游標（白色垂直線）的視覺位置與 WebGL 實際繪製位置不一致，兩者「速度」看起來不同。

**根本原因：** `WebglPlot.clear()` 的實作只執行 `gl.clear(COLOR_BUFFER_BIT)`，並不更新 WebGL viewport。`ResizeObserver` 呼叫 `resizeCanvas()` 更新 `canvas.width/height` 後，WebGL viewport 仍停留在舊尺寸，導致 GL 渲染被壓縮至舊寬度區域，而 CSS 百分比定位的游標 div 則正確跟隨容器新寬度。

**修正：** 在 ResizeObserver 回呼中，於 `resizeCanvas()` 後補充呼叫：
```ts
const gl = wglp.gl as WebGL2RenderingContext;
gl.viewport(0, 0, canvas.width, canvas.height);
```

---

## v0.5.4 — 2026-03-31

### 1. 修正 CCA whitening 矩陣演算法錯誤 (eegArtifactRemoval.ts)

**問題：** CCA 偽影移除效果極差，幾乎所有訊號成分均被移除。

**根本原因：** 白化矩陣計算使用了 `cholSolveM`（forward + backward substitution = $\mathbf{C}_{xx}^{-1}$），導致：
$$\mathbf{A} = \mathbf{C}_{xx}^{-1} \mathbf{C}_{sym} \mathbf{C}_{xx}^{-1}$$

而正確應為：
$$\mathbf{A} = \mathbf{L}^{-1} \mathbf{C}_{sym} \mathbf{L}^{-T}$$

錯誤的 $\mathbf{A}$ 使所有特徵值趨近於零，lag-1 自相關全部低於 0.9 閾值，全數被判定為肌肉雜訊。

**修正：** 移除 `cholSolveM`，新增 `fwdSolveM`（僅 forward substitution），重寫白化計算：
```ts
// 修正前（錯誤）
const B  = cholSolveM(L, Csym);   // L^{-T} L^{-1} Csym = Cxx^{-1} Csym
const AT = cholSolveM(L, mt(B));
const A  = mt(AT);                 // → Cxx^{-1} Csym Cxx^{-1}

// 修正後（正確）
const C1 = fwdSolveM(L, Csym);    // L^{-1} Csym
const A  = fwdSolveM(L, mt(C1));  // L^{-1} Csym L^{-T}
```

逆混矩陣改為解析式 $\mathbf{W}^{-1} = \mathbf{V}_s^T \mathbf{L}^T$，數值穩定。

### 2. COH T 分數取整數

**修正：** COH T 分數計算加入 `Math.round()`，確保為整數：
```ts
COH: Math.round(Math.sqrt(Math.max(0, toTScore(COH, cohNorm(age)))) * 10),
```

---

## v0.5.3 — 2026-03-31

### 移除 FFT 面板重複的 BP/Notch 控制項 (FftView.tsx)

**背景：** Signal 與 FFT 合併為同一頁面後，濾波參數由 WaveformView 統一控制，FftView 的 BP/Notch UI 變為重複。

**修正：**
- `FftViewProps` 移除 `onFilterChange` prop
- FFT 工具列移除帶通切換、HP/LP 輸入、Notch 按鈕
- 工具列僅保留 Y 軸範圍選擇器與最大頻率選擇器

---

## v0.5.2 — 2026-03-31

### 1. Signal + FFT 合併為同一頁面 (App.tsx, Sidebar.tsx)

**修改：** `signal` 與 `fft` 頁籤合併顯示，左側 2/3 為 WaveformView，右側 1/3 為 FftView。側邊欄移除獨立的 FFT 頁籤項目。

```tsx
case 'signal':
case 'fft':
  return (
    <div style={{ display: 'flex', height: '100%', gap: 8, overflow: 'hidden' }}>
      <div style={{ flex: 2, minWidth: 0 }}>
        <WaveformView ... />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <FftView ... />
      </div>
    </div>
  );
```

### 2. COH T 分數轉換公式

**修正：** COH raw 值（0–1 尺度）先計算線性 T 分數，再套用 $\sqrt{T} \times 10$：

```ts
COH: Math.sqrt(Math.max(0, toTScore(COH, cohNorm(age)))) * 10
```

常模回歸原始 0–1 尺度：`{mean: 0.35/0.55/0.65, sd: 0.1}`（依年齡）

### 3. CCA 穩定性改善

- `BLINK_DELTA_THR`：0.50 → 0.65
- `BLINK_PEAK_FACTOR`：4.0 → 6.0
- 眨眼偵測縮限至前 2 個成分（原為 3 個）
- 新增 RMS 守門：`if (rms(comp) < 0.1) continue`

---

## v0.5.0–0.5.1 — 2026-03-31

### CCA 偽影移除 + 報告功能初版

**新增 `eegArtifactRemoval.ts`：** 滑動視窗 CCA 偽影移除（De Clercq 2006）。

**新增 `eegReport.ts`：** 7 項腦健康指標（TBR/APR/FAA/PAF/RSA/COH/EnTP）+ T 分數計算。

**新增 `reportPdf.ts`：** 使用 jsPDF 生成 PDF 報告。

**RecordView.tsx 新增：**
- 「停止並生成報告」按鈕
- 讀取 CSV 文件生成報告
- CCA 開關（`useArtifactRemoval` toggle）

---

## v0.3.3 — 2026-03-30

### 1. 裝置序號統一為 STEEG\_DG\#\#\#\#\#\# (App.tsx)

**問題：** WebUSB 授權新裝置可以找到正確序號 `STEEG_DG085134`，但連線後 Header 顯示的是 machineInfo 回傳的 `STEEG_AV0KHCQP`。

**原因：** Race condition — machineInfo packet 在 `getAuthorizedFtdiDevices()` 非同步回傳前就先抵達，設定了 `deviceIdSeenRef.current = true`，導致 WebUSB 效果的覆寫被跳過。

**修正：** 移除 WebUSB useEffect 中的 `!deviceIdSeenRef.current` 保護，WebUSB serial 永遠優先覆寫；machineInfo 僅作為 WebUSB 無裝置時的後備。

```tsx
// 修正前
if (devices.length >= 1 && devices[0]?.serialNumber && !deviceIdSeenRef.current) {

// 修正後
if (devices.length >= 1 && devices[0]?.serialNumber) {
```

---

### 2. 阻抗 < 10 kΩ 顯示為 N/A (ImpedanceView.tsx)

**問題：** 空接電極時阻抗公式在 AC amplitude 接近 0 時仍輸出 ~5.5 kΩ（公式常數項）而非 N/A。

**修正：** 加入 `LOW_IMPEDANCE_NA_KOHM = 10` 常數，`isNoSignal` 條件增加 `impedanceKohm < 10` 的判斷（SVG 與 channel card 兩處同步更新）。

```tsx
const isNoSignal = result !== undefined && (
  (result.acAmplitude ?? 0) < NO_SIGNAL_AMPLITUDE_UV ||
  result.impedanceKohm < LOW_IMPEDANCE_NA_KOHM   // 新增
);
```

---

### 3. 事件標記在畫面刷新後自動消除 (WaveformView.tsx)

**問題：** 掃描游標繞完一圈後，舊的事件標記仍留在畫面上，顯示在已被新資料覆蓋的位置。

**修正：**
- 加入 `totalSweepRef`（單調遞增樣本計數器）與 `lappedMarkersRef`（已繞過的標記 Set）
- `EventMarker` 介面新增 `totalSweep: number` 欄位
- rAF loop 中：當 `totalSweepRef.current - marker.totalSweep >= windowPoints` 時，將標記加入 `lappedMarkersRef` 並設 opacity = 0

```tsx
// EventMarker 介面
export interface EventMarker {
  id: string;
  time: number;
  label: string;
  sweepPos: number;
  totalSweep: number;  // 新增
}

// rAF loop 判斷
if (nowTotal - marker.totalSweep >= windowPoints) {
  lappedMarkersRef.current.add(marker.id);
}
```

---

### 4. 即時時間標記（每秒，系統時間）(WaveformView.tsx)

**功能：** 在波形顯示底部加入每秒的系統時間標籤（`HH:MM:SS`），讓使用者可以對照錄製時的即時時刻。

**實作：**
- 預建 20 個 `<div>` DOM 元素（`MAX_TIME_TICKS = 20`），透過 `timeLabelDivsRef` 管理
- rAF loop 每幀計算每個整秒的掃描位置並更新 `style.left` 與 `textContent`
- 位置公式：`(sweepPos - k × SAMPLE_RATE_HZ + windowPoints×N) % windowPoints`

---

### 5. 各 Channel 幅度標記 (WaveformView.tsx)

**功能：** 在左側 channel 標籤欄（從 56px 加寬至 64px）每個 channel 列的中央右側顯示 `±幅度` 縮寫（如 `±100`、`±1m`、`±50m`），隨 Scale 選擇器即時更新。

```tsx
const formatAmp = (uv: number): string => {
  if (uv >= 500000) return '±500m';
  if (uv >= 50000)  return '±50m';
  if (uv >= 5000)   return '±5m';
  if (uv >= 1000)   return '±1m';
  if (uv >= 500)    return '±500';
  if (uv >= 200)    return '±200';
  if (uv >= 100)    return '±100';
  if (uv >= 50)     return '±50';
  return `±${uv}`;
};
```

---

### 6. FFT 頻譜改為 8 個獨立直方圖面板 (FftView.tsx)

**完全重寫。** 舊版為單一 canvas 8 條疊圖折線；新版為 2 欄 × 4 列 CSS Grid，每個 channel 各自一個 bar chart。

**面板佈局：**
```
左欄（index 0,2,4,6）  右欄（index 1,3,5,7）
Fp1                    Fp2
T7                     T8
O1                     O2
Fz                     Pz
```

**新增功能：**
- FFT size 選擇器：256 / 512 / 1024 / 2048（影響頻率解析度）
- 每個面板獨立 canvas + ResizeObserver
- `drawPanelHistogram()` 函式：EEG band 背景色帶、直方圖 bar、頻率軸標籤、channel 名稱
- `computePsdWithSize()` 取代舊有的硬編碼 `FFT_SIZE = 1024` 版本
- bar 數量自動分組（每組最多佔 80 bars）

```
頻率解析度 = SAMPLE_RATE_HZ / FFT_SIZE
FFT 256  → 3.91 Hz/bin
FFT 512  → 1.95 Hz/bin
FFT 1024 → 0.97 Hz/bin（預設）
FFT 2048 → 0.49 Hz/bin
```

---

## v0.3.2 — 2026-03-30

修正 10 項 bug：

| # | 問題 | 修正 |
|---|------|------|
| 1 | 裝置序號顯示「未知」 | 連線後查詢 WebUSB serial，prefixed `STEEG_` |
| 2 | 清除裝置清單按鈕 | ConnectModal 新增「清除所有裝置授權」按鈕，呼叫 `forgetAllFtdiDevices()` + `forgetAllFtdiPorts()` + `clearRegistry()` |
| 3 | 掃描式波形無更新游標 | `sweepCursorRef` DOM div，rAF 每幀更新 `style.left` |
| 4 | 事件標記向左移動 | 改存 `sweepPos` 取代 `samplesAgo`，標記固定在當下掃描位置 |
| 5 | 錄製時可開啟阻抗 | `handleEnterImpedance` 加入 `if (isRecording) return`；ImpedanceView button disabled |
| 6 | 阻抗公式錯誤 | WASM `enable_impedance(config.impedanceWindow, config.sampleRate)` 修正（舊為兩個 sampleRate）；質量閾值改 150/300/600 kΩ |
| 7 | 品質切換在錄製中被鎖定 | 移除 quality toggle 的 `disabled={isRecording}` |
| 8 | 目標時長顯示格式 | 選項改為純數字 + `(S)` 後綴 |
| 9 | 年齡欄位改為出生年月日 | `SubjectInfo.age` → `SubjectInfo.dob`；使用 `<input type="date">` |
| 10 | 版號未更新 | 版本號改為 `0.3.2`（建立版號管理規範） |

---

## v0.3.1 — 2026-03-30

### 統一連線對話框

**新增 `ConnectModal.tsx`：**
- 自動掃描 WebUSB FTDI 裝置並列出序號
- 跨分頁配對狀態（Paired badge）—— 已在其他分頁連線的裝置標示紅色
- 「授權新裝置」按鈕（WebUSB requestDevice）
- 「清除所有裝置授權」按鈕
- 「連線」邏輯：1 個已授權 port → 直接開啟；多個 → 顯示瀏覽器選擇器；0 個 → 也顯示選擇器

### 跨分頁裝置登錄 `deviceRegistry.ts`

| 機制 | 實作 |
|------|------|
| 分頁識別 | `sessionStorage` 儲存隨機 `tabId` |
| 即時通知 | `BroadcastChannel('sgimacog_devices')` |
| 持久化 | `localStorage('sgimacog_device_registry')` JSON |
| 心跳 | 每 4s 更新 timestamp；超過 12s 視為 stale |

```
registerConnected(steegId?)   // 連線後呼叫
updateRegistrySteegId(id)     // 收到 machineInfo 後更新
registerDisconnected()        // 斷線 / beforeunload 時清除
getOtherTabDevices()          // 取得其他分頁的連線資訊
clearRegistry()               // 清除所有記錄
```

### COM Port 釋放

`SerialService.disconnect()` 呼叫 `port.close()` 後，port 釋放給其他分頁使用。`port.forget()` 在「清除授權」時呼叫（`forgetAllFtdiPorts()`）。

---

## v0.3.0 — 較早版本

- 新增 WebUSB FTDI 掃描（`ftdiScanner.ts`）
- 掃描式（sweep）波形顯示取代捲動式
- 即時品質指標（`useQualityMonitor.ts`）：2 秒視窗 STD、有效時間、自動停止
- 阻抗 N/A 顯示（無訊號電極）
- 頁籤互斥邏輯（阻抗量測 ↔ 訊號檢視）

---

## 技術架構

```
sgimacog-web/
├── crate/                    # Rust/WASM
│   └── src/
│       ├── lib.rs            # 模組宣告
│       ├── wasm_api.rs       # WASM 匯出（SteegParser、analyze_eeg 等）
│       ├── eeg_analysis.rs   # EEG 分析管線 + 常模資料（編譯進 binary）
│       ├── capability.rs     # 8 大能力指標公式
│       └── impedance.rs      # 阻抗計算、品質分類
└── web/                      # React + TypeScript 前端
    └── src/
        ├── App.tsx           # 主元件、狀態管理、連線邏輯
        ├── types/
        │   └── eeg.ts        # EegPacket, ImpedanceResult, SubjectInfo 等型別
        ├── services/
        │   ├── serial.ts     # Web Serial API 封裝
        │   ├── ftdiScanner.ts # WebUSB FTDI 裝置掃描
        │   ├── deviceRegistry.ts # 跨分頁裝置登錄
        │   ├── wasm.ts       # WASM 模組載入
        │   └── csvWriter.ts  # EDF/CSV 輸出
        ├── hooks/
        │   ├── useEegStream.ts    # 封包解碼串流
        │   └── useQualityMonitor.ts # 訊號品質監控
        ├── components/
        │   ├── layout/
        │   │   ├── Header.tsx
        │   │   └── Sidebar.tsx
        │   ├── views/
        │   │   ├── HomeView.tsx
        │   │   ├── ImpedanceView.tsx   # 10-20 系統電極圖
        │   │   ├── WaveformView.tsx    # WebGL 掃描式 EEG
        │   │   ├── FftView.tsx         # 8 頻譜直方圖面板
        │   │   └── RecordView.tsx      # 錄製設定與品質監控
        │   └── modals/
        │       └── ConnectModal.tsx    # 裝置連線對話框
        └── i18n.ts           # 中英文字串
```

### 阻抗公式

```
AC 幅度 (µV) → 阻抗 (kΩ)
f(amp) = (5e-11×amp⁴ - 1e-6×amp³ + 0.0129×amp² + 129.73×amp + 5520.2) × 0.001

N/A 條件：
  - acAmplitude < 0.5 µV（無 AC 訊號）
  - impedanceKohm < 10 kΩ（公式常數項誤差，空接判定）

品質等級：
  < 150 kΩ → 優秀 (excellent)  🟢
  < 300 kΩ → 良好 (good)       🟢
  < 600 kΩ → 尚可 (poor)       🟡
  ≥ 600 kΩ → 不良 (bad)        🔴
```

### 訊號品質監控

```
每 2 秒（non-overlapping window）計算 8 通道 STD
threshold（靈敏度）：
  嚴格: 10–30 µV
  標準: 20–60 µV
  寬鬆: 40–120 µV

goodTimeSec = goodWindowCount × 2
shouldAutoStop = (goodTimeSec >= targetDurationSec) && enabled
```

### FFT 頻率解析度

```
bin 寬度 = SAMPLE_RATE_HZ / FFT_SIZE = 1001 / FFT_SIZE

FFT 256  → 3.91 Hz/bin  （快速更新，低解析度）
FFT 512  → 1.95 Hz/bin
FFT 1024 → 0.97 Hz/bin  （預設）
FFT 2048 → 0.49 Hz/bin  （高解析度，需更多資料緩衝）

更新間隔：250 ms（4 Hz）
```

---

## 技術文件

- `docs/algorithm_report.md` — EEG 演算法技術報告（CCA + 7 項指標計算方式）

---

*最後更新：2026-04-06*
