export type Lang = 'zh' | 'en';

const translations: Record<string, Record<Lang, string>> = {
  // App title
  appTitle: { zh: 'sgimacog EEG', en: 'sgimacog EEG' },

  // Connection status
  connected: { zh: '已連接', en: 'Connected' },
  connecting: { zh: '連接中...', en: 'Connecting...' },
  disconnected: { zh: '未連接', en: 'Not Connected' },
  error: { zh: '連接錯誤', en: 'Connection Error' },

  // Nav tabs
  tabHome: { zh: '首頁', en: 'Home' },
  tabConnect: { zh: '連線', en: 'Connect' },
  tabImpedance: { zh: '阻抗', en: 'Impedance' },
  tabSignal: { zh: '訊號', en: 'Signal' },
  tabFft: { zh: '頻譜', en: 'FFT' },
  tabRecord: { zh: '記錄', en: 'Record' },

  // Home view
  homeTitle: { zh: '裝置連接', en: 'Device Connection' },
  homeConnect: { zh: '連接裝置', en: 'Connect Device' },
  homeDisconnect: { zh: '斷開連接', en: 'Disconnect' },
  homeDeviceInfo: { zh: '裝置資訊', en: 'Device Info' },
  homeDeviceId: { zh: '裝置序號', en: 'Device ID' },
  homeSampleRate: { zh: '採樣率', en: 'Sample Rate' },
  homePacketRate: { zh: '封包速率', en: 'Packet Rate' },
  homeBattery: { zh: '電池', en: 'Battery' },
  homeNotConnectedTitle: { zh: '尚未連接裝置', en: 'No Device Connected' },
  homeNotConnectedHint: { zh: '請點擊「連接裝置」按鈕，從彈出視窗選擇序列埠', en: 'Click "Connect Device" and select a serial port from the popup' },
  homeInstructions: { zh: '使用說明', en: 'Instructions' },
  homeStep1: { zh: '1. 連接裝置後，前往「阻抗」頁面檢查電極接觸品質', en: '1. After connecting, go to "Impedance" tab to check electrode contact quality' },
  homeStep2: { zh: '2. 前往「訊號」頁面確認 EEG 波形正常', en: '2. Go to "Signal" tab to verify the EEG waveform looks correct' },
  homeStep3: { zh: '3. 前往「記錄」頁面輸入受試者資訊後開始錄製', en: '3. Go to "Record" tab, fill in subject info, then start recording' },
  homeRequiresSerial: { zh: '需要 Web Serial API（Chrome / Edge 89+）', en: 'Requires Web Serial API (Chrome / Edge 89+)' },

  // Impedance view
  impedanceTitle: { zh: '電極阻抗 (10-20 系統)', en: 'Electrode Impedance (10-20 System)' },
  impedanceStart: { zh: '開始量測', en: 'Start Measurement' },
  impedanceStop: { zh: '停止量測', en: 'Stop Measurement' },
  impedanceExcellent: { zh: '優秀', en: 'Excellent' },
  impedanceGood: { zh: '良好', en: 'Good' },
  impedancePoor: { zh: '尚可', en: 'Poor' },
  impedanceBad: { zh: '不良', en: 'Bad' },
  impedanceLegend: { zh: '阻抗品質', en: 'Impedance Quality' },
  impedanceNotMeasured: { zh: '未量測', en: 'Not measured' },
  impedanceNotConnected: { zh: '請先連接裝置', en: 'Please connect device first' },

  // Signal / Waveform view
  signalTitle: { zh: 'EEG 訊號', en: 'EEG Signal' },
  signalNotConnected: { zh: '請連接裝置以查看訊號', en: 'Connect device to see signal' },
  signalTime: { zh: '時間', en: 'Time' },
  signalScale: { zh: '幅度', en: 'Scale' },
  signalAuto: { zh: '自動', en: 'Auto' },
  signalBandpass: { zh: '帶通', en: 'Bandpass' },
  signalNotchOff: { zh: '陷波：關', en: 'Notch: Off' },
  signalNotch50: { zh: '陷波：50 Hz', en: 'Notch: 50 Hz' },
  signalNotch60: { zh: '陷波：60 Hz', en: 'Notch: 60 Hz' },
  signalHpFreq: { zh: '高通 (Hz)', en: 'HP (Hz)' },
  signalLpFreq: { zh: '低通 (Hz)', en: 'LP (Hz)' },
  signalMarker: { zh: '事件標記', en: 'Event Marker' },
  signalMarkers: { zh: '事件標記', en: 'Event Markers' },
  signalClearMarkers: { zh: '清除全部', en: 'Clear All' },
  signalMarkerHint: { zh: '按空白鍵或 M 鍵新增標記', en: 'Press Space or M to add a marker' },
  signalRecording: { zh: '錄製中', en: 'Recording' },

  // FFT view
  fftTitle: { zh: 'EEG 頻譜', en: 'EEG Spectrum' },
  fftNotConnected: { zh: '請連接裝置以查看頻譜', en: 'Connect device to see spectrum' },
  fftMaxFreq: { zh: '最大頻率', en: 'Max Freq' },

  // Record view
  recordTitle: { zh: '錄製設定', en: 'Recording' },
  recordSubjectId: { zh: '受試者編號', en: 'Subject ID' },
  recordSubjectName: { zh: '姓名', en: 'Name' },
  recordAge: { zh: '年齡', en: 'Age' },
  recordDob: { zh: '出生年月日', en: 'Date of Birth' },
  recordSex: { zh: '性別', en: 'Sex' },
  recordSexMale: { zh: '男', en: 'Male' },
  recordSexFemale: { zh: '女', en: 'Female' },
  recordSexOther: { zh: '第三性', en: 'Non-binary' },
  recordNotes: { zh: '備注', en: 'Notes' },
  recordStart: { zh: '開始錄製', en: 'Start Recording' },
  recordStopOnly: { zh: '停止', en: 'Stop' },
  recordStop: { zh: '停止並下載', en: 'Stop & Download' },
  recordDuration: { zh: '錄製時間', en: 'Duration' },
  recordSamples: { zh: '已錄製樣本', en: 'Samples recorded' },
  recordPackets: { zh: '封包', en: 'Packets' },
  recordNotConnected: { zh: '請先連接裝置', en: 'Please connect device first' },
  recordMarkerLog: { zh: '事件標記記錄', en: 'Event Marker Log' },
  recordNoMarkers: { zh: '尚無事件標記', en: 'No event markers yet' },
  recordAddMarker: { zh: '新增標記', en: 'Add Marker' },
  recordClearMarkers: { zh: '清除全部', en: 'Clear All' },

  // Common
  hz: { zh: 'Hz', en: 'Hz' },
  kohm: { zh: 'kΩ', en: 'kΩ' },
  unknown: { zh: '未知', en: 'Unknown' },
  raw: { zh: '原始', en: 'Raw' },

  // FTDI device scanner (HomeView – kept for legacy key refs)
  homeWebUsbNotAvailable: { zh: '此瀏覽器不支援 WebUSB（需 Chrome / Edge）', en: 'WebUSB not available (requires Chrome / Edge)' },
  homeMultiDevice: { zh: '多設備：在不同瀏覽器分頁開啟此頁面即可連接多台設備', en: 'Multi-device: Open this page in separate browser tabs to connect multiple devices.' },

  // Connect Modal
  connectModalTitle:        { zh: '連線裝置', en: 'Connect Device' },
  connectModalDetectedDevices: { zh: '已授權的 FTDI 裝置（序列號）', en: 'Authorized FTDI Devices (serial numbers)' },
  connectModalRefresh:      { zh: '重新掃描', en: 'Refresh' },
  connectModalPaired:       { zh: '已配對（其他視窗）', en: 'Paired (other window)' },
  connectModalAuthorizeNew: { zh: '授權新裝置（首次使用）', en: 'Authorize new device (first time)' },
  connectModalNoDevices:    { zh: '未找到授權裝置，請點「授權新裝置」', en: 'No authorized devices found. Click "Authorize new device".' },
  connectModalConnect:      { zh: '連線', en: 'Connect' },
  connectModalOnePortReady: { zh: '已找到 1 個已授權的序列埠，點連線即可直接開啟', en: '1 authorized port found — click Connect to open directly' },
  connectModalMultiPortReady: { zh: '已找到 {n} 個已授權的序列埠，請在彈出視窗中選擇', en: '{n} authorized ports found — select one in the picker' },
  connectModalClearAll: { zh: '清除所有裝置授權', en: 'Clear all device authorizations' },
  connectModalSelectDevice: { zh: '請點選要連線的裝置', en: 'Click a device to select it' },
  connectModalSelectedHint: { zh: '已選取 {id}，請在彈出視窗選擇對應的 COM port', en: 'Selected {id} — pick its COM port from the browser picker' },
  connectModalNoSelection: { zh: '請先點選一台裝置', en: 'Please select a device first' },
  connectModalPortReady:    { zh: '已配對 COM port，可直接連線', en: 'COM port paired — ready to connect' },
  connectModalNeedsPairing: { zh: '尚未配對 COM port', en: 'COM port not yet paired' },
  connectModalPairPort:     { zh: '配對 COM Port', en: 'Pair COM Port' },
  connectAndroidTitle:       { zh: 'Android USB 直連', en: 'Android USB Direct' },
  connectAndroidHint:        { zh: '此瀏覽器不支援 Web Serial API。請透過 USB OTG 連接裝置，再點下方按鈕授權。', en: 'Web Serial API not available. Connect the device via USB OTG cable, then tap below to authorize.' },
  connectAndroidButton:      { zh: '選擇 USB 裝置', en: 'Select USB Device' },
  connectAndroidConnecting:  { zh: '連線中…', en: 'Connecting…' },
  connectAndroidNoUsb:       { zh: '此瀏覽器不支援 WebUSB，無法直連裝置。', en: 'WebUSB not supported — cannot connect on this browser.' },
  connectModalMismatchWarning: {
    zh: '⚠️ COM port 不符！\n選取的裝置是 {device}，但此 COM port 屬於序號 {port}。\n請選擇正確的 COM port。',
    en: '⚠️ COM port mismatch!\nSelected device is {device}, but this COM port belongs to serial {port}.\nPlease select the correct COM port.',
  },

  // Header device ID
  headerDeviceId: { zh: '裝置', en: 'Device' },

  // Sidebar Neural Dark
  sidebarSectionMain:  { zh: '主功能', en: 'Navigation' },
  sidebarDeviceInfo:   { zh: '裝置資訊', en: 'Device Info' },
  sidebarSampleRate:   { zh: '採樣率', en: 'Sample Rate' },
  sidebarPacketRate:   { zh: '封包/s', en: 'Pkt/s' },
  sidebarSerial:       { zh: '序號', en: 'Serial' },

  // Impedance N/A
  impedanceNoSignal: { zh: 'N/A = 未偵測到訊號 / No signal detected', en: 'N/A = No signal detected / 未偵測到訊號' },
  impedanceBlockedByRecording: { zh: '錄製中無法量測阻抗', en: 'Cannot measure impedance while recording' },

  // Sidebar mutual exclusion tooltips
  sidebarImpedanceActiveHint: { zh: '阻抗量測進行中，請先停止量測', en: 'Impedance active — stop measurement first' },
  sidebarSignalActiveHint: { zh: '訊號/頻譜檢視中，請先切換至阻抗頁面', en: 'Signal/FFT active — navigate away first' },

  // Quality monitor (RecordView)
  recordTargetDuration: { zh: '目標時長', en: 'Target Duration' },
  recordDurationManual: { zh: '手動', en: 'Manual' },
  recordSensitivity: { zh: '靈敏度', en: 'Sensitivity' },
  recordSensitivityLenient: { zh: '寬鬆', en: 'Lenient' },
  recordSensitivityStrict: { zh: '嚴格', en: 'Strict' },
  recordQualityGrid: { zh: '訊號品質', en: 'Signal Quality' },
  recordQualityEnabled: { zh: '啟用', en: 'Enable' },
  recordQualityDisabled: { zh: '關閉', en: 'Off' },
  recordGoodTime: { zh: '有效時間', en: 'Good Time' },
  recordQualityPct: { zh: '品質百分比', en: 'Quality %' },
  recordAutoStopped: { zh: '已達目標時長，自動停止', en: 'Target duration reached — auto stopped' },

  // Report generation
  recordFromFile:         { zh: '讀取 CSV 生成報告', en: 'Load CSV & Generate Report' },
  recordFromFileHint:     { zh: '選擇先前錄製的 CSV 檔案', en: 'Select a previously recorded CSV file' },
  recordFromFileParsing:  { zh: '解析中…', en: 'Parsing…' },
  recordFromFileAnalyzing:{ zh: '分析中…', en: 'Analyzing…' },
  recordFromFileSuccess:  { zh: '報告已產生', en: 'Report generated' },
  recordFromFileErrParse: { zh: 'CSV 格式錯誤', en: 'CSV parse error' },
  recordFromFileErrShort: { zh: '資料不足 90 秒', en: 'Recording too short (< 90 s)' },
  recordFromFileErrAnalysis: { zh: '分析失敗', en: 'Analysis failed' },
  recordFromFileSamples:  { zh: '樣本數', en: 'Samples' },
  recordFromFileDuration: { zh: '時長', en: 'Duration' },
  recordStopReport:       { zh: '停止並生成報告', en: 'Stop & Generate Report' },
  recordReportTooShort:   { zh: '錄製時間不足 90 秒，無法生成報告', en: 'Recording must be at least 90 seconds to generate a report' },
  recordGeneratingReport: { zh: '分析中，請稍候…', en: 'Analyzing EEG, please wait…' },
  recordReportError:      { zh: '報告生成失敗', en: 'Report generation failed' },
  recordAutoStopMode:     { zh: '達標後', en: 'On target' },
  recordAutoStopCsv:      { zh: '存檔', en: 'Save CSV' },
  recordAutoStopReport:   { zh: '存檔＋報告', en: 'Save + Report' },

  // Disclaimer / consent
  disclaimerBtn:          { zh: '資料蒐集知情同意', en: 'Data Collection Consent' },
  disclaimerTitle:        { zh: '資料蒐集知情同意', en: 'Informed Consent for Data Collection' },
  disclaimerBody: {
    zh: '本系統（SigmaCog 平台）將記錄您的腦電波（EEG）等生理資料。本服務由亞堤仕生醫科技股份有限公司提供，屬健康輔助工具，不具醫療診斷效力。\n\n【資料用途】\n・產生個人化健康評估報告\n・以去識別化方式用於服務改善、研究及 AI 模型訓練\n\n【資料儲存】\n資料以加密方式上傳至雲端伺服器，原始資料保存期限為最後一次使用起 10 年。\n\n您有權查詢、更正或要求刪除個人資料。詳見隱私政策：sigmacog.xyz/privacy\n\n────\n施測說明：請向受測者口頭說明以上內容並取得同意後，再勾選下方選項開始錄製。',
    en: 'This system (SigmaCog platform) will record your electroencephalography (EEG) and other physiological data. This service is provided by Artise Biomedical Co., Ltd. as a wellness tool and does not constitute medical diagnosis.\n\n[Data Use]\n· Generating personalized health assessment reports\n· De-identified service improvement, research, and AI model training\n\n[Data Storage]\nData is encrypted and uploaded to cloud servers. Raw data is retained for 10 years from the date of last service use.\n\nYou have the right to access, correct, or request deletion of your data. See Privacy Policy: sigmacog.xyz/privacy\n\n────\nAssessor Note: Please verbally explain the above to the subject and obtain their agreement before ticking the box below.',
  },
  disclaimerConsentLabel: {
    zh: '已向受測者口頭說明並獲得同意',
    en: 'Subject has been verbally informed and has given consent',
  },
  disclaimerRequired: {
    zh: '請先完成知情同意程序再開始錄製',
    en: 'Please complete the informed consent process before recording',
  },

  // Flexible electrode mode (STEEG_DG819)
  electrodeMode:         { zh: '請依照實際電極位置調整', en: 'Adjust to match actual electrode positions' },
  electrodeEditBtn:      { zh: '⚙ 設定電極', en: '⚙ Electrodes' },
  electrodeEditTitle:    { zh: 'CH 1–8 電極位置指定', en: 'CH 1–8 Electrode Assignment' },
  electrodeEditApply:    { zh: '套用', en: 'Apply' },
  electrodeEditCancel:   { zh: '取消', en: 'Cancel' },
  electrodeReportBlocked: {
    zh: '電極配置非標準排列，無法生成報告（需 Fp1→Fp2→T7→T8→O1→O2→Fz→Pz）',
    en: 'Non-default electrode layout — report unavailable (requires Fp1→Fp2→T7→T8→O1→O2→Fz→Pz)',
  },
};

export const T = (lang: Lang, key: string): string =>
  translations[key]?.[lang] ?? key;
