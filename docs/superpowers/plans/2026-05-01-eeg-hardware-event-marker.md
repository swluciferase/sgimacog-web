# EEG Hardware Event Marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the 1-byte EEG hardware event byte (TLV `Tag 7`, already parsed in Rust) to the JS layer, draw it on the waveform, list it in the side panel, write it to CSV, and support multi-device broadcast — across `sgimacog-web`, `NFB-Webapp` (SoraMynd), and `poseidon`.

**Architecture:** WASM `packet_to_js` exposes `event: number | null`. JS `useDevice` filters `event !== 0`, writes to per-device `recordSamplesRef`, and dispatches `hardware-marker-visual` (always) plus `hardware-marker-broadcast` (when toggle on). `WaveformView` filters by `deviceId` and draws a green solid line. `RecordView` adds a broadcast toggle and forwards events to the side list. CSV `Event Id` column is repurposed for hardware events; software marker ID moves to `Software Marker` column.

**Tech Stack:** Rust + wasm-pack + wasm-bindgen, React + TypeScript + Vite, vitest for JS unit tests, `cargo test` for Rust unit tests.

**Source spec:** `docs/superpowers/specs/2026-05-01-eeg-hardware-event-marker-design.md`

**Apps:** `sgimacog-web` (primary), `NFB-Webapp`, `poseidon`. Plan executes sgimacog-web fully, then ports to the other two.

---

## File Structure (sgimacog-web)

| File | Responsibility | Modify or Create |
|------|----------------|------------------|
| `crate/src/wasm_api.rs` | WASM bridge: expose `packet.event` as JS number\|null | Modify `packet_to_js` only |
| `web/src/types/eeg.ts` | TS type for `EegPacket` | Add `event` field |
| `web/src/services/csvWriter.ts` | CSV row generator + `RecordedSample` interface | Restructure event fields |
| `web/src/services/csvWriter.test.ts` | Unit tests for csvWriter | Create |
| `web/src/services/csvParser.ts` | Read CSV back, with backward-compat for old format | Modify |
| `web/src/services/csvParser.test.ts` | Unit tests for csvParser (new + old formats) | Create |
| `web/src/hooks/useDevice.ts` | Per-device packet ingest + recording + custom event emit | Modify |
| `web/src/hooks/useDevice.ts` (export) | `EventMarker` type extension | Modify type only |
| `web/src/components/views/WaveformView.tsx` | Canvas drawing + listener for `hardware-marker-visual` | Modify |
| `web/src/components/views/RecordView.tsx` | Broadcast toggle UI + `onHardwareEventMarker` plumbing | Modify |
| `web/package.json` | Bump version | Modify |

---

## Phase A — WASM Bridge: Expose `event` to JS (sgimacog-web)

### Task A1: Add Rust unit test for `packet_to_js` event field

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/crate/src/wasm_api.rs` (tests module — append at end of file)

- [ ] **Step 1: Read the current end of `wasm_api.rs` to find tests location**

Run: `tail -50 /Users/swryociao/sgimacog-web/crate/src/wasm_api.rs`

If a `#[cfg(test)] mod tests {}` block exists, append to it. If not, create one. The `packet_to_js` helper is `wasm_bindgen` and emits `JsValue` — it cannot be tested directly outside a wasm-bindgen-test runner. Instead, **test the protocol path that fills `EegPacket.event`** to lock in the expectation that downstream wasm bridge will surface it.

- [ ] **Step 2: Verify the protocol-side test already exists for TAG_EVENT**

Run: `grep -n "TAG_EVENT\|protocol_parse_event" /Users/swryociao/sgimacog-web/crate/src/protocol.rs`

Expected: existing tests cover serial/eeg/gsensor/battery but not event.

- [ ] **Step 3: Add a failing protocol test that covers TAG_EVENT**

Append to `/Users/swryociao/sgimacog-web/crate/src/protocol.rs` inside `#[cfg(test)] mod tests {}`:

```rust
    #[test]
    fn protocol_parse_event_byte() {
        // Tag count=1, TAG_EVENT, len=1, value=42
        let payload = [1u8, TAG_EVENT, 1, 42];
        let packet = parse_packet(&payload).expect("parse must succeed");
        assert_eq!(packet.event, Some(42));
    }

    #[test]
    fn protocol_parse_event_zero_byte_is_still_some() {
        // Edge / one-shot firmware: idle = 0; we still parse it as Some(0).
        // JS layer is responsible for filtering 0 (so debug visibility is preserved).
        let payload = [1u8, TAG_EVENT, 1, 0];
        let packet = parse_packet(&payload).expect("parse must succeed");
        assert_eq!(packet.event, Some(0));
    }
```

- [ ] **Step 4: Run the new tests — must PASS (parse already works)**

```bash
cd /Users/swryociao/sgimacog-web/crate && cargo test --lib protocol_parse_event
```

Expected: 2 passed. (These tests pin the parser contract, not new behavior.)

- [ ] **Step 5: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add crate/src/protocol.rs
git commit -m "test(crate): pin TAG_EVENT parsing contract"
```

### Task A2: Modify `packet_to_js` to expose `event`

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/crate/src/wasm_api.rs:174-235` (the `packet_to_js` function)

- [ ] **Step 1: Read the current `packet_to_js` (lines 174–235) to locate insertion point**

Confirm it has the structure: `serialNumber → channels → battery → gsensor → machineInfo → impedanceResults`.

- [ ] **Step 2: Insert `event` field exposure after `machineInfo`, before `impedanceResults`**

Add the following block immediately before `// impedanceResults — starts null...` (around line 231):

```rust
        // event — hardware event byte (Tag 7), 0..255 or null if absent in this packet
        let event_val = match packet.event {
            Some(v) => JsValue::from(v),
            None => JsValue::NULL,
        };
        let _ = Reflect::set(&obj, &"event".into(), &event_val);
```

- [ ] **Step 3: Build the crate to verify compilation**

```bash
cd /Users/swryociao/sgimacog-web/crate && cargo check --lib
```

Expected: Finished, no errors.

- [ ] **Step 4: Update the doc comment on `feed()` (line ~76) to list the new `event` field**

Find the JSDoc-style block describing the returned object shape. Add a line:

```
///   event:             number | null,   // hardware event byte (Tag 7), 0..255 or null
```

Place it after `machineInfo` and before `impedanceResults`.

- [ ] **Step 5: Commit**

```bash
git add crate/src/wasm_api.rs
git commit -m "feat(crate): expose hardware event byte to JS via packet_to_js"
```

### Task A3: Rebuild WASM bundle for `web/`

**Files:**
- Generated: `/Users/swryociao/sgimacog-web/web/src/pkg/*` (do not hand-edit)

- [ ] **Step 1: Run wasm-pack build**

```bash
cd /Users/swryociao/sgimacog-web && wasm-pack build crate --target bundler --out-dir web/src/pkg
```

Expected: `[INFO]: ✨   Done in <Ns>` and updated files in `web/src/pkg/`.

- [ ] **Step 2: Verify the JS shim now mentions event**

```bash
grep -l "event" /Users/swryociao/sgimacog-web/web/src/pkg/*.d.ts
```

Expected: at least one match (the type declarations file).

- [ ] **Step 3: Commit the regenerated pkg/**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/pkg/
git commit -m "chore(wasm): rebuild pkg with event field"
```

---

## Phase B — TypeScript Type Update (sgimacog-web)

### Task B1: Add `event` to `EegPacket`

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/src/types/eeg.ts:3-15`

- [ ] **Step 1: Edit the `EegPacket` interface**

Replace lines 3–15 with:

```ts
export interface EegPacket {
  serialNumber: number | null;
  eegChannels: Float32Array | null; // µV values, 8 channels
  battery: number | null;
  connStatus: number | null;
  synctick: number | null;
  euler: { roll: number; pitch: number; yaw: number } | null;
  gsensor: {
    gyroX: number; gyroY: number; gyroZ: number;
    accelX: number; accelY: number; accelZ: number;
  } | null;
  machineInfo: string | null; // device ID string from TAG_COMMAND response
  event: number | null;       // hardware event byte (Tag 7), 0..255; null if absent
}
```

- [ ] **Step 2: Run tsc to find every read site that needs updating**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx tsc --noEmit 2>&1 | head -40
```

Expected: 0 errors (adding a field is non-breaking unless code constructs `EegPacket` literals that omit it; if such literals exist, fix them by adding `event: null`).

- [ ] **Step 3: Search for places that build `EegPacket` literals**

```bash
grep -rn "machineInfo:.*null" /Users/swryociao/sgimacog-web/web/src --include='*.ts' --include='*.tsx' | head
```

Expected: 0 hits unless test mocks or stub builders exist. If hits exist, append `, event: null` next to `machineInfo: null` in each.

- [ ] **Step 4: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/types/eeg.ts
# Plus any literal-fix files surfaced in step 3
git commit -m "feat(types): add event field to EegPacket"
```

---

## Phase C — CSV Writer: Split Hardware vs Software Marker Fields (sgimacog-web)

### Task C1: Write failing tests for new `RecordedSample` shape

**Files:**
- Create: `/Users/swryociao/sgimacog-web/web/src/services/csvWriter.test.ts`

- [ ] **Step 1: Create the test file with failing tests**

```ts
// web/src/services/csvWriter.test.ts
import { describe, it, expect } from 'vitest';
import { generateCsv, type RecordedSample } from './csvWriter';

const startTime = new Date('2026-05-01T12:34:56.789Z');

const sampleNoEvent = (ts: number): RecordedSample => ({
  timestamp: ts,
  serialNumber: 1000 + ts,
  channels: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
});

const sampleHardware = (ts: number, value: number): RecordedSample => ({
  ...sampleNoEvent(ts),
  hardwareEvent: value,
});

const sampleSoftware = (ts: number, id: string, name: string): RecordedSample => ({
  ...sampleNoEvent(ts),
  softwareMarkerId: id,
  softwareMarkerName: name,
});

describe('generateCsv — event column mapping', () => {
  it('writes empty Event Id / Software Marker for plain samples', () => {
    const csv = generateCsv([sampleNoEvent(0)], startTime, 'STEEG_X', 'BP', 'NOTCH');
    const dataRow = csv.trim().split('\r\n').pop()!;
    const cols = dataRow.split(',');
    // Last 5 columns: Event Id, Event Date, Event Duration, Software Marker, Software Marker Name
    const tail = cols.slice(-5);
    expect(tail).toEqual(['', '', '', '', '']);
  });

  it('writes hardware event byte into Event Id and timestamp into Event Date', () => {
    const csv = generateCsv([sampleHardware(0.5, 42)], startTime, 'STEEG_X', 'BP', 'NOTCH');
    const dataRow = csv.trim().split('\r\n').pop()!;
    const cols = dataRow.split(',');
    const tail = cols.slice(-5);
    expect(tail[0]).toBe('42');                           // Event Id
    expect(tail[1]).not.toBe('');                         // Event Date filled
    expect(tail[2]).toBe('');                             // Event Duration empty
    expect(tail[3]).toBe('');                             // Software Marker empty
    expect(tail[4]).toBe('');                             // Software Marker Name empty
  });

  it('writes software marker ID into Software Marker and name into Software Marker Name', () => {
    const csv = generateCsv([sampleSoftware(0.5, '1101', 'stim_target')], startTime, 'STEEG_X', 'BP', 'NOTCH');
    const dataRow = csv.trim().split('\r\n').pop()!;
    const cols = dataRow.split(',');
    const tail = cols.slice(-5);
    expect(tail[0]).toBe('');                             // Event Id (hardware) empty
    expect(tail[1]).toBe('');                             // Event Date empty
    expect(tail[3]).toBe('1101');                         // Software Marker = ID
    expect(tail[4]).toBe('stim_target');                  // Software Marker Name
  });

  it('writes both columns when both hardware and software present on the same sample', () => {
    const sample: RecordedSample = {
      ...sampleNoEvent(1),
      hardwareEvent: 5,
      softwareMarkerId: '1101',
      softwareMarkerName: 'stim_target',
    };
    const csv = generateCsv([sample], startTime, 'STEEG_X', 'BP', 'NOTCH');
    const dataRow = csv.trim().split('\r\n').pop()!;
    const cols = dataRow.split(',');
    const tail = cols.slice(-5);
    expect(tail[0]).toBe('5');
    expect(tail[3]).toBe('1101');
    expect(tail[4]).toBe('stim_target');
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (interface mismatch)**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx vitest run src/services/csvWriter.test.ts
```

Expected: tests fail because `hardwareEvent` / `softwareMarkerId` / `softwareMarkerName` aren't on the interface.

### Task C2: Update `RecordedSample` interface and `generateCsvRows`

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/src/services/csvWriter.ts:1-7` (interface) and `:58-78` (rows)

- [ ] **Step 1: Replace `RecordedSample` interface (lines 1–7)**

```ts
export interface RecordedSample {
  timestamp: number;        // seconds from recording start
  serialNumber: number | null;
  channels: Float32Array;   // raw µV values (unfiltered)
  /** Hardware event byte (TLV Tag 7), 1..255 when set; undefined when no event in this sample. */
  hardwareEvent?: number;
  /** Software marker numeric ID as string (e.g. "1101"). Comes from BroadcastChannel marker. */
  softwareMarkerId?: string;
  /** Software marker label string (e.g. "stim_target"). Comes from BroadcastChannel marker. */
  softwareMarkerName?: string;
}
```

- [ ] **Step 2: Replace `generateCsvRows` body (lines 58–78)**

```ts
function generateCsvRows(
  samples: RecordedSample[],
  startTime: Date,
  channelLabels?: string[],
): string {
  const nch = channelLabels?.length ?? (samples[0]?.channels.length ?? 8);
  const lines: string[] = [];
  for (const sample of samples) {
    const ts = sample.timestamp.toFixed(3);
    const sn = sample.serialNumber !== null ? sample.serialNumber.toString() : '';
    const ch = Array.from({ length: nch }, (_, i) =>
      sample.channels[i] !== undefined ? sample.channels[i]!.toFixed(4) : '0.0000',
    ).join(',');
    const hwEvent = sample.hardwareEvent != null ? String(sample.hardwareEvent) : '';
    const eventDate = sample.hardwareEvent != null
      ? formatDatetime(new Date(startTime.getTime() + sample.timestamp * 1000))
      : '';
    const swMarker = sample.softwareMarkerId ?? '';
    const swMarkerName = sample.softwareMarkerName ?? '';
    lines.push(`${ts},${sn},${ch},${hwEvent},${eventDate},,${swMarker},${swMarkerName}`);
  }
  return lines.join('\r\n') + '\r\n';
}
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx vitest run src/services/csvWriter.test.ts
```

Expected: 4 passed.

- [ ] **Step 4: Run full type-check + tsc to find sites still using old `eventId`/`eventName`**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx tsc --noEmit 2>&1 | grep -E "eventId|eventName" | head -20
```

Expected: errors at `useDevice.ts:247–259` and `csvParser.ts:94–97`. These are fixed in later tasks; leave for now if they don't block tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/services/csvWriter.ts web/src/services/csvWriter.test.ts
git commit -m "feat(csv): split RecordedSample event fields into hardware + software"
```

---

## Phase D — CSV Parser: Backward Compatibility (sgimacog-web)

### Task D1: Write tests for new format AND old-format reads

**Files:**
- Create: `/Users/swryociao/sgimacog-web/web/src/services/csvParser.test.ts`

- [ ] **Step 1: Create test file**

```ts
import { describe, it, expect } from 'vitest';
import { parseCsv } from './csvParser';
import { generateCsv, type RecordedSample } from './csvWriter';

const startTime = new Date('2026-05-01T12:34:56.789Z');

const baseSample = (ts: number): RecordedSample => ({
  timestamp: ts,
  serialNumber: 1,
  channels: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]),
});

describe('parseCsv — new format roundtrip', () => {
  it('parses hardware event from Event Id column', () => {
    const samples: RecordedSample[] = [{ ...baseSample(0.1), hardwareEvent: 7 }];
    const csv = generateCsv(samples, startTime, 'STEEG_X', 'BP', 'NOTCH');
    const out = parseCsv(csv);
    expect(out.samples).toHaveLength(1);
    expect(out.samples[0]!.hardwareEvent).toBe(7);
    expect(out.samples[0]!.softwareMarkerId).toBeUndefined();
    expect(out.samples[0]!.softwareMarkerName).toBeUndefined();
  });

  it('parses software marker from Software Marker columns', () => {
    const samples: RecordedSample[] = [{
      ...baseSample(0.1),
      softwareMarkerId: '1101',
      softwareMarkerName: 'stim_target',
    }];
    const csv = generateCsv(samples, startTime, 'STEEG_X', 'BP', 'NOTCH');
    const out = parseCsv(csv);
    expect(out.samples[0]!.hardwareEvent).toBeUndefined();
    expect(out.samples[0]!.softwareMarkerId).toBe('1101');
    expect(out.samples[0]!.softwareMarkerName).toBe('stim_target');
  });
});

describe('parseCsv — old format backward compatibility', () => {
  // Old CSVs (pre-2026-05-01) used `Event Id = software marker ID` and `Software Marker = "1"`.
  // New parser must detect this and remap into softwareMarkerId / softwareMarkerName.
  it('reads old CSV: Event Id was software ID, Software Marker was "1" flag', () => {
    const oldCsv = [
      'Cygnus version: 0.28.0.7,File version: 2021.11',
      'Operative system: Browser',
      'Record datetime: 2026-04-30 10:00:00.000',
      'Device ID: STEEG_OLD',
      'Device version: ',
      'Device bandwidth: DC to 131 Hz',
      'Device sampling rate: 1000 samples/second',
      'Data type / unit: EEG / micro-volt (uV)',
      'Bandpass filter: 1-45',
      'Notch filter: 60',
      'Timestamp,Serial Number,Fp1,Fp2,T7,T8,O1,O2,Fz,Pz,Event Id,Event Date,Event Duration,Software Marker,Software Marker Name',
      '0.100,1,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1101,2026-04-30 10:00:00.100,,1,stim_target',
    ].join('\r\n') + '\r\n';
    const out = parseCsv(oldCsv);
    expect(out.samples).toHaveLength(1);
    // Old `Event Id = 1101` was a software marker → remap
    expect(out.samples[0]!.softwareMarkerId).toBe('1101');
    expect(out.samples[0]!.softwareMarkerName).toBe('stim_target');
    expect(out.samples[0]!.hardwareEvent).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx vitest run src/services/csvParser.test.ts
```

Expected: tests fail (parser still uses old `eventId`/`eventName` names).

### Task D2: Rewrite parser data-row block with format detection

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/src/services/csvParser.ts:55-105`

- [ ] **Step 1: Replace lines 55–105 of `csvParser.ts`**

```ts
  // ── Verify column header line (line 11, index 10) ────────────────────────
  const colHeader = lines[10]!;
  const cols = colHeader.split(',').map(c => c.trim());
  const tsIdx          = cols.indexOf('Timestamp');
  const snIdx          = cols.indexOf('Serial Number');
  const fp1Idx         = cols.indexOf('Fp1');
  const evtIdIdx       = cols.indexOf('Event Id');
  const swMarkerIdx    = cols.indexOf('Software Marker');
  const swMarkerNmIdx  = cols.indexOf('Software Marker Name');

  if (tsIdx === -1 || fp1Idx === -1) {
    return { samples: [], channelLabels: [], deviceId, recordDatetime, filterDesc, notchDesc, sampleRate, error: 'csv_bad_header' };
  }

  const chStart = fp1Idx;
  const nch = evtIdIdx > chStart ? evtIdIdx - chStart : 8;
  const channelLabels = cols.slice(chStart, chStart + nch);

  // ── Parse data rows ────────────────────────────────────────────────────────
  const samples: RecordedSample[] = [];
  for (let i = 11; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < chStart + nch) continue;

    const ts = parseFloat(parts[tsIdx]!);
    if (isNaN(ts)) continue;

    const sn = snIdx >= 0 ? parseInt(parts[snIdx]!, 10) : null;
    const serialNumber = isNaN(sn as number) ? null : sn;

    const channels = new Float32Array(nch);
    for (let ch = 0; ch < nch; ch++) {
      const v = parseFloat(parts[chStart + ch]!);
      channels[ch] = isNaN(v) ? 0 : v;
    }

    const eventIdRaw  = evtIdIdx >= 0 ? parts[evtIdIdx]!.trim() : '';
    const swMarkerRaw = swMarkerIdx >= 0 ? parts[swMarkerIdx]!.trim() : '';
    const swMarkerNm  = swMarkerNmIdx >= 0 ? (parts[swMarkerNmIdx]!.trim() || undefined) : undefined;

    let hardwareEvent: number | undefined;
    let softwareMarkerId: string | undefined;
    let softwareMarkerName: string | undefined = swMarkerNm;

    if (swMarkerRaw === '1') {
      // Legacy format: `Software Marker = "1"` flag means Event Id was a software marker ID.
      softwareMarkerId = eventIdRaw || undefined;
    } else {
      // New format: Event Id is the hardware event byte; Software Marker holds software ID.
      if (eventIdRaw) {
        const n = parseInt(eventIdRaw, 10);
        if (!isNaN(n) && n >= 1 && n <= 255) hardwareEvent = n;
      }
      if (swMarkerRaw) softwareMarkerId = swMarkerRaw;
    }

    samples.push({ timestamp: ts, serialNumber, channels, hardwareEvent, softwareMarkerId, softwareMarkerName });
  }

  if (samples.length === 0) {
    return { samples, channelLabels, deviceId, recordDatetime, filterDesc, notchDesc, sampleRate, error: 'csv_no_data' };
  }

  return { samples, channelLabels, deviceId, recordDatetime, filterDesc, notchDesc, sampleRate };
}
```

- [ ] **Step 2: Run tests — expect PASS**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx vitest run src/services/csvParser.test.ts
```

Expected: 3 passed.

- [ ] **Step 3: Run all tests to make sure nothing else regressed**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx vitest run
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/services/csvParser.ts web/src/services/csvParser.test.ts
git commit -m "feat(csv): parser handles new format + legacy software-marker flag"
```

---

## Phase E — useDevice Hook: Hardware Event Capture (sgimacog-web)

### Task E1: Extend `EventMarker` type

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/src/hooks/useDevice.ts:50` (the type alias)
- Modify: `/Users/swryociao/sgimacog-web/web/src/components/views/WaveformView.tsx:8-15` (the interface)

- [ ] **Step 1: Replace useDevice.ts line 50**

```ts
export type EventMarker = {
  id: string;
  time: number;
  label: string;
  /** Source kind. Defaults to 'software' when omitted (backward compat). */
  kind?: 'software' | 'hardware';
  /** Origin device for hardware events; undefined for software. */
  deviceId?: string;
};
```

- [ ] **Step 2: Update WaveformView.tsx EventMarker interface**

Open `/Users/swryociao/sgimacog-web/web/src/components/views/WaveformView.tsx` lines 8–15. Add `kind` field:

```ts
export interface EventMarker {
  id: string;
  time: number;
  label: string;
  sweepPos: number;
  totalSweep: number;
  /** 'software' (red dashed, default) or 'hardware' (green solid). */
  kind?: 'software' | 'hardware';
}
```

- [ ] **Step 3: Verify with tsc**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/hooks/useDevice.ts web/src/components/views/WaveformView.tsx
git commit -m "feat(types): add kind to EventMarker (software | hardware)"
```

### Task E2: Wire hardware event detection in `useDevice.ts` sample collection loop

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/src/hooks/useDevice.ts:100-103` (refs declaration)
- Modify: `/Users/swryociao/sgimacog-web/web/src/hooks/useDevice.ts:241-262` (sample collection effect)

- [ ] **Step 1: Add new ref for pending hardware marker (broadcast inbound)**

Replace lines 100–103 (the `// ── Event markers ──` block) with:

```tsx
  // ── Event markers ──
  const [eventMarkers, setEventMarkers] = useState<EventMarker[]>([]);
  const pendingMarkerRef = useRef<EventMarker | null>(null);
  /** Hardware-marker value queued for the next packet (set by broadcast listener). */
  const pendingHardwareMarkerRef = useRef<number | null>(null);
```

- [ ] **Step 2: Update sample collection effect (lines 241–262) to handle hardware events**

Replace lines 241–262 with:

```tsx
  // ── Collect recording samples ──
  useEffect(() => {
    if (!isRecording) return;
    for (const pkt of latestPackets) {
      if (!pkt.eegChannels || pkt.eegChannels.length < effectiveChannelCountRef.current) continue;
      recordTimestampRef.current += 1 / effectiveSampleRateRef.current;

      // Software marker (BroadcastChannel) injection — first non-null is consumed
      let softwareMarkerId: string | undefined;
      let softwareMarkerName: string | undefined;
      if (pendingMarkerRef.current) {
        softwareMarkerId = pendingMarkerRef.current.id;
        softwareMarkerName = pendingMarkerRef.current.label;
        pendingMarkerRef.current = null;
      }

      // Hardware event: prefer the byte from this packet; fall back to broadcast-injected value.
      // Filter 0 (firmware idle).
      let hardwareEvent: number | undefined;
      if (pkt.event != null && pkt.event !== 0) {
        hardwareEvent = pkt.event;
      } else if (pendingHardwareMarkerRef.current != null) {
        hardwareEvent = pendingHardwareMarkerRef.current;
        pendingHardwareMarkerRef.current = null;
      }

      recordSamplesRef.current.push({
        timestamp: recordTimestampRef.current,
        serialNumber: pkt.serialNumber,
        channels: new Float32Array(pkt.eegChannels),
        hardwareEvent,
        softwareMarkerId,
        softwareMarkerName,
      });
    }
  }, [latestPackets, isRecording]);
```

- [ ] **Step 3: Run tsc**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors. (csvWriter.ts already accepts the new field names.)

- [ ] **Step 4: Run all tests**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx vitest run
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/hooks/useDevice.ts
git commit -m "feat(useDevice): capture hardware event byte into RecordedSample"
```

### Task E3: Dispatch `hardware-marker-visual` CustomEvent + side-list callback

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/src/hooks/useDevice.ts` (sample-collection effect, the same block from Task E2)
- Reference: `RecordView.tsx` will pass `onHardwareEventMarker` prop in Phase F

- [ ] **Step 1: Add prop to `useDevice` parameters**

Find the `useDevice(...)` function signature (around line 40 — the props it accepts). Add:

```ts
  onHardwareEventMarker?: (m: { value: number; deviceId: string; timestamp: number }) => void;
```

If `useDevice` currently takes individual params (not an object), add it as the next named param. If the surrounding code uses default destructuring like `function useDevice({ ... }: Props)`, add to the `Props` interface.

- [ ] **Step 2: After `recordSamplesRef.current.push(...)` in the sample loop, emit events when hardware event is set**

Append inside the `for` loop, after `recordSamplesRef.current.push(...)`:

```tsx
      if (hardwareEvent !== undefined) {
        const evDeviceId = deviceIdRef.current ?? 'unknown';
        const evTimestamp = Date.now();
        // 1. Visual line on this device's waveform
        window.dispatchEvent(new CustomEvent('hardware-marker-visual', {
          detail: { value: hardwareEvent, deviceId: evDeviceId, timestamp: evTimestamp },
        }));
        // 2. Side-list entry (RecordView wires the callback)
        onHardwareEventMarker?.({ value: hardwareEvent, deviceId: evDeviceId, timestamp: evTimestamp });
      }
```

- [ ] **Step 3: Verify tsc**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/hooks/useDevice.ts
git commit -m "feat(useDevice): emit hardware-marker-visual + side-list callback"
```

### Task E4: Listen for `hardware-marker-broadcast` (broadcast inbound)

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/src/hooks/useDevice.ts` (add new useEffect)

- [ ] **Step 1: Add a broadcast-listener effect after the existing event-marker logic**

Insert a new useEffect inside the hook body:

```tsx
  // ── Listen for cross-device hardware-marker broadcasts ──
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ value: number; originDeviceId: string }>;
      const own = deviceIdRef.current;
      if (!own) return;
      // Skip our own broadcast — source already recorded it directly via pkt.event.
      if (ce.detail.originDeviceId === own) return;
      // Queue the value for the next packet on this device.
      pendingHardwareMarkerRef.current = ce.detail.value;
    };
    window.addEventListener('hardware-marker-broadcast', handler);
    return () => window.removeEventListener('hardware-marker-broadcast', handler);
  }, []);
```

- [ ] **Step 2: Verify tsc**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Run vitest**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx vitest run
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/hooks/useDevice.ts
git commit -m "feat(useDevice): listen for hardware-marker-broadcast and inject into next packet"
```

---

## Phase F — RecordView: Broadcast Toggle + Plumbing (sgimacog-web)

### Task F1: Add `broadcastHardwareMarker` state + UI toggle

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/src/components/views/RecordView.tsx`

- [ ] **Step 1: Add useState for the toggle near the top of the component**

In `RecordView` function body (after existing state declarations, around line 130):

```tsx
  const [broadcastHardwareMarker, setBroadcastHardwareMarker] = useState(false);
```

- [ ] **Step 2: Add the checkbox UI in the recording-controls toolbar area**

Find the existing recording controls section (search for "錄製" or the start/stop button block). Add nearby:

```tsx
  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={broadcastHardwareMarker}
      onChange={(e) => setBroadcastHardwareMarker(e.target.checked)}
    />
    <span>硬體 marker 廣播至所有錄製中的裝置</span>
  </label>
```

(Match surrounding styling — use the same `className` patterns as adjacent labels.)

- [ ] **Step 3: Verify tsc + bun run dev visually**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx tsc --noEmit
```

```bash
cd /Users/swryociao/sgimacog-web/web && bun run dev
```

Open the app, confirm the checkbox renders. Stop dev server.

- [ ] **Step 4: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/components/views/RecordView.tsx
git commit -m "feat(record): broadcast hardware marker toggle UI"
```

### Task F2: Wire `onHardwareEventMarker` callback through

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/src/components/views/RecordView.tsx`
- Modify: where `useDevice` is called (likely `App.tsx` or the parent component)

- [ ] **Step 1: Trace where useDevice is invoked**

```bash
grep -rn "useDevice(" /Users/swryociao/sgimacog-web/web/src --include='*.tsx' --include='*.ts' | head
```

Identify the call site (e.g. `App.tsx` or a per-device wrapper component).

- [ ] **Step 2: Pass `onHardwareEventMarker` callback**

Wherever `useDevice` is called, supply the handler. Pattern:

```tsx
  const handleHardwareEventMarker = useCallback((m: { value: number; deviceId: string; timestamp: number }) => {
    // 1. Add to side list (kind='hardware')
    setEventMarkers(prev => [...prev, {
      id: `hw-${m.deviceId}-${m.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
      time: m.timestamp,
      label: `H${m.value}`,
      kind: 'hardware',
      deviceId: m.deviceId,
    }]);
    // 2. If broadcast toggle is on, fan out to other useDevice instances
    if (broadcastHardwareMarkerRef.current) {
      window.dispatchEvent(new CustomEvent('hardware-marker-broadcast', {
        detail: { value: m.value, originDeviceId: m.deviceId },
      }));
    }
  }, []);

  // Use a ref for broadcast flag so the callback above stays stable.
  const broadcastHardwareMarkerRef = useRef(false);
  useEffect(() => { broadcastHardwareMarkerRef.current = broadcastHardwareMarker; }, [broadcastHardwareMarker]);

  // ...
  const device = useDevice({
    /* existing props */,
    onHardwareEventMarker: handleHardwareEventMarker,
  });
```

If `setEventMarkers` lives inside `useDevice`, expose it via the hook return value or move the side-list state to RecordView instead.

- [ ] **Step 3: Verify tsc**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/components/views/RecordView.tsx web/src/App.tsx web/src/hooks/useDevice.ts
git commit -m "feat(record): wire hardware-event-marker callback to side list and broadcast"
```

---

## Phase G — WaveformView: Hardware Marker Drawing (sgimacog-web)

### Task G1: Add `drawHardwareMarkerVisualOnly` + listener

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/src/components/views/WaveformView.tsx:379-400`

- [ ] **Step 1: Add the new draw function right after `drawMarkerVisualOnly` (around line 385)**

```tsx
  const drawHardwareMarkerVisualOnly = useCallback((label: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    const time = Date.now();
    const newMarker: EventMarker = {
      id, time, label,
      sweepPos: sweepPosRef.current,
      totalSweep: totalSweepRef.current,
      kind: 'hardware',
    };
    markersRef.current = [...markersRef.current, newMarker];
    setMarkers(markersRef.current);
  }, []);
```

- [ ] **Step 2: Add the new listener useEffect after the existing themynd-marker-visual one (after line 400)**

```tsx
  // Listen for hardware-event marker visual events (from useDevice.ts).
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ value: number; deviceId: string; timestamp: number }>;
      // Source filter — multi-device safety: only draw on this view's own device.
      if (ce.detail.deviceId !== deviceId) return;
      const shouldFire = isFocused !== undefined
        ? isFocused
        : (canvasRef.current?.offsetParent !== null);
      if (!shouldFire) return;
      drawHardwareMarkerVisualOnly(`H${ce.detail.value}`);
    };
    window.addEventListener('hardware-marker-visual', handler);
    return () => window.removeEventListener('hardware-marker-visual', handler);
  }, [drawHardwareMarkerVisualOnly, isFocused, deviceId]);
```

(`deviceId` is already a prop to WaveformView per RecordView.tsx:112.)

- [ ] **Step 3: Update the canvas-render block to use kind for color/style**

Find the marker-rendering loop in `WaveformView.tsx` (search for `markersRef.current` inside the canvas draw fn). Modify the per-marker line draw to:

```tsx
        const isHw = marker.kind === 'hardware';
        ctx.strokeStyle = isHw ? '#43a047' : '#e53935';
        ctx.setLineDash(isHw ? [] : [4, 4]);
        ctx.lineWidth = isHw ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
        ctx.setLineDash([]);
```

(If existing code uses different variable names for the canvas context or x position, preserve those — only change the styling block.)

- [ ] **Step 4: tsc**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/components/views/WaveformView.tsx
git commit -m "feat(waveform): listener + green solid line for hardware markers"
```

### Task G2: Style hardware markers in side-list rendering

**Files:**
- Modify: wherever `eventMarkers` are rendered as a list (search for usage)

- [ ] **Step 1: Locate the side-list rendering**

```bash
grep -rn "eventMarkers\.map\|markers\.map" /Users/swryociao/sgimacog-web/web/src --include='*.tsx' | head
```

- [ ] **Step 2: Inside the `.map(...)` render, branch on `marker.kind`**

```tsx
{eventMarkers.map((m) => (
  <div
    key={m.id}
    className={`event-marker-row ${m.kind === 'hardware' ? 'hw' : 'sw'}`}
    style={{ borderLeft: `3px solid ${m.kind === 'hardware' ? '#43a047' : '#e53935'}` }}
  >
    <span className="time">{new Date(m.time).toLocaleTimeString()}</span>
    <span className="label">{m.label}</span>
    {m.kind === 'hardware' && m.deviceId && (
      <span className="device-tag" style={{ fontSize: '0.75em', opacity: 0.7 }}>{m.deviceId.replace('STEEG_', '')}</span>
    )}
  </div>
))}
```

(Adapt to the existing class structure / styling in this codebase — preserve all existing `className`s; only add the conditional tint and the device tag.)

- [ ] **Step 3: tsc + visual check**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx tsc --noEmit && bun run dev
```

Manually verify in browser the list renders with both software (red) and hardware (green) styles. Stop server.

- [ ] **Step 4: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/components/views/RecordView.tsx
git commit -m "feat(record): style hardware vs software markers in side list"
```

---

## Phase H — Manual Verification (sgimacog-web)

These tests require a real STEEG device that can produce a hardware event byte. If multiple devices are unavailable, simulate broadcast by hand-injecting a CustomEvent in the dev console.

- [ ] **Test H1: Single device — trigger emits green line + list entry + CSV row**

1. Connect 1 STEEG device, start recording
2. Generate a hardware trigger (external TTL → Tag 7 byte = e.g. 5)
3. Confirm: waveform shows green solid vertical line labeled `H5`; side list shows green-bordered row `H5 + deviceId`; on stop, downloaded CSV has `Event Id = 5` in matching row

- [ ] **Test H2: 4 devices Local mode — only triggered device records**

1. Connect 4 STEEG devices, all start recording, broadcast checkbox OFF
2. Trigger device A only
3. Confirm: A's waveform draws green line; B/C/D do NOT; A's CSV has `Event Id = N`; B/C/D CSV's `Event Id` columns empty

- [ ] **Test H3: 4 devices Broadcast mode — all record marker**

1. Same setup, broadcast checkbox ON
2. Trigger device A only
3. Confirm: ALL 4 waveforms draw green lines (with each device's own deviceId tag in side list); ALL 4 CSVs have `Event Id = N` (timestamps differ slightly per device's own packet timeline)

- [ ] **Test H4: Software marker still works after refactor**

1. Open THEMynd in another tab and run any task
2. Confirm: red dashed lines still draw on the focused waveform; side list shows red-bordered rows; CSV `Software Marker = "1101"` (or other ID), `Software Marker Name = "stim_target"` (or matching label)
3. Confirm: `Event Id` column is EMPTY for these rows (it's now hardware-only)

- [ ] **Test H5: Old CSV reads back correctly**

1. Take a CSV exported from the previous version (with `Software Marker = 1` flag)
2. Use the existing CSV-load feature in RecordView to re-open it
3. Confirm: software markers still appear in the side list with correct labels; no false hardware markers

- [ ] **Test H6: Broadcast self-skip**

1. 2 devices, both with hardware lines wired (or simulate by calling `dispatchEvent` from console)
2. Trigger device A only with broadcast ON
3. Confirm: A logs the event ONCE in its own CSV — not twice (no self-injection from its own broadcast)

If any test fails, fix and re-run before continuing.

---

## Phase I — Version Bump + Deploy (sgimacog-web)

### Task I1: Bump version to 0.7.0

**Files:**
- Modify: `/Users/swryociao/sgimacog-web/web/package.json`

- [ ] **Step 1: Use npm to bump minor**

```bash
cd /Users/swryociao/sgimacog-web/web && npm version minor --no-git-tag-version
```

Expected: version becomes `0.7.0`.

- [ ] **Step 2: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/package.json
git commit -m "chore: bump version to v0.7.0 (hardware event marker)"
```

### Task I2: Deploy

- [ ] **Step 1: Build**

```bash
cd /Users/swryociao/sgimacog-web/web && bun run build
```

Expected: Vite output in `dist/`.

- [ ] **Step 2: Deploy to Cloudflare Pages**

```bash
cd /Users/swryociao/sgimacog-web/web && bunx wrangler pages deploy dist --project-name sgimacog-web --commit-dirty=true
```

- [ ] **Step 3: Push to git**

```bash
cd /Users/swryociao/sgimacog-web && git push
```

- [ ] **Step 4: Smoke-test deployed URL**

Open `eeg.sigmacog.xyz` (or `sigmacog.xyz/eeg`), connect a device, confirm the broadcast checkbox is visible and the new build loads with no console errors.

---

## Phase J — Port to NFB-Webapp (SoraMynd)

This phase mirrors phases A–I against the NFB-Webapp repo. File paths are largely identical (`crate/src/wasm_api.rs`, `web/src/hooks/useDevice.ts`, etc.), but the UI may differ — SoraMynd's training view does NOT necessarily expose a RecordView with the broadcast toggle. Validate which views need the marker plumbing.

### Task J1: Apply Phase A–B (WASM + types)

- [ ] **Step 1: Repeat Task A2 in NFB-Webapp**

Edit `/Users/swryociao/NFB-Webapp/crate/src/wasm_api.rs::packet_to_js` — add the same `event` Reflect::set block.

- [ ] **Step 2: Repeat Task A3 — rebuild WASM**

```bash
cd /Users/swryociao/NFB-Webapp && wasm-pack build crate --target bundler --out-dir web/src/pkg
```

- [ ] **Step 3: Repeat Task B1 — add `event` to TS EegPacket**

Edit `/Users/swryociao/NFB-Webapp/web/src/types/eeg.ts` (or equivalent — check actual path).

- [ ] **Step 4: Commit (one commit covering A+B)**

```bash
cd /Users/swryociao/NFB-Webapp
git add crate/src/wasm_api.rs web/src/pkg/ web/src/types/eeg.ts
git commit -m "feat: surface hardware event byte to JS (port from sgimacog-web)"
```

### Task J2: Apply Phase C–D (CSV writer + parser)

- [ ] **Step 1: Mirror Task C2 in NFB-Webapp's csvWriter.ts** (verify paths first)

```bash
ls /Users/swryociao/NFB-Webapp/web/src/services/csvWriter.ts /Users/swryociao/NFB-Webapp/web/src/services/csvParser.ts
```

If both exist, apply the exact same changes from Phase C/D. Copy `csvWriter.test.ts` and `csvParser.test.ts` from sgimacog-web alongside.

- [ ] **Step 2: Run vitest**

```bash
cd /Users/swryociao/NFB-Webapp/web && bunx vitest run
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/NFB-Webapp
git add web/src/services/csvWriter.ts web/src/services/csvParser.ts web/src/services/csvWriter.test.ts web/src/services/csvParser.test.ts
git commit -m "feat(csv): split RecordedSample event fields + backward-compat parser"
```

### Task J3: Apply Phase E (useDevice hook changes)

- [ ] **Step 1: Apply Tasks E1–E4 to `/Users/swryociao/NFB-Webapp/web/src/hooks/useDevice.ts`**

The hook structure is shared with sgimacog-web. Make the same edits.

- [ ] **Step 2: Decide on UI integration**

SoraMynd's main view is `TrainingView`, not RecordView. The broadcast toggle might not be needed if SoraMynd is single-device by design. Two options:

- **Option A**: Hardware marker captured into CSV but no UI surfacing (no green line, no side list). Skip Phase F + G.
- **Option B**: Surface in a dedicated "EEG monitor" sub-view if SoraMynd has one.

**Default: Option A** (CSV-only) — confirm with user before proceeding to G.

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/NFB-Webapp
git add web/src/hooks/useDevice.ts
git commit -m "feat(useDevice): capture hardware event byte into RecordedSample"
```

### Task J4: Bump version + deploy

- [ ] **Step 1: Bump to v0.8.0**

```bash
cd /Users/swryociao/NFB-Webapp/web && npm version minor --no-git-tag-version
```

- [ ] **Step 2: Build + deploy**

```bash
cd /Users/swryociao/NFB-Webapp/web && bun run build && bunx wrangler pages deploy dist --project-name nfb-webapp --commit-dirty=true
```

- [ ] **Step 3: Commit + push**

```bash
cd /Users/swryociao/NFB-Webapp
git add web/package.json
git commit -m "chore: bump version to v0.8.0 (hardware event marker)"
git push
```

- [ ] **Step 4: Smoke-test deployed URL**

Open `sigmacog.xyz/soramynd`, confirm device connects and CSV export contains hardware events when triggered.

---

## Phase K — Port to poseidon

Same shape as Phase J. Poseidon's UI is multi-tab and includes its own recording view (per spec & memory `project_poseidon_v15_pending.md`).

### Task K1: Apply WASM + types + CSV (Phases A–D)

- [ ] **Step 1: Mirror Tasks A2, A3, B1**

Apply same edits to:
- `/Users/swryociao/poseidon/crate/src/wasm_api.rs::packet_to_js`
- `/Users/swryociao/poseidon/web/src/types/eeg.ts` (or actual path — verify)

Verify which build target poseidon uses:

```bash
grep -n "wasm-pack\|target" /Users/swryociao/poseidon/build.sh /Users/swryociao/poseidon/package.json 2>/dev/null
```

Use the existing target in the rebuild command.

- [ ] **Step 2: Apply Tasks C2 + D2 to poseidon's csvWriter / csvParser**

Verify paths:

```bash
ls /Users/swryociao/poseidon/web/src/services/csvWriter.ts /Users/swryociao/poseidon/web/src/services/csvParser.ts
```

- [ ] **Step 3: Run vitest**

```bash
cd /Users/swryociao/poseidon/web && bunx vitest run
```

- [ ] **Step 4: Commit**

```bash
cd /Users/swryociao/poseidon
git add crate/src/wasm_api.rs web/src/pkg/ web/src/types/eeg.ts web/src/services/csvWriter.ts web/src/services/csvParser.ts web/src/services/csvWriter.test.ts web/src/services/csvParser.test.ts
git commit -m "feat: surface hardware event byte + split CSV event fields (port)"
```

### Task K2: Apply useDevice + RecordView changes (Phases E + F + G)

- [ ] **Step 1: Locate poseidon's recording view + useDevice equivalent**

```bash
grep -rln "useDevice\|recordSamplesRef" /Users/swryociao/poseidon/web/src --include='*.ts' --include='*.tsx' | head
```

- [ ] **Step 2: Apply Tasks E1–E4 + F1–F2 + G1–G2 to those files**

If poseidon's recording UI is in a different component (e.g. `OnlineView.tsx` or similar tab), apply broadcast toggle + side-list logic there instead.

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/poseidon
git add web/src/hooks/ web/src/components/
git commit -m "feat: hardware marker UI (waveform line + side list + broadcast toggle)"
```

### Task K3: Manual verification + version bump + deploy

- [ ] **Step 1: Repeat Phase H tests inside poseidon**

- [ ] **Step 2: Bump to v1.10.0**

```bash
cd /Users/swryociao/poseidon/web && npm version minor --no-git-tag-version
```

- [ ] **Step 3: Build + deploy**

```bash
cd /Users/swryociao/poseidon/web && bun run build && bunx wrangler pages deploy dist --project-name poseidon-web --commit-dirty=true
```

(Verify project name with `~/bin/sigmacog-deploy` or wrangler.toml.)

- [ ] **Step 4: Commit + push**

```bash
cd /Users/swryociao/poseidon
git add web/package.json
git commit -m "chore: bump version to v1.10.0 (hardware event marker)"
git push
```

---

## Phase L — Update Memory

- [ ] **Step 1: Update `~/.claude/projects/-Users-swryociao/memory/project_eeg_marker_protocol.md`**

Add a new section "Hardware Marker Protocol" alongside the existing software marker docs:

```
## Hardware Marker (TLV Tag 7)
- Source: STEEG firmware, edge / one-shot (idle = 0)
- WASM: packet.event: number | null in packet_to_js (sgimacog/SoraMynd/poseidon)
- JS event: window CustomEvent 'hardware-marker-visual' { value, deviceId, timestamp }
- Broadcast: window CustomEvent 'hardware-marker-broadcast' { value, originDeviceId } when toggle ON
- CSV: 'Event Id' column = hardware byte; 'Software Marker' column = software ID; both flow independently
- Spec: sgimacog-web/docs/superpowers/specs/2026-05-01-eeg-hardware-event-marker-design.md
```

- [ ] **Step 2: Commit (memory is on a separate branch / no git for some users — verify before commit)**

If the memory dir is git-tracked, commit. Otherwise just save the file.

---

## Done

The hardware event byte is now end-to-end wired across all three apps:
- WASM exposes `event: number | null`
- JS filters non-zero, writes to `RecordedSample.hardwareEvent`
- WaveformView draws green solid line filtered by deviceId
- RecordView side list shows green-bordered rows with deviceId tag
- CSV `Event Id` column carries hardware byte; `Software Marker` carries software ID
- Optional broadcast mode replicates marker into all recording devices
- Backward-compat: old CSVs (where `Software Marker = "1"` flag) parse correctly into `softwareMarkerId`
