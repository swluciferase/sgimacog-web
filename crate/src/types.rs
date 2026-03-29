// Tag ID constants
pub const TAG_SERIAL: u8 = 1;
pub const TAG_AUX: u8 = 2;
pub const TAG_EEG: u8 = 3;
pub const TAG_GSENSOR: u8 = 4;
pub const TAG_BATTERY: u8 = 6;
pub const TAG_EVENT: u8 = 7;
pub const TAG_COMMAND: u8 = 8;
pub const TAG_CONN_STATUS: u8 = 9;
pub const TAG_SYNCTICK: u8 = 10;
pub const TAG_EULER: u8 = 11;

// Scale constants
pub const GYRO_SCALE: f64 = 262.4;
pub const ACCEL_SCALE: f64 = 16384.0;
pub const EEG_UV_SCALE: f64 = 4_500_000.0 / (8_388_607.0 * 12.0);
pub const EEG_CHANNELS: u8 = 8;
pub const AUX_CHANNELS: u8 = 8;

/// Raw EEG data from 8 channels.
#[derive(Clone, Debug, PartialEq)]
pub struct EegData {
    pub channels: Vec<i32>,
}

impl EegData {
    /// Convert raw int24 ADC counts to microvolts (µV).
    pub fn channels_uv(&self) -> Vec<f64> {
        self.channels
            .iter()
            .map(|ch| *ch as f64 * EEG_UV_SCALE)
            .collect()
    }
}

/// Auxiliary data from 8 channels.
#[derive(Clone, Debug, PartialEq)]
pub struct AuxData {
    pub channels: Vec<i32>,
}

impl AuxData {
    /// Convert raw int24 ADC counts to microvolts (µV).
    pub fn channels_uv(&self) -> Vec<f64> {
        self.channels
            .iter()
            .map(|ch| *ch as f64 * EEG_UV_SCALE)
            .collect()
    }
}

/// Gyroscope and accelerometer data.
///
/// If tag_len=6 on the wire (3 int16), only gyro values are populated;
/// accel defaults to 0. If tag_len=12 (6 int16), all values are present.
#[derive(Clone, Debug, PartialEq)]
pub struct GSensorData {
    pub gyro_x: i16,
    pub gyro_y: i16,
    pub gyro_z: i16,
    pub accel_x: i16,
    pub accel_y: i16,
    pub accel_z: i16,
}

impl GSensorData {
    /// Convert raw gyro values to degrees per second.
    pub fn gyro_dps(&self) -> (f64, f64, f64) {
        (
            self.gyro_x as f64 / GYRO_SCALE,
            self.gyro_y as f64 / GYRO_SCALE,
            self.gyro_z as f64 / GYRO_SCALE,
        )
    }

    /// Convert raw accelerometer values to G.
    pub fn accel_g(&self) -> (f64, f64, f64) {
        (
            self.accel_x as f64 / ACCEL_SCALE,
            self.accel_y as f64 / ACCEL_SCALE,
            self.accel_z as f64 / ACCEL_SCALE,
        )
    }
}

/// Battery status information.
#[derive(Clone, Debug, PartialEq)]
pub struct BatteryStatus {
    pub level: u8,
}

impl BatteryStatus {
    /// Check if device is charging (level == 120).
    pub fn is_charging(&self) -> bool {
        self.level == 120
    }
}

/// Euler orientation angles from Tag 11 (roll, pitch, yaw in degrees).
#[derive(Clone, Debug, PartialEq)]
pub struct EulerAngles {
    pub roll: f32,
    pub pitch: f32,
    pub yaw: f32,
}

/// Complete EEG packet with all optional fields.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EegPacket {
    pub serial_number: Option<u32>,
    pub eeg_data: Option<EegData>,
    pub aux_data: Option<AuxData>,
    pub gsensor: Option<GSensorData>,
    pub battery: Option<BatteryStatus>,
    pub event: Option<u8>,
    pub conn_status: Option<u8>,
    pub synctick: Option<u32>,
    pub euler: Option<EulerAngles>,
    pub machine_info: Option<Vec<u8>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eeg_uv_scale_value() {
        // Verify EEG_UV_SCALE matches Python: 4_500_000.0 / (8_388_607.0 * 12.0)
        let expected = 4_500_000.0 / (8_388_607.0 * 12.0);
        assert!((EEG_UV_SCALE - expected).abs() < 1e-15);
    }

    #[test]
    fn test_eeg_channels_uv_conversion() {
        let eeg = EegData {
            channels: vec![1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000],
        };
        let uv = eeg.channels_uv();
        assert_eq!(uv.len(), 8);
        // Verify first channel: 1000 * EEG_UV_SCALE
        assert!((uv[0] - 1000.0 * EEG_UV_SCALE).abs() < 1e-10);
    }

    #[test]
    fn test_aux_channels_uv_conversion() {
        let aux = AuxData {
            channels: vec![100, 200, 300, 400, 500, 600, 700, 800],
        };
        let uv = aux.channels_uv();
        assert_eq!(uv.len(), 8);
        assert!((uv[0] - 100.0 * EEG_UV_SCALE).abs() < 1e-10);
    }

    #[test]
    fn test_gyro_dps_conversion() {
        let gsensor = GSensorData {
            gyro_x: 262,
            gyro_y: 524,
            gyro_z: 786,
            accel_x: 0,
            accel_y: 0,
            accel_z: 0,
        };
        let (gx, gy, gz) = gsensor.gyro_dps();
        assert!((gx - 262.0 / GYRO_SCALE).abs() < 1e-10);
        assert!((gy - 524.0 / GYRO_SCALE).abs() < 1e-10);
        assert!((gz - 786.0 / GYRO_SCALE).abs() < 1e-10);
    }

    #[test]
    fn test_accel_g_conversion() {
        let gsensor = GSensorData {
            gyro_x: 0,
            gyro_y: 0,
            gyro_z: 0,
            accel_x: 16384,
            accel_y: 16384,
            accel_z: -16384,
        };
        let (ax, ay, az) = gsensor.accel_g();
        assert!((ax - 1.0).abs() < 1e-10);
        assert!((ay - 1.0).abs() < 1e-10);
        assert!((az - (-1.0)).abs() < 1e-10);
    }

    #[test]
    fn test_battery_is_charging() {
        let charging = BatteryStatus { level: 120 };
        assert!(charging.is_charging());

        let not_charging = BatteryStatus { level: 100 };
        assert!(!not_charging.is_charging());
    }

    #[test]
    fn test_eeg_packet_creation() {
        let packet = EegPacket {
            serial_number: Some(12345),
            eeg_data: Some(EegData {
                channels: vec![0; 8],
            }),
            aux_data: None,
            gsensor: None,
            battery: None,
            event: None,
            conn_status: None,
            synctick: None,
            euler: None,
            machine_info: None,
        };
        assert_eq!(packet.serial_number, Some(12345));
        assert!(packet.eeg_data.is_some());
    }
}
