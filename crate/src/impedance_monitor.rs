use std::collections::HashMap;

use crate::impedance::{compute_all_channel_impedances, ImpedanceResult};
use crate::types::EegPacket;

pub struct ImpedanceMonitor {
    window_size: usize,
    sample_rate: f64,
    num_channels: usize,
    buffers: HashMap<usize, Vec<i32>>,
}

impl ImpedanceMonitor {
    pub fn new(window_size: usize, sample_rate: f64, num_channels: usize) -> Self {
        let mut buffers = HashMap::new();
        for i in 0..num_channels {
            buffers.insert(i, Vec::new());
        }

        Self {
            window_size,
            sample_rate,
            num_channels,
            buffers,
        }
    }

    pub fn feed_packet(&mut self, packet: &EegPacket) -> Option<Vec<ImpedanceResult>> {
        let eeg_data = match &packet.eeg_data {
            Some(eeg_data) => eeg_data,
            None => return None,
        };

        for (i, raw) in eeg_data.channels.iter().enumerate() {
            if i < self.num_channels {
                self.buffers.entry(i).or_default().push(*raw);
            }
        }

        let should_compute = self
            .buffers
            .get(&0)
            .map(|ch0| !ch0.is_empty() && ch0.len() >= self.window_size)
            .unwrap_or(false);

        if should_compute {
            let results = compute_all_channel_impedances(&self.buffers, self.sample_rate);
            self.clear_buffers();
            return Some(results);
        }

        None
    }

    fn clear_buffers(&mut self) {
        for buffer in self.buffers.values_mut() {
            buffer.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::types::{EegData, EegPacket};

    use super::ImpedanceMonitor;

    fn packet(channels: Vec<i32>) -> EegPacket {
        EegPacket {
            eeg_data: Some(EegData { channels }),
            ..Default::default()
        }
    }

    #[test]
    fn test_impedance_monitor_accumulates_samples() {
        let mut monitor = ImpedanceMonitor::new(5, 1001.0, 2);

        let mut result = None;
        for _ in 0..3 {
            result = monitor.feed_packet(&packet(vec![100, 200]));
        }

        assert!(result.is_none());
    }

    #[test]
    fn test_impedance_monitor_computes_after_window() {
        let mut monitor = ImpedanceMonitor::new(5, 1001.0, 2);

        let mut result = None;
        for _ in 0..5 {
            result = monitor.feed_packet(&packet(vec![100, 200]));
        }

        assert!(result.is_some());
    }

    #[test]
    fn test_impedance_monitor_output_format() {
        let mut monitor = ImpedanceMonitor::new(5, 1001.0, 2);

        let mut result = None;
        for _ in 0..5 {
            result = monitor.feed_packet(&packet(vec![100, 200]));
        }

        let output = result.expect("expected monitor output after full window");
        assert_eq!(output.len(), 2);
        for item in output {
            assert!(item.impedance_kohm > 0.0);
            assert!(!item.quality().is_empty());
        }
    }

    #[test]
    fn test_impedance_monitor_none_when_packet_has_no_eeg_data() {
        let mut monitor = ImpedanceMonitor::new(5, 1001.0, 2);
        let packet = EegPacket::default();
        let result = monitor.feed_packet(&packet);
        assert!(result.is_none());
    }

    #[test]
    fn test_impedance_monitor_clears_buffers_after_compute() {
        let mut monitor = ImpedanceMonitor::new(3, 1001.0, 1);

        for _ in 0..3 {
            let _ = monitor.feed_packet(&packet(vec![100]));
        }

        let result = monitor.feed_packet(&packet(vec![100]));
        assert!(result.is_none());
    }
}
