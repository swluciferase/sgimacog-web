# sgimacog-web EEG 演算法技術報告

**版本：** v0.5.5
**日期：** 2026-03-31
**適用檔案：**
- `web/src/services/eegArtifactRemoval.ts`
- `web/src/services/eegReport.ts`

---

## 一、整體流程

```
原始 EEG (8ch, 1001 Hz)
     │
     ├─ [可選] CCA 去除偽影  ←  eegArtifactRemoval.ts
     │
     ▼
頻帶通濾波 1.5–45 Hz (主分析) / 4–30 Hz (EnTP)
     │
     ▼
分 Epoch (2 s，步長 0.5 s，重疊 75%)
     │
     ▼
去除首尾各 2 個 epoch
     │
     ▼
壞 Epoch 移除 (IQR-based：std + peak-to-peak)
     │
     ▼
計算 7 項腦健康指標 (TBR / APR / FAA / PAF / RSA / COH / EnTP)
     │
     ▼
對照年齡常模 → T 分數 (1–99)
     │
     ▼
輸出 PDF 報告
```

---

## 二、CCA 偽影移除 (eegArtifactRemoval.ts)

### 2.1 演算法概述

基於 **De Clercq et al. 2006** 的 Canonical Correlation Analysis (CCA) 方法，目標是分解 EEG 訊號為數個成分，依自相關大小判斷是否為雜訊成分，去除後重建訊號。

### 2.2 前置濾波

對每個通道進行 **2 階 Butterworth 零相位帶通濾波 0.5–45 Hz**，採用 bilinear transform 實作，forward + backward 兩次 IIR 以達零相位。

### 2.3 滑動視窗 Overlap-Add

| 參數 | 值 |
|------|----|
| 視窗長度 (`WIN_SEC`) | 2.0 s |
| 步長 (`STEP_SEC`) | 0.5 s |
| 重疊比例 | 75% |
| 混合加權 | Hann 窗 |

對每個視窗獨立執行 CCA 分解，最後以 Hann 加權 overlap-add 重建整段訊號。

### 2.4 CCA 分解數學推導

設一個視窗內 $N$ 個時間點、$C$ 個通道，資料矩陣 $\mathbf{X} \in \mathbb{R}^{N \times C}$（已去均值）。

#### (1) 計算協方差矩陣

$$\mathbf{C}_{xx} = \frac{1}{N-1} \mathbf{X}_{1:N-1}^T \mathbf{X}_{1:N-1}$$

$$\mathbf{C}_{sym} = \frac{1}{2(N-1)} \left( \mathbf{X}_{1:N-1}^T \mathbf{X}_{2:N} + \mathbf{X}_{2:N}^T \mathbf{X}_{1:N-1} \right)$$

其中 $\mathbf{C}_{sym}$ 為 lag-1 對稱互協方差（即最大化延遲一步的自相關）。

#### (2) 正則化

$$\mathbf{C}_{xx} \leftarrow \mathbf{C}_{xx} + \frac{\text{tr}(\mathbf{C}_{xx})}{C} \times 10^{-5} \cdot \mathbf{I}$$

#### (3) Cholesky 分解

$$\mathbf{C}_{xx} = \mathbf{L} \mathbf{L}^T$$

#### (4) 白化對稱廣義特徵值問題

CCA 的廣義特徵值問題為：

$$\mathbf{C}_{sym} \mathbf{w} = \lambda \, \mathbf{C}_{xx} \mathbf{w}$$

透過白化轉換為標準對稱特徵值問題：

$$\mathbf{A} = \mathbf{L}^{-1} \mathbf{C}_{sym} \mathbf{L}^{-T}$$

計算步驟：
```
C1 = fwdSolveM(L, Csym)       ← L^{-1} * Csym  (forward substitution only)
A  = fwdSolveM(L, C1^T)       ← L^{-1} * Csym * L^{-T}
```

> **關鍵注意事項：** 此處只做 forward substitution，不做 backward substitution。
> 若誤用完整 Cholesky solve（fwd + bwd）= $\mathbf{C}_{xx}^{-1}$，
> 則 $\mathbf{A} = \mathbf{C}_{xx}^{-1} \mathbf{C}_{sym} \mathbf{C}_{xx}^{-1}$ 而非正確的 $\mathbf{L}^{-1} \mathbf{C}_{sym} \mathbf{L}^{-T}$，
> 導致所有特徵值趨近於零，所有成分被判定為肌肉雜訊而全數去除。

#### (5) Jacobi 對稱特徵分解

對矩陣 $\mathbf{A}$ 進行 Jacobi 迭代（最多 $300 \times C$ 次），求特徵值 $\lambda_j$（近似 lag-1 自相關）和特徵向量 $\mathbf{V}$。

按 $\lambda_j$ 降冪排序。

#### (6) 解混矩陣

$$\mathbf{W} = \mathbf{L}^{-T} \mathbf{V}_s \quad \text{（解 } \mathbf{L}^T \mathbf{W} = \mathbf{V}_s \text{，backward substitution）}$$

#### (7) 逆混矩陣（解析式）

$$\mathbf{W}^{-1} = \mathbf{V}_s^T \mathbf{L}^T$$

此式由 $\mathbf{W} = \mathbf{L}^{-T} \mathbf{V}_s$ 直接推導，數值穩定，避免矩陣求逆。

### 2.5 成分分類與去除

每個成分 $s_j = \mathbf{X} \mathbf{w}_j$：

**肌肉雜訊（所有成分）：**
```
if autocorrs[j] < 0.9  →  remove
```
lag-1 自相關 < 0.9 表示訊號快速變化，視為高頻肌肉雜訊。

**眨眼偽影（僅前 2 個成分）：**
```
if rms(comp) < 0.1  →  skip (near-zero component)
if deltaFraction(comp) > 0.65  AND  peakRmsRatio(comp) > 6.0  →  remove
```

| 參數 | 值 | 說明 |
|------|----|------|
| `MUSCLE_THRESHOLD` | 0.9 | lag-1 自相關閾值 |
| `BLINK_DELTA_THR` | 0.65 | delta 頻帶佔比閾值 |
| `BLINK_PEAK_FACTOR` | 6.0 | 峰值/RMS 比值閾值 |
| 眨眼偵測範圍 | 前 2 成分 | 較高自相關的低頻成分 |

### 2.6 重建

$$\hat{\mathbf{X}} = \mathbf{S}_{clean} \cdot \mathbf{W}^{-1}$$

以 Hann 加權 overlap-add 合併各視窗結果：

$$\text{output}[t] = \frac{\sum_{\text{windows}} \hat{x}[t] \cdot w_{\text{Hann}}[t]}{\sum_{\text{windows}} w_{\text{Hann}}[t]}$$

---

## 三、Epoch 分割與壞 Epoch 移除 (eegReport.ts)

### 3.1 前置濾波

| 用途 | 帶通 | 說明 |
|------|------|------|
| 主要分析 (TBR/APR/FAA/PAF/RSA/COH) | 1.5–45 Hz | 2 階 Butterworth，零相位 |
| EnTP | 4–30 Hz | 同上 |

### 3.2 Epoch 參數

| 參數 | 值 |
|------|----|
| 長度 | 2 s |
| 步長 | 0.5 s |
| 重疊 | 75% |
| 首尾丟棄 | 各 2 個 epoch |

### 3.3 壞 Epoch 移除

對每個通道分別計算各 epoch 的 **std** 與 **peak-to-peak**，以 IQR 方法設定閾值：

$$\text{std\_thresh} = Q_3(\text{std}) + 1.8 \times \text{IQR}(\text{std})$$

$$\text{p2p\_thresh} = \min\!\left(Q_3(\text{p2p}) + 1.8 \times \text{IQR}(\text{p2p}),\ 195\,\mu V\right)$$

任一通道超出閾值即標記為壞 epoch。

### 3.4 PSD 計算

每個 epoch 使用 **Hann 窗 + 補零至 2 的次方 FFT**：

$$P[k] = \frac{|X[k]|^2}{\sum w^2 \cdot f_s}$$

頻率解析度 $\Delta f = f_s / N_{fft} \approx 0.489\,\text{Hz}$（2 s epoch, 1001 Hz，NFFT=2048）

頻帶積分使用**複合梯形法（trapezoid rule）**，並在 `lo` 與 `hi` 兩端以**線性內插**補入端點 PSD，內部 bin 採嚴格 `(lo, hi)` 半開區間。此修正避免：
1. 窄頻帶（α₁、α₂ 各 2 Hz）在 0.489 Hz 解析度下僅覆蓋約 1.47 Hz 而被系統性低估約 27%；
2. 若某 bin 頻率恰落在整數邊界（如 10.0 Hz）時被 α₁ 與 α₂ 雙重計入。

---

## 四、七項腦健康指標

### 4.1 TBR（Theta/Beta Ratio）

**通道：** Fz, Pz

$$\text{TBR} = \frac{P_\theta}{P_{\beta_1} + P_{\beta_2}}$$

| 頻帶 | 範圍 |
|------|------|
| theta ($\theta$) | 4–8 Hz |
| beta1 ($\beta_1$) | 12–20 Hz |
| beta2 ($\beta_2$) | 20–30 Hz |

各頻帶功率為所有 clean epoch × 2 通道的 IQR 過濾後均值（IQR 乘數 = 1.2）。

**臨床意義：** TBR 升高與注意力不足 (ADHD)、認知疲勞相關。

**常模（GAMLSS 連續模型；閉眼 EC 狀態）：**

令 $a = \min(\text{age}, 40)$：

$$\mu(a) = 4.45 - 0.16\,a + 0.002\,a^2$$

$$\sigma(a) = 0.60 + 0.65\cdot\exp\!\big(-0.02\,(a - 8)^2\big)$$

σ 於兒童期（≈8 歲）達峰值，反映高斯絨毛樣本年紀的最大個體差異。

---

### 4.2 APR（Alpha Power Ratio）

**通道：** T7, T8, Fz, Pz

$$\text{APR} = \frac{P_{\alpha_1} + P_{\alpha_2}}{P_\delta + P_\theta + P_{\alpha_1} + P_{\alpha_2} + P_{\beta_1} + P_{\beta_2} + P_\gamma}$$

| 頻帶 | 範圍 |
|------|------|
| delta ($\delta$) | 1.5–4 Hz |
| alpha1 ($\alpha_1$) | 8–10 Hz |
| alpha2 ($\alpha_2$) | 10–12 Hz |
| gamma ($\gamma$) | 30–45 Hz |

**臨床意義：** Alpha 佔比反映放鬆程度與認知準備狀態。

**常模（GAMLSS 連續模型；閉眼 EC 狀態）：**

$$\mu(\text{age}) = 0.15 + 0.15 \cdot \frac{\text{age}}{28}\cdot\exp\!\left(1 - \frac{\text{age}}{28}\right)$$

$$\sigma(\text{age}) = 0.075 + 0.025\,e^{-0.1\,\text{age}} + 0.025\,e^{-0.01\,(\text{age} - 27)^2}$$

μ 為指數組合函數，於 28 歲達到 Alpha 佔比的成熟峰值後緩慢衰退；σ 在幼兒期與中年期略增。

---

### 4.3 FAA（Frontal Alpha Asymmetry）

**通道：** 虛擬 F3 ≈ (Fp1 + Fz)/2，F4 ≈ (Fp2 + Fz)/2

$$\text{FAA} = \log_{10}\!\frac{P_{\alpha}(F_4)}{P_{\alpha}(F_3)}, \quad P_\alpha = \frac{P_{\alpha_1} + P_{\alpha_2}}{2}$$

每個 clean epoch 各自計算後取 IQR 過濾均值。

**臨床意義：** FAA > 0 表示右前額 alpha 較強（左前額相對活化），與正向情感相關；FAA < 0 可能與憂鬱傾向相關。

**常模（GAMLSS 連續模型）：**

$$\mu(\text{age}) = 0$$

$$\sigma(\text{age}) = 0.05 + \frac{0.05}{1 + e^{(\text{age} - 12.5)}}$$

σ 以 logistic 形式由兒童 0.10 平滑過渡至成人 0.05，拐點落在青春期邊界。

---

### 4.4 PAF（Peak Alpha Frequency）

**通道：** O1, O2

以所有 clean epoch × 2 通道的平均 PSD，在年齡對應搜尋範圍內計算**重心頻率（Center of Gravity）**：

$$\text{PAF} = \frac{\sum_{f=f_{lo}}^{f_{hi}} f \cdot P(f)}{\sum_{f=f_{lo}}^{f_{hi}} P(f)}$$

**搜尋範圍依年齡：**

| 年齡 | 範圍 |
|------|------|
| < 6 | 5–9 Hz |
| 6–12 | 6–10 Hz |
| 13–18 | 8–12 Hz |
| ≥ 19 | 8–13 Hz |

**臨床意義：** PAF 反映神經傳導速度與認知效能，低 PAF 與老化、認知退化相關。

**常模（GAMLSS 連續模型）：**

$$\mu(\text{age}) = 10.2 - 4.59\,e^{-0.095\,\text{age}}$$

$$\sigma(\text{age}) = 0.75 + \frac{0.25}{1 + e^{-0.5\,(\text{age} - 19)}}$$

μ 為負指數上升：兒童 ≈ 8.5 Hz，成年漸進 10.2 Hz；σ 以 sigmoid 由 0.75（兒童）擴展至 1.0（成年後）以容納老年退化。

---

### 4.5 RSA（Relative Slow-wave Alpha ratio）

**通道：** O1, O2

$$\text{RSA} = \frac{P_{\alpha_1}}{P_{\alpha_2}}$$

**臨床意義：** RSA 高代表慢 alpha（8–10 Hz）佔優勢，與放鬆、冥想狀態相關；低 RSA 可能與認知負荷高或焦慮相關。

**常模（GAMLSS 連續模型；三高斯組合）：**

令 $a = \text{clip}(\text{age}, 0, 85)$：

$$\mu(a) = 8 + 17\,e^{-0.02\,(a-3)^2} + 11\,e^{-0.03\,(a-27)^2} + 26\,e^{-0.003\,(a-72)^2}$$

$$\sigma(a) = \max\!\big(\mu(a) - 1,\; 0.5\big)$$

三個高斯隆起分別對應幼兒期、青壯年與高齡期 RSA 的相對峰值；σ 以 μ − 1 的線性規則同步放大。

---

### 4.6 COH（Spectral Coherence，前–頂葉 F-P）

**通道對：** (Fp1, Pz), (Fp2, Pz), (Fz, Pz) — 共 3 對前額–頂葉配對

**頻帶：** theta(4–8), alpha1(8–10), alpha2(10–12), beta1(12–20), beta2(20–30) — 共 5 個頻帶

**配對：** 3 對 × 5 頻帶 = 15 個 coherence 值

（僅計算前額–頂葉 F-P 同調性，不含前額內部配對或語言區 Broca–Wernicke）

每對通道每個頻帶的 spectral coherence 計算：

$$\text{COH}(f) = \frac{|\overline{S_{12}(f)}|^2}{\overline{S_{11}(f)} \cdot \overline{S_{22}(f)}}$$

其中上橫線為跨 clean epoch 的累積（不是每 epoch 獨立計算再平均），計算方式：

$$\text{COH} = \frac{\sqrt{\sum_k |\bar{C}_{12}[k]|^2}}{\sqrt{\left(\sum_k \bar{A}_{11}[k]\right)\left(\sum_k \bar{A}_{22}[k]\right)}}$$

（先累積跨 epoch 的 cross-spectrum 和 auto-spectrum，再整合頻帶）

最終 COH = 30 個值的均值，範圍 0–1。

**常模（GAMLSS 連續模型；raw 0–1 scale，F-P）：**

令 $a = \text{clip}(\text{age}, 1, 25)$：

$$\mu(a) = 0.182\,\ln(a) + 0.15$$

$$\sigma(a) = 0.15$$

對數成長曲線：新生兒 ≈ 0.15、兒童期快速上升、青少年後趨於穩定（約 0.73）；σ 定為常數 0.15。

> v1.4.0 起 COH 改用標準 T = 10·Z + 50（不再套用 √T × 10 後處理），與其他六項指標一致。

---

### 4.7 EnTP（Entropy of Temporal Patterns）

**通道：** O1, O2, Fz, Pz, T7, T8（6 通道）

使用 **Sample Entropy (SampEn, Richman & Moorman 2000)**：

1. 對每個 clean epoch 以 4–30 Hz 帶通後，**每 4 點抽樣**降採樣到 ≈250 Hz（與常模建立時一致）
2. 參數：嵌入維度 $m = 2$，容忍度 $r = 0.2 \cdot \sigma_{epoch}$
3. 計算 $B$ = m 維度下所有模板向量兩兩 Chebyshev 距離 $\leq r$ 的配對數；$A$ = m+1 維度下的配對數
4. $\text{SampEn} = -\ln(A / B)$

對每通道取各 clean epoch 的 IQR 過濾均值，再對 6 通道的均值取 IQR 過濾均值。

**預處理：** 使用 4–30 Hz 帶通濾波後的訊號（非 1.5–45 Hz），並降採樣 4× ≈ 250 Hz。

**臨床意義：** 腦訊號複雜度指標，較高 EnTP 代表訊號更隨機/複雜，與認知靈活性相關。

**常模（GAMLSS 連續模型）：**

令 $a = \min(\text{age}, 20)$：

$$\mu(a) = 0.48\,a^{0.41}$$

$$\sigma(a) = 0.18 + 0.02\,a$$

μ 為冪律上升（20 歲封頂 ≈ 1.55），反映大腦發育成熟後熵值不再顯著增加；σ 於成年期放寬至約 0.58。

---

## 五、T 分數計算

### 標準 T 分數（所有 7 項指標）

$$Z = \frac{x - \mu(\text{age})}{\sigma(\text{age})},\quad T = \text{clip}\!\big(\text{round}(10\,Z + 50),\ 1,\ 99\big)$$

所有指標（TBR/APR/FAA/PAF/RSA/COH/EnTP）皆以 GAMLSS 連續模型之 μ(age)、σ(age) 代入，輸出一致線性 T。年齡為連續小數（精度：日）。

---

## 六、資料流摘要表

| 指標 | 通道 | 頻帶 | 統計方式 | T 分數 |
|------|------|------|---------|-------|
| TBR | Fz, Pz | θ / (β₁+β₂) | IQR 均值 | 線性 |
| APR | T7, T8, Fz, Pz | α / total | IQR 均值 | 線性 |
| FAA | Fp1, Fp2, Fz (虛擬 F3/F4) | log(α₄/α₃) | per-epoch IQR 均值 | 線性 |
| PAF | O1, O2 | 8–13 Hz CoG | 累積 PSD 重心 | 線性 |
| RSA | O1, O2 | α₁/α₂ | IQR 均值 | 線性 |
| COH | Fp1-Pz / Fp2-Pz / Fz-Pz（3對×5帶） | θ,α₁,α₂,β₁,β₂ | 累積 cross-spectrum | 線性 |
| EnTP | O1,O2,Fz,Pz,T7,T8 | 4–30 Hz | Sample Entropy 均值 | 線性 |

---

## 七、已知差異與限制

| 項目 | 本實作 | Python SDK 參考 |
|------|--------|-----------------|
| PSD 方法 | Hann 窗 FFT（單 epoch） | multitaper（DPSS） |
| CCA 正則化 | tr/C × 1e-5 | 未公開 |
| COH 通道 | Fp1/Fp2/Fz/Pz（4 通道） | 所有 8 通道 |
| CCA 偽影移除 | 實作 | 相同概念 |

APR 等指標因 Hann vs multitaper 的功率密度差異，絕對數值與 Python SDK 可能不完全一致，但趨勢和相對大小一致。
