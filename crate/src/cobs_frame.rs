/// COBS decoding and frame accumulation for the STeEG serial protocol.
///
/// The device sends COBS-encoded TLV packets separated by 0x00 sentinel bytes.
/// `FrameAccumulator` splits the byte stream on 0x00 delimiters, and
/// `decode_cobs_frame` decodes individual COBS frames back to raw TLV payloads.

extern crate alloc;
use alloc::vec::Vec;

pub const MAX_FRAME_SIZE: usize = 400;
pub const MIN_FRAME_SIZE: usize = 3;

/// Decode a raw COBS frame (without the 0x00 delimiter).
///
/// The input should be the bytes between two 0x00 sentinels — the accumulator
/// strips the delimiters before calling this function.
///
/// Returns `None` on any decode error (corrupted frame).
pub fn decode_cobs_frame(raw: &[u8]) -> Option<Vec<u8>> {
    // cobs::decode_vec auto-appends the sentinel if missing,
    // so passing raw bytes without trailing 0x00 works correctly.
    cobs::decode_vec(raw).ok()
}

/// Accumulates bytes from the serial stream and yields complete COBS frames.
///
/// Splits incoming data on 0x00 delimiter bytes. The first segment is always
/// discarded (may be a partial frame from mid-stream connection). Empty segments
/// and segments outside the valid size range are silently dropped.
pub struct FrameAccumulator {
    buf: Vec<u8>,
    first: bool,
}

impl Default for FrameAccumulator {
    fn default() -> Self {
        Self::new()
    }
}

impl FrameAccumulator {
    pub fn new() -> Self {
        Self {
            buf: Vec::new(),
            first: true,
        }
    }

    /// Feed new data into the accumulator. Returns a list of complete
    /// raw COBS frames (still encoded — call `decode_cobs_frame` on each).
    pub fn feed(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        self.buf.extend_from_slice(data);

        // Split on 0x00 delimiter bytes — same as Python's bytearray.split(b'\x00')
        let parts: Vec<Vec<u8>> = self
            .buf
            .split(|&b| b == 0x00)
            .map(|s| s.to_vec())
            .collect();

        // Last part is the incomplete segment (no trailing delimiter yet)
        self.buf = parts.last().cloned().unwrap_or_default();

        let mut frames = Vec::new();
        // All parts except the last are between two delimiters → complete segments
        for segment in &parts[..parts.len().saturating_sub(1)] {
            if self.first {
                self.first = false;
                continue;
            }
            if segment.is_empty() {
                continue;
            }
            if segment.len() < MIN_FRAME_SIZE || segment.len() > MAX_FRAME_SIZE {
                continue;
            }
            frames.push(segment.clone());
        }

        frames
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cobs::encode_vec;

    // ── decode_cobs_frame ──────────────────────────────────────────────

    #[test]
    fn cobs_decode_simple_roundtrip() {
        // Python: encode([0x01, 0x02, 0x03]) → [0x04, 0x01, 0x02, 0x03]
        let original = vec![0x01u8, 0x02, 0x03];
        let encoded = encode_vec(&original);
        assert_eq!(encoded, vec![0x04, 0x01, 0x02, 0x03]);
        // decode_cobs_frame receives data WITHOUT trailing 0x00
        let decoded = decode_cobs_frame(&encoded).expect("decode should succeed");
        assert_eq!(decoded, original);
    }

    #[test]
    fn cobs_decode_with_embedded_zero() {
        // Data with a zero byte inside: [0x01, 0x00, 0x03]
        let original = vec![0x01, 0x00, 0x03];
        let encoded = encode_vec(&original);
        // COBS: overhead=0x02, 0x01, then 0x02, 0x03
        assert_eq!(encoded, vec![0x02, 0x01, 0x02, 0x03]);
        let decoded = decode_cobs_frame(&encoded).expect("decode should succeed");
        assert_eq!(decoded, original);
    }

    #[test]
    fn cobs_decode_single_zero() {
        let original = vec![0x00];
        let encoded = encode_vec(&original);
        let decoded = decode_cobs_frame(&encoded).expect("decode should succeed");
        assert_eq!(decoded, original);
    }

    #[test]
    fn cobs_decode_empty_input() {
        // Empty slice → decode error → None
        assert!(decode_cobs_frame(&[]).is_none());
    }

    #[test]
    fn cobs_decode_error_returns_none() {
        // Matches Python test: bytes([0x00, 0x00, 0x00]) → None
        assert!(decode_cobs_frame(&[0x00, 0x00, 0x00]).is_none());
    }

    #[test]
    fn cobs_decode_large_roundtrip() {
        // 254 non-zero bytes — exercises the 254-byte COBS block boundary
        let original: Vec<u8> = (1..=254).collect();
        let encoded = encode_vec(&original);
        let decoded = decode_cobs_frame(&encoded).expect("decode should succeed");
        assert_eq!(decoded, original);
    }

    // ── FrameAccumulator ───────────────────────────────────────────────

    #[test]
    fn cobs_accumulator_discards_first_partial() {
        let mut acc = FrameAccumulator::new();
        // partial_frame + 0x00 + valid_frame + 0x00
        let valid_frame = vec![0x01u8; 10];
        let mut data = vec![0xAA, 0xBB]; // partial first segment
        data.push(0x00);
        data.extend_from_slice(&valid_frame);
        data.push(0x00);
        let frames = acc.feed(&data);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0], valid_frame);
    }

    #[test]
    fn cobs_accumulator_skips_empty_segments() {
        let mut acc = FrameAccumulator::new();
        // First call: discard first segment
        acc.feed(b"\x00");
        // Consecutive 0x00 bytes → empty segments → no frames
        let frames = acc.feed(b"\x00\x00\x00");
        assert_eq!(frames.len(), 0);
    }

    #[test]
    fn cobs_accumulator_skips_short_frames() {
        let mut acc = FrameAccumulator::new();
        acc.feed(b"\x00"); // discard first
        // 2-byte segment (< MIN_FRAME_SIZE=3) → dropped
        let frames = acc.feed(&[0x01, 0x02, 0x00]);
        assert_eq!(frames.len(), 0);
    }

    #[test]
    fn cobs_accumulator_rejects_oversize() {
        let mut acc = FrameAccumulator::new();
        acc.feed(b"\x00"); // discard first
        // 401-byte segment (> MAX_FRAME_SIZE=400) → dropped
        let mut oversize = vec![0x01u8; 401];
        oversize.push(0x00);
        let frames = acc.feed(&oversize);
        assert_eq!(frames.len(), 0);
    }

    #[test]
    fn cobs_accumulator_accepts_max_size() {
        let mut acc = FrameAccumulator::new();
        acc.feed(b"\x00"); // discard first
        // Exactly MAX_FRAME_SIZE bytes → accepted
        let mut frame = vec![0x01u8; MAX_FRAME_SIZE];
        frame.push(0x00);
        let frames = acc.feed(&frame);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].len(), MAX_FRAME_SIZE);
    }

    #[test]
    fn cobs_accumulator_accepts_min_size() {
        let mut acc = FrameAccumulator::new();
        acc.feed(b"\x00"); // discard first
        // Exactly MIN_FRAME_SIZE bytes → accepted
        let mut frame = vec![0x01u8; MIN_FRAME_SIZE];
        frame.push(0x00);
        let frames = acc.feed(&frame);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].len(), MIN_FRAME_SIZE);
    }

    #[test]
    fn cobs_accumulator_multi_chunk_feed() {
        // Frame split across two feed() calls
        let mut acc = FrameAccumulator::new();
        acc.feed(b"\x00"); // discard first

        // First chunk: start of frame (no delimiter yet)
        let frames = acc.feed(&[0x01, 0x02, 0x03]);
        assert_eq!(frames.len(), 0); // no complete frame yet

        // Second chunk: rest of frame + delimiter
        let frames = acc.feed(&[0x04, 0x05, 0x00]);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0], vec![0x01, 0x02, 0x03, 0x04, 0x05]);
    }

    #[test]
    fn cobs_accumulator_multiple_frames_in_one_feed() {
        let mut acc = FrameAccumulator::new();
        // 3 complete frames in one feed (first is discarded)
        let mut data = Vec::new();
        data.extend_from_slice(&[0xFF; 5]); // first segment (discarded)
        data.push(0x00);
        data.extend_from_slice(&[0x01; 10]); // frame 1
        data.push(0x00);
        data.extend_from_slice(&[0x02; 8]); // frame 2
        data.push(0x00);

        let frames = acc.feed(&data);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0], vec![0x01; 10]);
        assert_eq!(frames[1], vec![0x02; 8]);
    }

    #[test]
    fn cobs_end_to_end_accumulate_then_decode() {
        // Simulate device sending COBS-encoded packets separated by 0x00
        let payload1 = vec![0x01u8, 0x02, 0x03];
        let payload2 = vec![0x04, 0x00, 0x05]; // contains embedded zero

        let encoded1 = encode_vec(&payload1);
        let encoded2 = encode_vec(&payload2);

        // Build wire data: leading garbage + 0x00 + encoded1 + 0x00 + encoded2 + 0x00
        let mut wire = vec![0xDE, 0xAD]; // garbage first segment
        wire.push(0x00);
        wire.extend_from_slice(&encoded1);
        wire.push(0x00);
        wire.extend_from_slice(&encoded2);
        wire.push(0x00);

        let mut acc = FrameAccumulator::new();
        let raw_frames = acc.feed(&wire);
        assert_eq!(raw_frames.len(), 2);

        let decoded1 = decode_cobs_frame(&raw_frames[0]).expect("frame 1");
        let decoded2 = decode_cobs_frame(&raw_frames[1]).expect("frame 2");
        assert_eq!(decoded1, payload1);
        assert_eq!(decoded2, payload2);
    }

    #[test]
    fn cobs_constants_match_python() {
        assert_eq!(MAX_FRAME_SIZE, 400);
        assert_eq!(MIN_FRAME_SIZE, 3);
    }
}
