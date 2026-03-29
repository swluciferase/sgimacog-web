use std::collections::HashMap;

pub const SAMPLE_RATE: f64 = 500.0;
pub const IMPEDANCE_FREQ_HZ: f64 = 7.8;

#[derive(Clone, Debug, PartialEq)]
pub struct ImpedanceResult {
    pub channel: usize,
    pub ac_amplitude: f64,
    pub impedance_kohm: f64,
}

impl ImpedanceResult {
    pub fn impedance_ohm(&self) -> f64 {
        self.impedance_kohm * 1000.0
    }

    pub fn quality(&self) -> &str {
        if self.impedance_kohm < 150.0 { return "excellent"; }
        if self.impedance_kohm < 300.0 { return "good"; }
        if self.impedance_kohm < 600.0 { return "poor"; }
        "bad"
    }
}

pub fn find_freq_bin(fft_points: usize, sample_rate: f64, target_freq: f64) -> usize {
    let freq_resolution = sample_rate / fft_points as f64;
    (target_freq / freq_resolution).round() as usize
}

pub fn amplitude_to_impedance(ac_amp: f64) -> f64 {
    let x = ac_amp;
    let raw = 5e-11 * x.powi(4) - 1e-6 * x.powi(3) + 0.0129 * x.powi(2) + 129.73 * x + 5520.2;
    raw * 0.001
}

pub fn compute_impedance_from_samples(
    samples: &[f64],
    channel: usize,
    sample_rate: f64,
) -> ImpedanceResult {
    assert!(!samples.is_empty(), "samples must not be empty");

    let n = samples.len();
    let freq_idx = find_freq_bin(n, sample_rate, IMPEDANCE_FREQ_HZ);

    let mut real_sum = 0.0;
    let mut imag_sum = 0.0;
    for (i, sample) in samples.iter().enumerate() {
        let angle = -2.0 * std::f64::consts::PI * freq_idx as f64 * i as f64 / n as f64;
        real_sum += sample * angle.cos();
        imag_sum += sample * angle.sin();
    }

    let magnitude = (real_sum.powi(2) + imag_sum.powi(2)).sqrt();
    let ac_amp = magnitude / (n as f64 / 2.0);
    let impedance_kohm = amplitude_to_impedance(ac_amp);

    ImpedanceResult {
        channel,
        ac_amplitude: ac_amp,
        impedance_kohm,
    }
}

pub fn compute_all_channel_impedances(
    channel_windows: &HashMap<usize, Vec<f64>>,
    sample_rate: f64,
) -> Vec<ImpedanceResult> {
    let mut keys: Vec<usize> = channel_windows.keys().copied().collect();
    keys.sort_unstable();

    let mut results = Vec::with_capacity(keys.len());
    for ch_idx in keys {
        if let Some(samples) = channel_windows.get(&ch_idx) {
            let result = compute_impedance_from_samples(samples, ch_idx, sample_rate);
            results.push(result);
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_freq_bin_exact_bin() {
        assert_eq!(find_freq_bin(500, 500.0, 7.8), 8);
    }

    #[test]
    fn test_find_freq_bin_256_point_fft() {
        assert_eq!(find_freq_bin(256, 500.0, 7.8), 4);
    }

    #[test]
    fn test_find_freq_bin_1024_point_fft() {
        assert_eq!(find_freq_bin(1024, 500.0, 7.8), 16);
    }

    #[test]
    fn test_find_freq_bin_zero_freq() {
        assert_eq!(find_freq_bin(512, 500.0, 0.0), 0);
    }

    #[test]
    fn test_amplitude_to_impedance_zero() {
        let result = amplitude_to_impedance(0.0);
        assert!((result - 5.5202).abs() < 0.001);
    }

    #[test]
    fn test_amplitude_to_impedance_100_matches_python() {
        let result = amplitude_to_impedance(100.0);
        let expected = 18.621205;
        println!("rust_amplitude_to_impedance_100={result:.10}");
        assert!((result - expected).abs() < 1e-6);
    }

    #[test]
    fn test_amplitude_to_impedance_large() {
        let x: f64 = 10000.0;
        let expected =
            (5e-11 * x.powi(4) - 1e-6 * x.powi(3) + 0.0129 * x.powi(2) + 129.73 * x + 5520.2)
                * 0.001;
        let result = amplitude_to_impedance(x);
        assert!((result - expected).abs() < 0.1);
    }

    #[test]
    fn test_impedance_result_impedance_ohm_conversion() {
        let result = ImpedanceResult {
            channel: 0,
            ac_amplitude: 1.0,
            impedance_kohm: 10.0,
        };
        assert_eq!(result.impedance_ohm(), 10000.0);
    }

    #[test]
    fn test_impedance_result_quality_thresholds() {
        let excellent = ImpedanceResult { channel: 0, ac_amplitude: 1.0, impedance_kohm: 100.0 };
        let good = ImpedanceResult { channel: 1, ac_amplitude: 1.0, impedance_kohm: 200.0 };
        let poor = ImpedanceResult { channel: 2, ac_amplitude: 1.0, impedance_kohm: 400.0 };
        let bad = ImpedanceResult { channel: 3, ac_amplitude: 1.0, impedance_kohm: 700.0 };
        assert_eq!(excellent.quality(), "excellent");
        assert_eq!(good.quality(), "good");
        assert_eq!(poor.quality(), "poor");
        assert_eq!(bad.quality(), "bad");
    }

    #[test]
    fn test_compute_impedance_from_samples_pure_sine_at_target_freq() {
        let n = 500;
        // Input is in µV — 1000 µV peak sine at 7.8 Hz
        let samples: Vec<f64> = (0..n)
            .map(|i| {
                1000.0
                    * (2.0 * std::f64::consts::PI * IMPEDANCE_FREQ_HZ * i as f64 / SAMPLE_RATE)
                        .sin()
            })
            .collect();

        let result = compute_impedance_from_samples(&samples, 0, SAMPLE_RATE);
        assert_eq!(result.channel, 0);
        // DFT magnitude / (n/2) for a 1000 µV peak sine ≈ 937.49 µV
        let expected_amplitude = 937.4867778723;
        println!("rust_dft_amplitude={:.10}", result.ac_amplitude);
        assert!((result.ac_amplitude - expected_amplitude).abs() < 1e-6);
        assert!(result.impedance_kohm > 0.0);
    }

    #[test]
    fn test_compute_impedance_from_samples_dc_signal_low_amplitude() {
        // DC signal in µV — 7.8 Hz component should be near zero
        let samples = vec![1000.0_f64; 500];
        let result = compute_impedance_from_samples(&samples, 5, SAMPLE_RATE);
        assert_eq!(result.channel, 5);
        assert!(result.ac_amplitude < 1.0);
        assert!(result.impedance_kohm > 0.0);
    }

    #[test]
    #[should_panic(expected = "samples must not be empty")]
    fn test_compute_impedance_from_samples_empty_panics() {
        let _ = compute_impedance_from_samples(&[], 0, SAMPLE_RATE);
    }

    #[test]
    fn test_compute_all_channel_impedances_sorted_and_complete() {
        let mut windows = HashMap::new();
        windows.insert(3, vec![0; 100]);
        windows.insert(0, vec![0; 100]);
        windows.insert(7, vec![0; 100]);

        let results = compute_all_channel_impedances(&windows, SAMPLE_RATE);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].channel, 0);
        assert_eq!(results[1].channel, 3);
        assert_eq!(results[2].channel, 7);
    }

    #[test]
    fn test_compute_all_channel_impedances_empty() {
        let windows: HashMap<usize, Vec<i32>> = HashMap::new();
        let results = compute_all_channel_impedances(&windows, SAMPLE_RATE);
        assert!(results.is_empty());
    }
}
