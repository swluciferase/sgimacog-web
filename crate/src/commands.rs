/// Command code set variants
#[derive(Clone, Debug, PartialEq)]
pub enum CodeSet {
    Reference,
    Pdf,
}

/// Enable ADC (Analog-to-Digital Converter).
pub fn cmd_adc_on() -> Vec<u8> {
    vec![0x05, 0x01, 0x08, 0x02, 0x01, 0x01, 0x00]
}

/// Disable ADC (Analog-to-Digital Converter).
pub fn cmd_adc_off() -> Vec<u8> {
    vec![0x05, 0x01, 0x08, 0x02, 0x02, 0x01, 0x00]
}

/// Enable AC impedance measurement.
///
/// Args:
///     code_set: Code set to use (Reference or Pdf).
///         - Reference: Code=0x06
///         - Pdf: Code=0x03
pub fn cmd_impedance_ac_on(code_set: CodeSet) -> Vec<u8> {
    let code = match code_set {
        CodeSet::Reference => 0x06,
        CodeSet::Pdf => 0x03,
    };
    vec![0x05, 0x01, 0x08, 0x02, code, 0x01, 0x00]
}

/// Enable DC impedance measurement.
///
/// Args:
///     code_set: Code set to use (Reference or Pdf).
///         - Reference: Code=0x05
///         - Pdf: Code=0x04
pub fn cmd_impedance_dc_on(code_set: CodeSet) -> Vec<u8> {
    let code = match code_set {
        CodeSet::Reference => 0x05,
        CodeSet::Pdf => 0x04,
    };
    vec![0x05, 0x01, 0x08, 0x02, code, 0x01, 0x00]
}

/// Disable impedance measurement.
///
/// Args:
///     code_set: Code set to use (Reference or Pdf).
///         - Reference: Code=0x07
///         - Pdf: Code=0x05
pub fn cmd_impedance_off(code_set: CodeSet) -> Vec<u8> {
    let code = match code_set {
        CodeSet::Reference => 0x07,
        CodeSet::Pdf => 0x05,
    };
    vec![0x05, 0x01, 0x08, 0x02, code, 0x01, 0x00]
}

/// Read synchronization tick. Code=0x11.
pub fn cmd_read_synctick() -> Vec<u8> {
    vec![0x05, 0x01, 0x08, 0x02, 0x11, 0x01, 0x00]
}

/// Get connection status. Code=0x12.
pub fn cmd_get_conn_status() -> Vec<u8> {
    vec![0x05, 0x01, 0x08, 0x02, 0x12, 0x01, 0x00]
}

/// Request machine info. Code=0x2E.
pub fn cmd_machine_info() -> Vec<u8> {
    vec![0x05, 0x01, 0x08, 0x02, 0x2E, 0x01, 0x00]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cmd_adc_on_bytes() {
        assert_eq!(cmd_adc_on(), vec![0x05, 0x01, 0x08, 0x02, 0x01, 0x01, 0x00]);
    }

    #[test]
    fn test_cmd_adc_off_bytes() {
        assert_eq!(cmd_adc_off(), vec![0x05, 0x01, 0x08, 0x02, 0x02, 0x01, 0x00]);
    }

    #[test]
    fn test_cmd_impedance_ac_on_reference() {
        assert_eq!(
            cmd_impedance_ac_on(CodeSet::Reference),
            vec![0x05, 0x01, 0x08, 0x02, 0x06, 0x01, 0x00]
        );
    }

    #[test]
    fn test_cmd_impedance_ac_on_pdf() {
        assert_eq!(
            cmd_impedance_ac_on(CodeSet::Pdf),
            vec![0x05, 0x01, 0x08, 0x02, 0x03, 0x01, 0x00]
        );
    }

    #[test]
    fn test_cmd_impedance_dc_on_reference() {
        assert_eq!(
            cmd_impedance_dc_on(CodeSet::Reference),
            vec![0x05, 0x01, 0x08, 0x02, 0x05, 0x01, 0x00]
        );
    }

    #[test]
    fn test_cmd_impedance_dc_on_pdf() {
        assert_eq!(
            cmd_impedance_dc_on(CodeSet::Pdf),
            vec![0x05, 0x01, 0x08, 0x02, 0x04, 0x01, 0x00]
        );
    }

    #[test]
    fn test_cmd_impedance_off_reference() {
        assert_eq!(
            cmd_impedance_off(CodeSet::Reference),
            vec![0x05, 0x01, 0x08, 0x02, 0x07, 0x01, 0x00]
        );
    }

    #[test]
    fn test_cmd_impedance_off_pdf() {
        assert_eq!(
            cmd_impedance_off(CodeSet::Pdf),
            vec![0x05, 0x01, 0x08, 0x02, 0x05, 0x01, 0x00]
        );
    }

    #[test]
    fn test_cmd_read_synctick_bytes() {
        assert_eq!(cmd_read_synctick(), vec![0x05, 0x01, 0x08, 0x02, 0x11, 0x01, 0x00]);
    }

    #[test]
    fn test_cmd_get_conn_status_bytes() {
        assert_eq!(cmd_get_conn_status(), vec![0x05, 0x01, 0x08, 0x02, 0x12, 0x01, 0x00]);
    }

    #[test]
    fn test_cmd_machine_info_bytes() {
        assert_eq!(cmd_machine_info(), vec![0x05, 0x01, 0x08, 0x02, 0x2E, 0x01, 0x00]);
    }

    #[test]
    fn test_all_commands_end_with_null_terminator() {
        let cmds = vec![
            cmd_adc_on(),
            cmd_adc_off(),
            cmd_impedance_ac_on(CodeSet::Reference),
            cmd_impedance_dc_on(CodeSet::Reference),
            cmd_impedance_off(CodeSet::Reference),
            cmd_read_synctick(),
            cmd_get_conn_status(),
            cmd_machine_info(),
        ];
        for cmd in cmds {
            assert_eq!(cmd[cmd.len() - 1], 0x00, "Command does not end with 0x00");
        }
    }

    #[test]
    fn test_all_commands_7_bytes() {
        let cmds = vec![
            cmd_adc_on(),
            cmd_adc_off(),
            cmd_impedance_ac_on(CodeSet::Reference),
            cmd_impedance_dc_on(CodeSet::Reference),
            cmd_impedance_off(CodeSet::Reference),
            cmd_read_synctick(),
            cmd_get_conn_status(),
            cmd_machine_info(),
        ];
        for cmd in cmds {
            assert_eq!(cmd.len(), 7, "Command is not 7 bytes");
        }
    }

    #[test]
    fn test_codeset_enum() {
        let ref_set = CodeSet::Reference;
        let pdf_set = CodeSet::Pdf;
        assert_ne!(ref_set, pdf_set);
        assert_eq!(ref_set, CodeSet::Reference);
    }
}
