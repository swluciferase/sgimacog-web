use crate::types::{
    AuxData, BatteryStatus, EegData, EegPacket, EulerAngles, GSensorData, TAG_AUX, TAG_BATTERY,
    TAG_COMMAND, TAG_CONN_STATUS, TAG_EEG, TAG_EULER, TAG_EVENT, TAG_GSENSOR, TAG_SERIAL,
    TAG_SYNCTICK,
};

pub fn decode_int24(b: &[u8]) -> i32 {
    assert!(b.len() >= 3);
    let raw = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
    if raw & 0x80_0000 != 0 {
        (raw | 0xFF00_0000) as i32
    } else {
        raw as i32
    }
}

pub fn parse_tlv_packet(payload: &[u8]) -> Option<EegPacket> {
    if payload.is_empty() {
        return None;
    }

    let tag_count = payload[0] as usize;
    let mut offset = 1;
    let mut packet = EegPacket::default();

    for _ in 0..tag_count {
        if offset + 2 > payload.len() {
            return None;
        }

        let tag_id = payload[offset];
        let tag_len = payload[offset + 1] as usize;
        offset += 2;

        if offset + tag_len > payload.len() {
            return None;
        }

        let value = &payload[offset..offset + tag_len];
        offset += tag_len;

        match tag_id {
            TAG_SERIAL => {
                if tag_len != 4 {
                    return None;
                }
                packet.serial_number =
                    Some(u32::from_le_bytes([value[0], value[1], value[2], value[3]]));
            }
            TAG_AUX => {
                if tag_len == 0 || tag_len % 3 != 0 {
                    return None;
                }
                let channels: Vec<i32> = (0..tag_len / 3)
                    .map(|i| decode_int24(&value[i * 3..]))
                    .collect();
                packet.aux_data = Some(AuxData { channels });
            }
            TAG_EEG => {
                if tag_len == 0 || tag_len % 3 != 0 {
                    return None;
                }
                let channels: Vec<i32> = (0..tag_len / 3)
                    .map(|i| decode_int24(&value[i * 3..]))
                    .collect();
                packet.eeg_data = Some(EegData { channels });
            }
            TAG_GSENSOR => {
                if tag_len == 12 {
                    let vals: Vec<i16> = (0..6)
                        .map(|i| i16::from_le_bytes([value[i * 2], value[i * 2 + 1]]))
                        .collect();
                    packet.gsensor = Some(GSensorData {
                        gyro_x: vals[0],
                        gyro_y: vals[1],
                        gyro_z: vals[2],
                        accel_x: vals[3],
                        accel_y: vals[4],
                        accel_z: vals[5],
                    });
                } else if tag_len == 6 {
                    let vals: Vec<i16> = (0..3)
                        .map(|i| i16::from_le_bytes([value[i * 2], value[i * 2 + 1]]))
                        .collect();
                    packet.gsensor = Some(GSensorData {
                        gyro_x: vals[0],
                        gyro_y: vals[1],
                        gyro_z: vals[2],
                        accel_x: 0,
                        accel_y: 0,
                        accel_z: 0,
                    });
                } else {
                    return None;
                }
            }
            TAG_BATTERY => {
                if tag_len < 1 {
                    return None;
                }
                packet.battery = Some(BatteryStatus { level: value[0] });
            }
            TAG_EVENT => {
                if tag_len < 1 {
                    return None;
                }
                packet.event = Some(value[0]);
            }
            TAG_COMMAND => {
                packet.machine_info = Some(value.to_vec());
            }
            TAG_CONN_STATUS => {
                if tag_len < 1 {
                    return None;
                }
                packet.conn_status = Some(value[0]);
            }
            TAG_SYNCTICK => {
                if tag_len != 4 {
                    return None;
                }
                packet.synctick =
                    Some(u32::from_le_bytes([value[0], value[1], value[2], value[3]]));
            }
            TAG_EULER => {
                if tag_len != 12 {
                    return None;
                }
                let roll = f32::from_be_bytes([value[0], value[1], value[2], value[3]]);
                let pitch = f32::from_be_bytes([value[4], value[5], value[6], value[7]]);
                let yaw = f32::from_be_bytes([value[8], value[9], value[10], value[11]]);
                packet.euler = Some(EulerAngles { roll, pitch, yaw });
            }
            _ => {}
        }
    }

    Some(packet)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_decode_int24_positive() {
        assert_eq!(decode_int24(&[0x00, 0x00, 0x01]), 1);
    }

    #[test]
    fn protocol_decode_int24_negative_one() {
        assert_eq!(decode_int24(&[0xFF, 0xFF, 0xFF]), -1);
    }

    #[test]
    fn protocol_decode_int24_max() {
        assert_eq!(decode_int24(&[0x7F, 0xFF, 0xFF]), 8_388_607);
    }

    #[test]
    fn protocol_decode_int24_min() {
        assert_eq!(decode_int24(&[0x80, 0x00, 0x00]), -8_388_608);
    }

    #[test]
    fn protocol_parse_serial_only() {
        let payload = [1, TAG_SERIAL, 4, 0x69, 0x47, 0x05, 0x00];
        let packet = parse_tlv_packet(&payload).expect("packet");
        assert_eq!(packet.serial_number, Some(345_961));
        assert!(packet.eeg_data.is_none());
        assert!(packet.aux_data.is_none());
        assert!(packet.gsensor.is_none());
        assert!(packet.battery.is_none());
    }

    #[test]
    fn protocol_parse_eeg_8_channels() {
        let channels = [1, -1, 2, -2, 3, -3, 8_388_607, -8_388_608];
        let mut value = Vec::new();
        for ch in channels {
            let be = (ch as i32).to_be_bytes();
            value.extend_from_slice(&be[1..]);
        }

        let mut payload = vec![1, TAG_EEG, value.len() as u8];
        payload.extend_from_slice(&value);

        let packet = parse_tlv_packet(&payload).expect("packet");
        let eeg = packet.eeg_data.expect("eeg");
        assert_eq!(eeg.channels, channels);
    }

    #[test]
    fn protocol_parse_gsensor_6_bytes() {
        let vals = [100i16, -200, 300];
        let mut payload = vec![1, TAG_GSENSOR, 6];
        for v in vals {
            payload.extend_from_slice(&v.to_le_bytes());
        }

        let packet = parse_tlv_packet(&payload).expect("packet");
        let gs = packet.gsensor.expect("gsensor");
        assert_eq!(gs.gyro_x, 100);
        assert_eq!(gs.gyro_y, -200);
        assert_eq!(gs.gyro_z, 300);
        assert_eq!(gs.accel_x, 0);
        assert_eq!(gs.accel_y, 0);
        assert_eq!(gs.accel_z, 0);
    }

    #[test]
    fn protocol_parse_gsensor_12_bytes() {
        let vals = [100i16, -200, 300, -400, 500, -600];
        let mut payload = vec![1, TAG_GSENSOR, 12];
        for v in vals {
            payload.extend_from_slice(&v.to_le_bytes());
        }

        let packet = parse_tlv_packet(&payload).expect("packet");
        let gs = packet.gsensor.expect("gsensor");
        assert_eq!(gs.gyro_x, 100);
        assert_eq!(gs.gyro_y, -200);
        assert_eq!(gs.gyro_z, 300);
        assert_eq!(gs.accel_x, -400);
        assert_eq!(gs.accel_y, 500);
        assert_eq!(gs.accel_z, -600);
    }

    #[test]
    fn protocol_parse_battery() {
        let payload = [1, TAG_BATTERY, 1, 95];
        let packet = parse_tlv_packet(&payload).expect("packet");
        assert_eq!(packet.battery, Some(BatteryStatus { level: 95 }));
    }

    #[test]
    fn protocol_parse_empty_payload_returns_none() {
        assert!(parse_tlv_packet(&[]).is_none());
    }

    #[test]
    fn protocol_parse_truncated_packet_returns_none() {
        let payload = [1, TAG_SERIAL, 4, 0x01, 0x02];
        assert!(parse_tlv_packet(&payload).is_none());
    }

    #[test]
    fn protocol_parse_unknown_tag_skips() {
        let payload = [2, 99, 3, 0xAA, 0xBB, 0xCC, TAG_BATTERY, 1, 88];
        let packet = parse_tlv_packet(&payload).expect("packet");
        assert_eq!(packet.battery, Some(BatteryStatus { level: 88 }));
    }

    #[test]
    fn protocol_parse_real_device_style_tags_1_3_4_6() {
        let serial = [0x69, 0x47, 0x05, 0x00];

        let eeg_channels = [10i32, -10, 20, -20, 30, -30, 40, -40];
        let mut eeg_bytes = Vec::new();
        for ch in eeg_channels {
            let be = ch.to_be_bytes();
            eeg_bytes.extend_from_slice(&be[1..]);
        }

        let gs_vals = [11i16, -12, 13, -14, 15, -16];
        let mut gs_bytes = Vec::new();
        for v in gs_vals {
            gs_bytes.extend_from_slice(&v.to_le_bytes());
        }

        let mut payload = vec![4];
        payload.extend_from_slice(&[TAG_SERIAL, 4]);
        payload.extend_from_slice(&serial);
        payload.extend_from_slice(&[TAG_EEG, eeg_bytes.len() as u8]);
        payload.extend_from_slice(&eeg_bytes);
        payload.extend_from_slice(&[TAG_GSENSOR, 12]);
        payload.extend_from_slice(&gs_bytes);
        payload.extend_from_slice(&[TAG_BATTERY, 1, 77]);

        let packet = parse_tlv_packet(&payload).expect("packet");
        assert_eq!(packet.serial_number, Some(345_961));
        assert_eq!(
            packet.eeg_data.expect("eeg").channels,
            [10, -10, 20, -20, 30, -30, 40, -40]
        );
        let gs = packet.gsensor.expect("gsensor");
        assert_eq!(gs.gyro_x, 11);
        assert_eq!(gs.gyro_y, -12);
        assert_eq!(gs.gyro_z, 13);
        assert_eq!(gs.accel_x, -14);
        assert_eq!(gs.accel_y, 15);
        assert_eq!(gs.accel_z, -16);
        assert_eq!(packet.battery, Some(BatteryStatus { level: 77 }));
    }
}
