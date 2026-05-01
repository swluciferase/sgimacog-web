# EEG Hardware Event Marker — Design Spec

**Date:** 2026-05-01
**Status:** Approved (brainstorm)
**Scope:** sgimacog-web (/eeg), NFB-Webapp (SoraMynd), poseidon
**Owner:** sgimacog-web (primary), then ported to SoraMynd + poseidon

---

## 1. Scope & Data Source

每個 EEG 封包中由 STEEG firmware 帶來的 1 byte event byte：

- TLV：`Tag ID = 7, Tag Length = 1, Data Type = unsigned 8-bit`
- 來源規範：STEEG data format v2.1（`Downloads/STEEG data format_v2.1.pdf`）
- Firmware 行為（已確認）：**edge / one-shot** — 平常 = 0，trigger 那一個 packet 才帶非 0 值，下一 packet 立即回 0
- 過濾規則：`event != null && event !== 0` → 視為一個事件

### 三 app 的現況

三 app 共用同一份 Rust crate（各自 fork 副本），protocol.rs 已 parse `TAG_EVENT` 進 `EegPacket.event: Option<u8>`。**只欠 WASM bridge → JS → UI / CSV** 這一段：

| 層 | sgimacog-web | NFB-Webapp | poseidon |
|----|--------------|------------|----------|
| `protocol.rs::TAG_EVENT` parse | ✅ 已存在 | ✅ 已存在 | ✅ 已存在 |
| `EegPacket.event: Option<u8>` (Rust) | ✅ 已存在 | ✅ 已存在 | ✅ 已存在 |
| `wasm_api.rs::packet_to_js` 輸出 event | ❌ 缺 | ❌ 缺 | ❌ 缺 |
| TS `EegPacket.event` 欄 | ❌ 缺 | ❌ 缺 | ❌ 缺 |
| UI 顯示 / CSV 儲存 | ❌ 缺 | ❌ 缺 | ❌ 缺 |

### 與既有 Software Marker 協定的關係

兩條獨立軌道：

- **Software marker**（既有）：來自 BroadcastChannel `'sigmacog-markers'` + window postMessage，由 THEMynd / VeloMynd 等認知測驗 app 發出。詳見 `~/.claude/.../memory/project_eeg_marker_protocol.md`。
- **Hardware marker**（本 spec）：來自 EEG 封包 TLV `Tag 7`。

兩者**互不干擾**。但本次會調整 CSV 欄位語意（§5），讓兩條軌道在 CSV 內各自佔獨立欄位。

---

## 2. WASM Interface (Rust ↔ JS)

### Rust 端

無需改 protocol.rs / types.rs。**僅改 `crate/src/wasm_api.rs::packet_to_js`**：

```rust
// 在 obj 上加：
let event_val = match packet.event {
    Some(v) => JsValue::from(v),
    None => JsValue::NULL,
};
let _ = Reflect::set(&obj, &"event".into(), &event_val);
```

放在 `machineInfo` 之後、`impedanceResults` 之前，維持順序穩定。

### JS 端 TS 型別

`web/src/types/eeg.ts`：

```ts
export interface EegPacket {
  // ... existing fields ...
  machineInfo: string | null;
  event: number | null;   // hardware event byte, 0..255 or null if absent in this packet
}
```

### 過濾位置

JS 層在 `useDevice.ts` 的 sample collection 迴圈做 `if (pkt.event != null && pkt.event !== 0)` 才視為事件。WASM 透傳所有值（含 0）以便 debug；不在 Rust 層做過濾。

### Rebuild

三個 crate 各自：
```bash
# sgimacog-web & NFB-Webapp
wasm-pack build crate --target bundler --out-dir web/src/pkg

# poseidon — 依該 repo 既有 build script 慣例
```

---

## 3. 多裝置同步邏輯（Local vs Broadcast）

### 控制 UI

`RecordView.tsx` 工具列加 checkbox：

> ☐ 硬體 marker 廣播至所有錄製中的裝置

預設 OFF（Local 模式）。狀態存在 RecordView 本地 state，不持久化、每次重開預設 OFF。錄製中可即時切換。

### Local 模式（預設）

Device A 收到 `event !== 0`：
1. 寫進 device A 的 `recordSamplesRef`（CSV 用）
2. 加進 device A 的右側 marker 列表
3. dispatch `'hardware-marker-visual'` CustomEvent，detail = `{ value, deviceId: 'A', timestamp }`

WaveformView listener 加 deviceId 過濾 → 只有 device A 的波形畫綠色實線。

### Broadcast 模式

Device A 收到 `event !== 0`：
1. 同 Local 模式步驟 1–3（自己照記）
2. **額外** dispatch `'hardware-marker-broadcast'` CustomEvent，detail = `{ value, originDeviceId: 'A', originWallclock }`

其他 device 的 `useDevice` hook 監聽此事件：
- **過濾自己**：`if (originDeviceId === ownDeviceId) return;`（source 已經在步驟 1–3 自己記過，不重複）
- 在自己 `pendingHardwareMarkerRef` 設下值（含 `value`），**同時** `pendingHardwareWallclockRef` 儲存 `originWallclock`
- **下一個收到的 sample**（用 receiver 自己封包時間軸的 `Timestamp`）寫入該值（type=hardware）並走步驟 1–3 流程
- 自己的 deviceId 標自己（不是 originDeviceId）

→ 4 個 WaveformView 各自畫線、4 個 device CSV 都有同一筆 hardware event。

**Option B — Event Date / Timestamp 語意分離（跨裝置 CSV 對齊）：**
- **`Event Date`** 反映**事件來源裝置**的 wallclock（`originWallclock`，broadcast 模式跨裝置對齊用）——所有裝置的同一觸發事件，`Event Date` 欄位相同。
- **`Timestamp`** 維持**該 device 自己**的 packet 時間軸（訊號對齊用，各裝置獨立）。
- 實作：`RecordedSample.hardwareEventWallclock`；`csvWriter` 優先用該欄，無則 fallback 到 `startTime + timestamp * 1000`（向後相容舊錄音）。

### 邊界情況

- **Source 自己也記**：✅ 是（步驟 1–3 永遠跑）
- **同時兩台收到 trigger**（各自接實體線）：兩台各走 source 流程 → 其他兩台收到兩個 broadcast 事件 → 各別注入到下一個 / 下下一個 sample，**不去重**（極罕見、原始記錄真實反映）
- **Broadcast 模式但只有一台在錄**：source 一切照走，無其他 listener → 等同 local 行為

### 為何用 CustomEvent 而非 BroadcastChannel？

所有 useDevice 都在同一 tab 同一 React app 內，window CustomEvent 已足夠。BroadcastChannel 是跨 tab/origin 用（既有 software marker 用 BC 因 THEMynd 在另一 tab）。

---

## 4. UI — 波形垂直線 + 側欄列表

### WaveformView 改動

新增第二個 listener，與既有 `'themynd-marker-visual'` 並列：

```ts
useEffect(() => {
  const handler = (ev: Event) => {
    const ce = ev as CustomEvent<{ value: number; deviceId: string; timestamp: number }>;
    if (ce.detail.deviceId !== ownDeviceId) return;       // 來源過濾（多裝置防串台）
    const shouldFire = isFocused !== undefined
      ? isFocused
      : (canvasRef.current?.offsetParent !== null);
    if (!shouldFire) return;                               // 焦點過濾（沿用現有規則）
    drawHardwareMarkerVisualOnly(`H${ce.detail.value}`);
  };
  window.addEventListener('hardware-marker-visual', handler);
  return () => window.removeEventListener('hardware-marker-visual', handler);
}, [drawHardwareMarkerVisualOnly, isFocused, ownDeviceId]);
```

### 視覺差異

| 來源 | 顏色 | 樣式 | 標籤 |
|------|------|------|------|
| 軟體 marker（既有） | 紅色 `#e53935` | 虛線 | 現有 short label，如 `#1101` |
| 硬體 marker（新） | 綠色 `#43a047` | 實線 | `H{value}`，如 `H5` |

### 新增繪製函式

`drawHardwareMarkerVisualOnly(label)` — 與現有 `drawMarkerVisualOnly` 同結構，push 時帶 `kind: 'hardware'`；canvas 繪線階段依 kind 切顏色 / dash。

### EventMarker 型別擴充

```ts
interface EventMarker {
  id: string;
  time: number;
  label: string;
  sweepPos: number;
  totalSweep: number;
  kind?: 'software' | 'hardware';   // 新增，預設 'software' 向後相容
  deviceId?: string;                // 硬體 marker 用，軟體保持 undefined
}
```

### 右側列表（marker list）

軟體 marker 透過既有 `onEventMarker(...)` 進列表（不變）。硬體 marker 走相同管道：

- `useDevice.ts` 偵測 `pkt.event !== 0` 時 callback `onHardwareEventMarker({ value, deviceId, timestamp })`
- RecordView 轉發 `onEventMarker({ id, time, label: \`H${value}\`, kind: 'hardware', deviceId })`
- 列表 UI 依 kind 切顏色 / 圖示：
  - 軟體：紅標 + label
  - 硬體：綠標 + `H{value}` + deviceId 小標（多裝置時知道是哪台）

**Broadcast 模式列表行為**：source 列出時帶 source 自己的 deviceId；被廣播注入的其他台列出時帶**該台自己** deviceId（讓研究員看自己列表時自己台所有 marker 都在）。本次**不**標 origin。如未來需要看 origin，加 `originDeviceId` 欄位。

### ownDeviceId 來源

WaveformView 已從 props 接 `deviceId`（RecordView line 112 已傳）— 直接用，無新 prop。

---

## 5. CSV 寫入規則

### Header 不變

沿用 Cygnus v0.28.0.7 schema：

```
Timestamp,Serial Number,<channels>,Event Id,Event Date,Event Duration,Software Marker,Software Marker Name
```

### 欄位語意重新定義（核心變更）

| 欄位 | 改動前 | 改動後 |
|------|--------|--------|
| `Event Id` | 軟體 marker 數字 ID | **硬體 event byte 值**（1..255 整數字串） |
| `Event Date` | 軟體 marker wallclock | **硬體 marker wallclock** |
| `Event Duration` | 始終空 | 維持空（保留欄位以保容） |
| `Software Marker` | `"1"` 旗標 | **軟體 marker 數字 ID**（如 `"1101"`），無則空 |
| `Software Marker Name` | 軟體 marker label | 不變（無則空） |

### RecordedSample 型別調整

`csvWriter.ts`：

```ts
export interface RecordedSample {
  timestamp: number;
  serialNumber: number | null;
  channels: Float32Array;
  hardwareEvent?: number;           // 1..255, undefined when no event
  softwareMarkerId?: string;        // numeric ID as string (e.g. "1101")
  softwareMarkerName?: string;      // label string
}
```

舊 `eventId` / `eventName` rename + 拆兩組（hardware vs software）。同步改：
- `useDevice.ts` line 247–259（既有 software pendingMarker 注入點）
- `RecordView.tsx` 接收 BroadcastChannel marker 那段（line ~200）

### generateCsvRows 對應改寫

```ts
const eventId = sample.hardwareEvent != null ? String(sample.hardwareEvent) : '';
const eventDate = sample.hardwareEvent != null
  ? formatDatetime(new Date(startTime.getTime() + sample.timestamp * 1000)) : '';
const softwareMarker = sample.softwareMarkerId ?? '';
const softwareMarkerName = sample.softwareMarkerName ?? '';
```

### CSV Parser 向後相容

三 app 都有 `csvParser.ts`，要對齊：

- **舊 CSV** (改動前)：`Software Marker == "1"` → 把 `Event Id` 當 `softwareMarkerId`、`Event Date` 視為軟體事件時間
- **新 CSV**：`Software Marker` 為非空整數即為新格式
- Parser 加旗標判斷邏輯處理過渡期

---

## 6. 跨 App 一致性 與 部署

### 三 app 共用改動清單

| 檔案 | 改動 |
|------|------|
| `crate/src/wasm_api.rs::packet_to_js` | 加 `event` 欄輸出 |
| `web/src/types/eeg.ts` `EegPacket` | 加 `event: number \| null` |
| `web/src/services/csvWriter.ts` `RecordedSample` + `generateCsvRows` | 拆 hardware / software 兩組欄位（§5） |
| `web/src/services/csvParser.ts` | 新格式解析 + 舊格式相容旗標 |
| `web/src/hooks/useDevice.ts` | (1) 過濾 `pkt.event !== 0` (2) 寫 sample (3) dispatch `hardware-marker-visual` (4) Broadcast 模式 listen `hardware-marker-broadcast` + `pendingHardwareMarkerRef` 注入 |
| `web/src/components/views/WaveformView.tsx` | 加 `hardware-marker-visual` listener + deviceId 過濾 + 綠色實線 + `EventMarker.kind` |
| `web/src/components/views/RecordView.tsx` | (1) Broadcast toggle UI (2) `onHardwareEventMarker` callback → 列表 + dispatch broadcast |

### 部署順序

1. **sgimacog-web** 先做（dogfood、本次 owner）
2. 在 sgimacog 上對單裝置 + 4 裝置 broadcast 模式都驗過
3. 再 port 到 **NFB-Webapp** + **poseidon**（相同 patch、UI tweak）

### 驗收 Checklist

- [ ] 單裝置：trigger → 波形綠線 + 列表 + CSV `Event Id` 欄有值
- [ ] 4 裝置 Local 模式：device A 收 trigger → 只有 A 畫線、A CSV 有值；B/C/D 無
- [ ] 4 裝置 Broadcast 模式：device A 收 trigger → ABCD 都畫線、ABCD CSV 都有值（時間戳各自封包時間軸）
- [ ] Software marker（既有）：CSV `Software Marker` 欄是 ID、`Software Marker Name` 是 label
- [ ] 舊 CSV 可被新 parser 正確讀回
- [ ] 三 app 行為一致（除 UI tweak）

### 版號

- sgimacog-web v0.6.0 → **v0.7.0**（新功能 → MINOR +1）
- NFB-Webapp v0.7.2 → **v0.8.0**（新功能 → MINOR +1）
- poseidon v1.9.1 → **v1.10.0**（依 repo 慣例）

### Out of Scope

本 spec 不涵蓋：
- Software marker 跨 device 同步（既有 `themynd-marker-visual` 不加 deviceId 過濾） — 若需要，未來另開 spec
- Broadcast toggle 的 settings 持久化 — 預設每次重開 OFF，未來需要再加
- 硬體 marker 出現「相同值連續多 packet」的 latched firmware — 假設不會發生（spec §1 已確認 edge / one-shot）
- 側欄列表的 origin device 標示 — 未來 v2 視需要再加
